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
  CONTINUATION_COMPLETION_EVIDENCE,
  CONTINUATION_PROCESSING_STATES,
  CONTINUATION_PROCESSING_TRANSITIONS,
  continuationDuplicateEffectPrevented,
  continuationEventKey,
  continuationLeaseKey,
  continuationOutcome,
  continuationRecoveryAction,
  isLegalContinuationProcessingTransition,
  mayMarkContinuationCompleted,
  outboxRecoveryAction,
  enqueuesContinuation,
  isTerminal,
  longestContinuationChain,
  type ContinuationCompletionEvidence,
  type ContinuationEvent,
  type ContinuationLeaseRecord,
  type ContinuationProcessingState,
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

describe('at-least-once processing with a recoverable lease (actions.md §2.4)', () => {
  const processing = asRecord(fixture.processing, 'processing');
  const leaseKeys = asArray(processing.lease_keys, 'lease_keys');
  const recovery = asArray(processing.recovery, 'recovery');
  const evidence = asArray(processing.completion_evidence, 'completion_evidence');
  const duplicates = asArray(processing.duplicate_effect, 'duplicate_effect');
  const atLeastOnce = asRecord(processing.at_least_once, 'at_least_once');
  const silent = asRecord(processing.silent_continuation, 'silent_continuation');
  const declaredTransitions = asRecord(processing.transitions, 'processing.transitions');

  it('declares the three processing states', () => {
    expect(asStrings(processing.states, 'states')).toEqual([...CONTINUATION_PROCESSING_STATES]);
  });

  it.each([...CONTINUATION_PROCESSING_STATES])('%s matches the frozen row', (state) => {
    expect(asStrings(declaredTransitions[state], `transitions.${state}`)).toEqual([
      ...CONTINUATION_PROCESSING_TRANSITIONS[state],
    ]);
  });

  it('allows processing → pending, which is what makes a crash recoverable', () => {
    expect(isLegalContinuationProcessingTransition('processing', 'pending')).toBe(true);
  });

  it.each(names(asArray(processing.illegal_transitions, 'illegal_transitions')))(
    '%s is rejected',
    (name) => {
      const testCase = byName(asArray(processing.illegal_transitions, 'illegal'), name);
      expect(
        isLegalContinuationProcessingTransition(
          testCase.from as ContinuationProcessingState,
          testCase.to as ContinuationProcessingState,
        ),
      ).toBe(false);
    },
  );

  it.each(names(leaseKeys))('%s builds its own lease key', (name) => {
    const testCase = byName(leaseKeys, name);
    expect(
      continuationLeaseKey(String(testCase.workflow_id), Number(testCase.sequence)),
    ).toBe(testCase.expect_key);
  });

  describe('restart recovery', () => {
    it.each(names(recovery))('%s', (name) => {
      const testCase = byName(recovery, name);
      expect(
        continuationRecoveryAction(
          testCase.record as unknown as ContinuationLeaseRecord,
          String(processing.now),
          String(processing.current_run_id),
        ),
      ).toBe(testCase.expect_action);
    });

    it('resumes a continuation whose run died before any durable write', () => {
      // The defect this fixes: a one-time claim taken before evaluation would
      // have said "handled" over a workflow where nothing happened, and restart
      // would have dropped it — stranding a Gist-expected state with nothing
      // scheduled to act on it.
      const testCase = byName(recovery, 'crash_after_lease_before_any_durable_write_resumes');
      expect(
        continuationRecoveryAction(
          testCase.record as unknown as ContinuationLeaseRecord,
          String(processing.now),
          String(processing.current_run_id),
        ),
      ).toBe('resume');
    });

    it('never drops a continuation that is not completed', () => {
      for (const testCase of recovery) {
        const state = asRecord(testCase.record, 'record').processing_state;
        if (state === 'completed') continue;
        expect(testCase.expect_action, String(testCase.name)).not.toBe('skip_completed');
      }
    });

    it('leaves a live lease held by another run alone', () => {
      // Liveness only: the lease stops two live runs racing, and expires so a
      // crashed run's work is picked up rather than abandoned.
      expect(
        continuationRecoveryAction(
          {
            processing_state: 'processing',
            lease_owner: 'run_supv_c',
            lease_expires_at: '2026-09-01T00:20:00.000Z',
          },
          String(processing.now),
          String(processing.current_run_id),
        ),
      ).toBe('leave_to_live_owner');
    });
  });

  describe('completion is atomic with a durable outcome', () => {
    it.each(names(evidence))('%s', (name) => {
      const testCase = byName(evidence, name);
      expect(
        mayMarkContinuationCompleted(
          (testCase.evidence as ContinuationCompletionEvidence | null) ?? null,
        ),
      ).toBe(testCase.expect_may_complete);
    });

    it('refuses to complete before anything durable is written', () => {
      expect(mayMarkContinuationCompleted(null)).toBe(false);
    });

    it('accepts exactly the three declared evidences', () => {
      const declared = evidence
        .filter((testCase) => testCase.expect_may_complete === true)
        .map((testCase) => testCase.evidence);
      expect(declared.slice().sort()).toEqual([...CONTINUATION_COMPLETION_EVIDENCE].sort());
    });

    it('completes a silent continuation on its committed transition', () => {
      expect(silent.visible_actions).toBe(0);
      expect(silent.expect_action_claim_taken).toBe(false);
      expect(
        mayMarkContinuationCompleted(silent.expect_completed_with as ContinuationCompletionEvidence),
      ).toBe(true);
    });

    it('hands a visible action to a durable pending outbox before completion', () => {
      const outbox = asRecord(processing.outbox_completion, 'outbox_completion');
      expect(mayMarkContinuationCompleted('durable_outbox_intent')).toBe(true);
      expect(outbox.continuation_state).toBe('completed');
      expect(outbox.delivery_state).toBe('pending');
      expect(outbox.slack_call_started).toBe(false);
      expect(outboxRecoveryAction('pending')).toBe('resume_pending_first_send');
      expect(outbox.expect_eventual_slack_effects).toBe(1);
      expect(outbox.expect_duplicate_send).toBe(false);
    });
  });

  describe('duplicate effects, not duplicate evaluation', () => {
    it('does not claim exactly-once evaluation', () => {
      // There is no exactly-once model evaluation to be had here, and claiming
      // one would only hide where the cost falls.
      expect(atLeastOnce.expect_duplicate_evaluation_possible).toBe(true);
      expect(atLeastOnce.expect_duplicate_effect_possible).toBe(false);
      expect(atLeastOnce.expect_claims_exactly_once_evaluation).toBe(false);
      expect(asStrings(atLeastOnce.effect_guards, 'effect_guards')).toEqual([
        'transition_compare_and_set',
        'external_action_claim',
      ]);
    });

    it.each(names(duplicates))('%s', (name) => {
      const testCase = byName(duplicates, name);
      expect(
        continuationDuplicateEffectPrevented({
          stored: testCase.stored as unknown as StoredWorkflow,
          request: testCase.request as unknown as TransitionRequest,
          action_claim_held: Boolean(testCase.action_claim_held),
        }),
      ).toBe(testCase.expect_prevented);
    });

    it('converges a re-evaluated continuation on the already-committed transition', () => {
      const testCase = byName(duplicates, 'transition_cas_converges_a_second_evaluation');
      expect(
        continuationDuplicateEffectPrevented({
          stored: testCase.stored as unknown as StoredWorkflow,
          request: testCase.request as unknown as TransitionRequest,
          action_claim_held: false,
        }),
      ).toBe(true);
    });

    it('posts nothing a second time when the first pass already posted', () => {
      const testCase = byName(duplicates, 'action_claim_converges_a_second_visible_action');
      expect(
        continuationDuplicateEffectPrevented({
          stored: testCase.stored as unknown as StoredWorkflow,
          request: testCase.request as unknown as TransitionRequest,
          action_claim_held: true,
        }),
      ).toBe(true);
    });

    it('still lets a genuine first pass act', () => {
      const testCase = byName(duplicates, 'a_genuine_first_pass_is_allowed_to_act');
      expect(
        continuationDuplicateEffectPrevented({
          stored: testCase.stored as unknown as StoredWorkflow,
          request: testCase.request as unknown as TransitionRequest,
          action_claim_held: false,
        }),
      ).toBe(false);
    });
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

  it('walks draft → ready, then command pending → delivered → dispatched', () => {
    const transitions = steps.filter((step) => step.to_state !== null);
    expect(transitions.map((step) => step.to_state)).toEqual(['draft', 'ready', 'dispatched']);
    for (const step of transitions) {
      if (step.from_state === null) continue;
      expect(
        WORKFLOW_TRANSITIONS[step.from_state as WorkflowState],
        `${String(step.from_state)} → ${String(step.to_state)}`,
      ).toContain(step.to_state);
    }
    expect(steps.map((step) => step.command_state).filter(Boolean)).toEqual(['pending', 'delivered']);
    expect(walk.expect_final_state).toBe('dispatched');
  });

  it('enqueues only on committed Gist-expected transitions, never on command delivery', () => {
    for (const step of steps) {
      const committedTransition = step.to_state !== null;
      expect(
        committedTransition
          ? enqueuesContinuation({
              committed: true,
              next_state: step.to_state as WorkflowState,
              continuation_pending: false,
            })
          : false,
        `step ${String(step.step)}`,
      ).toBe(step.expect_enqueues_continuation);
    }
  });

  it('creates one visible command and produces one Slack effect', () => {
    const commands = steps.reduce((sum, step) => sum + Number(step.expect_visible_actions), 0);
    const effects = steps.reduce((sum, step) => sum + Number(step.expect_slack_effects), 0);
    expect(commands).toBe(walk.expect_total_visible_actions);
    expect(effects).toBe(walk.expect_total_slack_effects);
    expect(commands).toBe(1);
    expect(effects).toBe(1);
  });

  it('claims the source continuation once; outbox delivery reuses that command', () => {
    const commandStep = steps.find((step) => Number(step.expect_visible_actions) === 1);
    const outboxStep = steps.find((step) => step.source === 'outbox');
    expect(commandStep).toBeDefined();
    expect(outboxStep?.event_key).toBe(commandStep?.event_key);
    expect(actionClaimKey(String(commandStep?.event_key))).toBe('ev:cont:wf_supv_0001:2');
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
        processing_state: testCase.processing_state as ContinuationProcessingState,
        current_state: testCase.current_state as WorkflowState,
        enqueued_for_state: testCase.enqueued_for_state as WorkflowState,
      }),
    ).toBe(testCase.expect_outcome);
  });

  it('does nothing when a human cancelled while it waited', () => {
    expect(
      continuationOutcome({
        processing_state: 'processing',
        current_state: 'cancelled',
        enqueued_for_state: 'draft',
      }),
    ).toBe('superseded');
  });

  it('is a no-op once its processing state records a durable outcome', () => {
    // `completed` means an outcome was written. A crash mid-run leaves
    // `processing` instead, and that is resumed rather than skipped.
    expect(
      continuationOutcome({
        processing_state: 'completed',
        current_state: 'ready',
        enqueued_for_state: 'ready',
      }),
    ).toBe('already_processed');
  });

  it('lets a completed processing state win over a state that still matches', () => {
    expect(
      continuationOutcome({
        processing_state: 'completed',
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
