/**
 * actions.md §2.1–§2.3, events.md §2.1, workflow-state.md §3.4 — the durable
 * runtime-owned turn that carries a clear assignment to dispatch.
 *
 * The defect this closes: creation and dispatch are deliberately separate
 * turns, but nothing scheduled the second one. A clear authorized assignment
 * could sit in `draft` indefinitely unless somebody happened to type again,
 * which contradicts GS-FR-006 and PRD acceptance scenario 1.
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadContractDoc, loadFixture, names } from './helpers.js';
import {
  GIST_EXPECTED_STATES,
  SLACK_ONLY_EVENT_FIELDS,
  admissionEntryStep,
  isContinuationEvent,
  isSlackEvent,
  WORKFLOW_STATES,
  WORKFLOW_TRANSITIONS,
  actionClaimKey,
  applyCounters,
  continuationClaimKey,
  continuationEventKey,
  continuationOutcome,
  continuationReplayIsNoOp,
  enqueuesContinuation,
  isTerminal,
  longestContinuationChain,
  type ContinuationEvent,
  type CountingInput,
  type StoredWorkflow,
  type SupervisorEvent,
  type TransitionRequest,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('continuation.v1.json');
const enqueue = asArray(fixture.enqueue, 'enqueue');
const outcomes = asArray(fixture.outcomes, 'outcomes');
const eventKeys = asArray(fixture.event_keys, 'event_keys');
const walk = asRecord(fixture.clear_assignment_walk, 'clear_assignment_walk');
const chain = asRecord(fixture.chain_bounds, 'chain_bounds');

describe('ContinuationEvent record (actions.md §2.1)', () => {
  const sample = asRecord(fixture.sample_record, 'sample_record');

  it.each(asStrings(fixture.record_required_fields, 'record_required_fields'))(
    'carries %s',
    (field) => {
      expect(sample).toHaveProperty(field);
    },
  );

  it.each(asStrings(fixture.record_forbidden_fields, 'record_forbidden_fields'))(
    'does not carry %s',
    (field) => {
      // It is a state-machine step, not a message. There is no field a sender,
      // a body, or a model's output could occupy.
      expect(sample).not.toHaveProperty(field);
    },
  );

  it.each(names(eventKeys))('%s builds a durable, non-Slack event key', (name) => {
    const testCase = byName(eventKeys, name);
    expect(
      continuationEventKey(String(testCase.workflow_id), Number(testCase.sequence)),
    ).toBe(testCase.expect_key);
  });

  it('gives every workflow and sequence a distinct key', () => {
    const keys = eventKeys.map((testCase) =>
      continuationEventKey(String(testCase.workflow_id), Number(testCase.sequence)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('origin typing (actions.md §2.1)', () => {
  const origin = asRecord(fixture.origin_typing, 'origin_typing');
  const chainCases = asArray(origin.chain, 'origin_typing.chain');

  it.each(names(chainCases))('%s', (name) => {
    const testCase = byName(chainCases, name);
    const isMessageKey = /^[^:]+\/[^/]+\/\d+\.\d+$/.test(String(testCase.origin_event_key));
    expect(isMessageKey).toBe(testCase.expect_origin_is_message_key);
  });

  it('lets a later continuation descend from an earlier one', () => {
    // The defect this fixes: typing origin_event_key as a MessageKey was wrong
    // for every step of a chain after the first.
    const second = byName(chainCases, 'second_continuation_descends_from_the_first');
    expect(second.origin_event_key).toBe(continuationEventKey('wf_supv_0001', 1));
  });

  it('keeps root_message_key constant along the chain', () => {
    const roots = new Set(chainCases.map((testCase) => testCase.root_message_key));
    expect(roots.size).toBe(1);
    expect(origin.expect_root_constant_along_the_chain).toBe(true);
  });

  it('answers provenance with the root, not with the immediate parent', () => {
    const second = byName(chainCases, 'second_continuation_descends_from_the_first');
    expect(second.root_message_key).not.toBe(second.origin_event_key);
    expect(String(second.root_message_key)).toMatch(/^[^:]+\/[^/]+\/\d+\.\d+$/);
  });
});

describe('the continuation half of the event union (events.md §1.2)', () => {
  const sample = asRecord(fixture.sample_record, 'sample_record');
  const union = asRecord(loadFixture('events.v1.json').event_union, 'event_union');

  it('discriminates on source', () => {
    const event = sample as unknown as SupervisorEvent;
    expect(isContinuationEvent(event)).toBe(true);
    expect(isSlackEvent(event)).toBe(false);
  });

  it.each(asStrings(union.slack_only_fields, 'slack_only_fields'))(
    'carries no %s',
    (field) => {
      // Not an omission to be patched later: it has no actor because no actor
      // produced it, and no binding because the workflow record holds the one
      // immutable binding.
      expect(sample).not.toHaveProperty(field);
    },
  );

  it('matches the declared Slack-only field set', () => {
    expect(asStrings(union.slack_only_fields, 'slack_only_fields').slice().sort()).toEqual(
      [...SLACK_ONLY_EVENT_FIELDS].sort(),
    );
  });

  it('enters the pipeline at correlation while Slack events start at capture', () => {
    expect(admissionEntryStep('continuation')).toBe(6);
    expect(admissionEntryStep('slack')).toBe(1);
  });

  it('types the sample as a ContinuationEvent', () => {
    const event = sample as unknown as ContinuationEvent;
    expect(event.workflow_id).toBe('wf_supv_0001');
    expect(event.continuation_seq).toBe(1);
  });
});

describe('the consumption claim marks it processed (actions.md §2.4)', () => {
  const claim = asRecord(fixture.consumption_claim, 'consumption_claim');
  const keys = asArray(claim.keys, 'consumption_claim.keys');
  const layers = asArray(claim.replay_layers, 'replay_layers');
  const silent = asRecord(claim.silent_continuation, 'silent_continuation');

  it.each(names(keys))('%s builds its own claim key', (name) => {
    const testCase = byName(keys, name);
    expect(
      continuationClaimKey(String(testCase.workflow_id), Number(testCase.sequence)),
    ).toBe(testCase.expect_key);
  });

  it('is independent of the external-action claim', () => {
    // The defect this fixes: an internal-only continuation takes no action
    // claim, so an action claim marks nothing as processed.
    const consumption = continuationClaimKey('wf_supv_0001', 1);
    const action = actionClaimKey(continuationEventKey('wf_supv_0001', 1));
    expect(consumption).not.toBe(action);
    expect(claim.expect_independent_of_action_claim).toBe(true);
    expect(claim.expect_taken_before_evaluation).toBe(true);
  });

  it('marks a silent continuation processed even though it acts on nothing', () => {
    expect(silent.visible_actions).toBe(0);
    expect(silent.expect_action_claim_taken).toBe(false);
    expect(silent.expect_consumption_claim_taken).toBe(true);
  });

  it.each(names(layers))('%s', (name) => {
    const testCase = byName(layers, name);
    expect(
      continuationReplayIsNoOp({
        consumption_claim_held: Boolean(testCase.consumption_claim_held),
        stored: testCase.stored as unknown as StoredWorkflow,
        request: testCase.request as unknown as TransitionRequest,
      }),
    ).toBe(testCase.expect_no_op);
  });

  it('still makes replay a no-op if the consumption claim were lost', () => {
    // Two layers on purpose: the claim stops the work, the compare-and-set
    // stops the effect.
    const testCase = byName(layers, 'transition_cas_is_the_second_layer');
    expect(testCase.consumption_claim_held).toBe(false);
    expect(
      continuationReplayIsNoOp({
        consumption_claim_held: false,
        stored: testCase.stored as unknown as StoredWorkflow,
        request: testCase.request as unknown as TransitionRequest,
      }),
    ).toBe(true);
  });
});

describe('enqueue rule (workflow-state.md §3.4)', () => {
  it('names exactly the three Gist-expected states', () => {
    expect(asStrings(fixture.gist_expected_states, 'gist_expected_states')).toEqual([
      ...GIST_EXPECTED_STATES,
    ]);
  });

  it.each(names(enqueue))('%s', (name) => {
    const testCase = byName(enqueue, name);
    expect(
      enqueuesContinuation({
        committed: Boolean(testCase.committed),
        next_state: testCase.next_state as WorkflowState,
        continuation_pending: Boolean(testCase.continuation_pending),
      }),
    ).toBe(testCase.expect_enqueued);
  });

  it('enqueues for every Gist-expected state and no other', () => {
    for (const state of WORKFLOW_STATES) {
      expect(
        enqueuesContinuation({
          committed: true,
          next_state: state,
          continuation_pending: false,
        }),
        `${state} enqueue decision`,
      ).toBe(GIST_EXPECTED_STATES.includes(state));
    }
  });

  it('never enqueues into a terminal state', () => {
    for (const state of WORKFLOW_STATES.filter(isTerminal)) {
      expect(
        enqueuesContinuation({ committed: true, next_state: state, continuation_pending: false }),
      ).toBe(false);
    }
  });

  it('never enqueues from a rejected transition', () => {
    // A failed dispatch commits no state change, so it produces no
    // continuation. Retry is dispatch.md §3.3, not an internal turn loop.
    for (const state of GIST_EXPECTED_STATES) {
      expect(
        enqueuesContinuation({ committed: false, next_state: state, continuation_pending: false }),
      ).toBe(false);
    }
  });

  it('allows at most one pending continuation per workflow', () => {
    for (const state of GIST_EXPECTED_STATES) {
      expect(
        enqueuesContinuation({ committed: true, next_state: state, continuation_pending: true }),
        state,
      ).toBe(false);
    }
  });

  it('commits the enqueue with the transition rather than after it', () => {
    // Any gap between "the workflow now expects Gist" and "something is
    // scheduled to act as Gist" is a window in which a crash strands the work.
    expect(loadContractDoc('workflow-state.md')).toContain(
      'same atomic commit as the transition',
    );
  });
});

describe('a clear assignment reaches dispatch on its own (GS-FR-006)', () => {
  const steps = asArray(walk.steps, 'clear_assignment_walk.steps');

  it('takes exactly one Slack event and no confirmation', () => {
    expect(walk.expect_additional_slack_events_required).toBe(0);
    const slackSteps = steps.filter((step) => step.source === 'slack');
    expect(slackSteps).toHaveLength(1);
    for (const step of steps) {
      expect(step.expect_asks_human, `step ${String(step.step)} asked the human`).toBe(false);
    }
  });

  it('walks draft → ready → dispatched through legal transitions', () => {
    expect(steps.map((step) => step.to_state)).toEqual(['draft', 'ready', 'dispatched']);
    for (const step of steps) {
      if (step.from_state === null) continue;
      expect(
        WORKFLOW_TRANSITIONS[step.from_state as WorkflowState],
        `${String(step.from_state)} → ${String(step.to_state)}`,
      ).toContain(step.to_state);
    }
    expect(walk.expect_final_state).toBe('dispatched');
  });

  it('enqueues a continuation at each Gist-expected step and stops at dispatched', () => {
    for (const step of steps) {
      expect(
        enqueuesContinuation({
          committed: true,
          next_state: step.to_state as WorkflowState,
          continuation_pending: false,
        }),
        `step ${String(step.step)}`,
      ).toBe(step.expect_enqueues_continuation);
    }
  });

  it('produces exactly one externally visible action across the whole walk', () => {
    // Creation and the intermediate turn are silent; the instruction is the
    // one visible action, and it belongs to its own source event.
    const total = steps.reduce((sum, step) => sum + Number(step.expect_visible_actions), 0);
    expect(total).toBe(walk.expect_total_visible_actions);
    expect(total).toBe(1);
  });

  it('gives every step its own claim, so no step can double up', () => {
    const claims = steps.map((step) => actionClaimKey(String(step.event_key)));
    expect(new Set(claims).size).toBe(claims.length);
  });
});

describe('continuations cannot loop (actions.md §2.2 rule 3)', () => {
  const expectedChains = asRecord(chain.expect_longest_chain, 'expect_longest_chain');

  it.each([...GIST_EXPECTED_STATES])('%s has a finite chain', (state) => {
    expect(longestContinuationChain(state)).toBe(expectedChains[state]);
  });

  it('finds no cycle from any state', () => {
    for (const state of WORKFLOW_STATES) {
      expect(longestContinuationChain(state), `${state} cycles`).not.toBeNull();
    }
    expect(chain.expect_any_cycle).toBe(false);
  });

  it('bounds the whole machine at one further Gist-expected state', () => {
    const longest = Math.max(
      ...WORKFLOW_STATES.map((state) => longestContinuationChain(state) ?? Number.POSITIVE_INFINITY),
    );
    expect(longest).toBe(chain.expect_max_chain_overall);
  });

  it('fires at most two continuations from a fresh draft', () => {
    // draft → ready → dispatched. `dispatched` expects a bot, so the chain ends
    // there rather than at a limit.
    const fromDraft = (longestContinuationChain('draft') ?? 0) + 1;
    expect(fromDraft).toBe(chain.expect_max_continuations_from_draft);
    expect(fromDraft).toBe(2);
  });

  it('has exactly the two Gist-expected edges the contract names', () => {
    // The earlier wording claimed no Gist-expected state was reachable from
    // another and then named one; both draft→ready and changes_requested→ready
    // are legal, and stating them is what makes the bound checkable.
    const edges: string[] = [];
    for (const from of GIST_EXPECTED_STATES) {
      for (const to of WORKFLOW_TRANSITIONS[from]) {
        if (GIST_EXPECTED_STATES.includes(to)) edges.push(`${from}->${to}`);
      }
    }
    expect(edges).toEqual(asStrings(chain.expect_gist_expected_edges, 'edges'));
  });

  it('makes `ready` the only sink of that subgraph', () => {
    const successors = WORKFLOW_TRANSITIONS.ready.filter((state) =>
      GIST_EXPECTED_STATES.includes(state),
    );
    expect(successors).toEqual([]);
    expect(chain.expect_ready_has_no_gist_expected_successor).toBe(true);
  });

  it('gives none of the three a self-transition', () => {
    for (const state of GIST_EXPECTED_STATES) {
      expect(WORKFLOW_TRANSITIONS[state], state).not.toContain(state);
    }
  });
});

describe('a continuation re-reads state after the queue (events.md §5 rule 2)', () => {
  it.each(names(outcomes))('%s', (name) => {
    const testCase = byName(outcomes, name);
    expect(
      continuationOutcome({
        consumption_claim_held: Boolean(testCase.consumption_claim_held),
        current_state: testCase.current_state as WorkflowState,
        enqueued_for_state: testCase.enqueued_for_state as WorkflowState,
      }),
    ).toBe(testCase.expect_outcome);
  });

  it('does nothing when a human cancelled while it waited', () => {
    expect(
      continuationOutcome({
        consumption_claim_held: false,
        current_state: 'cancelled',
        enqueued_for_state: 'draft',
      }),
    ).toBe('superseded');
  });

  it('is a no-op when replayed after restart (GS-INV-09, GS-INV-12)', () => {
    // The claim on the continuation's own event key is what makes reprocessing
    // safe; without it a restart would re-dispatch.
    expect(
      continuationOutcome({
        consumption_claim_held: true,
        current_state: 'ready',
        enqueued_for_state: 'ready',
      }),
    ).toBe('already_processed');
  });

  it('lets the claim win over a state that still matches', () => {
    expect(
      continuationOutcome({
        consumption_claim_held: true,
        current_state: 'draft',
        enqueued_for_state: 'draft',
      }),
    ).toBe('already_processed');
  });
});

describe('a continuation is claimed like any source event (dispatch.md §2)', () => {
  const claims = asArray(asRecord(fixture.claims, 'claims').cases, 'claims.cases');

  it.each(names(claims))('%s', (name) => {
    const testCase = byName(claims, name);
    expect(actionClaimKey(String(testCase.source_event_key))).toBe(
      testCase.expect_action_claim_key,
    );
  });

  it('uses the identical key shape for Slack and continuation sources', () => {
    for (const testCase of claims) {
      expect(String(testCase.expect_action_claim_key)).toMatch(/^ev:/);
    }
  });
});

describe('a continuation consumes a turn (actions.md §2.2 rule 4)', () => {
  const accounting = asRecord(fixture.turn_accounting, 'turn_accounting');

  it('increments turn_count like any other new event', () => {
    // This is how max_turns bounds the internal path as tightly as it bounds
    // Slack traffic — runtime-generated turns are not the cheap ones.
    const result = applyCounters(
      accounting.transition as unknown as CountingInput,
      Number(accounting.turn_count_before),
      Number(accounting.consecutive_failures_before),
    );
    expect(result.turn_count).toBe(accounting.expect_turn_count);
  });
});

describe('a continuation is not self-evaluation (GS-INV-05)', () => {
  const claim = asRecord(fixture.not_self_evaluation, 'not_self_evaluation');

  it('carries no actor and no content', () => {
    expect(claim.expect_has_actor_class).toBe(false);
    expect(claim.expect_carries_message_content).toBe(false);
    const sample = asRecord(fixture.sample_record, 'sample_record');
    expect(sample).not.toHaveProperty('actor_class');
  });

  it.each(asStrings(claim.forbidden_origins, 'forbidden_origins'))(
    'can never be created from %s',
    (origin) => {
      expect(origin.length).toBeGreaterThan(0);
    },
  );

  it('names Gist echoes and bot content among the forbidden origins', () => {
    const origins = asStrings(claim.forbidden_origins, 'forbidden_origins');
    for (const origin of ['gist_slack_message', 'trusted_bot_content', 'model_output']) {
      expect(origins, `no forbidden origin covers ${origin}`).toContain(origin);
    }
  });

  it('is stated in the contract, not only in the fixture', () => {
    const doc = loadContractDoc('actions.md');
    expect(doc).toContain('not a hole in GS-INV-05');
    expect(loadContractDoc('invariants.md')).toContain('not an exception to this');
  });
});

describe('continuations enter the pipeline below routing (events.md §2.1)', () => {
  const admission = asRecord(
    loadFixture('events.v1.json').continuation_admission,
    'continuation_admission',
  );

  it('enters at the correlation step', () => {
    expect(admission.entry_step).toBe(6);
  });

  it('still correlates, serializes, and evaluates', () => {
    expect(asStrings(admission.required_steps, 'required_steps')).toEqual([
      'correlate',
      'serialize',
      'evaluate',
    ]);
  });

  it('is the only event class permitted below step 4', () => {
    expect(admission.expect_only_continuations_may_enter_below_step_4).toBe(true);
  });

  it('carries none of the Slack-only fields at all', () => {
    // Not "null where Slack would have a value" — the field is absent, because
    // the union gives the continuation half no place to put one.
    const sample = asRecord(admission.sample_event, 'sample_event');
    expect(sample.source).toBe('continuation');
    for (const field of SLACK_ONLY_EVENT_FIELDS) {
      expect(sample, `continuation carries ${field}`).not.toHaveProperty(field);
    }
    expect(admission.expect_carries_slack_only_fields).toBe(false);
  });
});
