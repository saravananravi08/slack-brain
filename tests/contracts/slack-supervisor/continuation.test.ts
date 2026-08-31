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
  WORKFLOW_STATES,
  WORKFLOW_TRANSITIONS,
  actionClaimKey,
  applyCounters,
  continuationEventKey,
  continuationOutcome,
  enqueuesContinuation,
  isTerminal,
  longestContinuationChain,
  type CountingInput,
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

  it('has no edge between two Gist-expected states other than changes_requested → ready', () => {
    const edges: string[] = [];
    for (const from of GIST_EXPECTED_STATES) {
      for (const to of WORKFLOW_TRANSITIONS[from]) {
        if (GIST_EXPECTED_STATES.includes(to)) edges.push(`${from}->${to}`);
      }
    }
    expect(edges).toEqual(['draft->ready', 'changes_requested->ready']);
  });
});

describe('a continuation re-reads state after the queue (events.md §5 rule 2)', () => {
  it.each(names(outcomes))('%s', (name) => {
    const testCase = byName(outcomes, name);
    expect(
      continuationOutcome({
        claim_held: Boolean(testCase.claim_held),
        current_state: testCase.current_state as WorkflowState,
        enqueued_for_state: testCase.enqueued_for_state as WorkflowState,
      }),
    ).toBe(testCase.expect_outcome);
  });

  it('does nothing when a human cancelled while it waited', () => {
    expect(
      continuationOutcome({
        claim_held: false,
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
        claim_held: true,
        current_state: 'ready',
        enqueued_for_state: 'ready',
      }),
    ).toBe('already_processed');
  });

  it('lets the claim win over a state that still matches', () => {
    expect(
      continuationOutcome({ claim_held: true, current_state: 'draft', enqueued_for_state: 'draft' }),
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

  it('carries no Slack delivery identity', () => {
    const sample = asRecord(admission.sample_event, 'sample_event');
    expect(sample.source).toBe('continuation');
    expect(sample.delivery_event_id).toBeNull();
    expect(sample).not.toHaveProperty('actor_class');
  });
});
