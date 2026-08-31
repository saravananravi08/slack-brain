/**
 * workflow-state.md — the durable record, the thirteen states, the legal
 * transition table, compare-and-set, requester authority, and the
 * implementation-then-review lifecycle
 * (GS-FR-012…016, GS-FR-029, GS-FR-030, GS-NFR-002, GS-NFR-005).
 */

import { describe, expect, it } from 'vitest';

import {
  asArray,
  asRecord,
  asStrings,
  byName,
  loadContractDoc,
  loadFixture,
  names,
} from './helpers.js';
import {
  TERMINAL_STATES,
  applyDeliveryOutcome,
  applyFailedDispatch,
  retryAllowed,
  WORKFLOW_TRANSITIONS,
  WORKFLOW_STATES,
  evaluateTransition,
  isLegalTransition,
  isTerminal,
  looksLikeSlackId,
  mayRequestTransition,
  recordedRequester,
  type ActorClass,
  type StoredWorkflow,
  type TransitionClass,
  type TransitionRequest,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('workflow.v1.json');
const sample = asRecord(fixture.sample_record, 'sample_record');
const casCases = asArray(fixture.compare_and_set, 'compare_and_set');
const illegal = asArray(fixture.illegal_transitions, 'illegal_transitions');
const authority = asArray(fixture.requester_authority, 'requester_authority');
const review = asArray(fixture.review_lifecycle, 'review_lifecycle');

describe('WorkflowRecord (workflow-state.md §1, GS-FR-012)', () => {
  const required = asStrings(fixture.record_required_fields, 'record_required_fields');
  const forbidden = asStrings(fixture.record_forbidden_fields, 'record_forbidden_fields');

  it.each(required)('carries %s', (field) => {
    expect(sample).toHaveProperty(field);
  });

  it.each(forbidden)('does not carry %s', (field) => {
    // The objective, clarifications, instructions, and bot replies live in
    // channel memory and are referenced by MessageKey. Duplicating them here
    // would drift on edit and create a second retention domain.
    expect(sample).not.toHaveProperty(field);
  });

  it('references the objective by message key rather than storing its text', () => {
    expect(String(sample.objective_message_key)).toMatch(/^[^/]+\/[^/]+\/\d+\.\d+$/);
  });

  it('uses a workflow ID that is not Slack-shaped and not timestamp-derived', () => {
    const workflowId = String(sample.workflow_id);
    expect(workflowId).toMatch(/^wf_/);
    expect(looksLikeSlackId(workflowId)).toBe(false);
    expect(workflowId).not.toContain(String(sample.thread_root_ts));
  });

  it('carries its limits on the record rather than reading them globally', () => {
    // GS-NFR-007 — a config change must not retroactively widen a workflow
    // that is already running.
    expect(asRecord(sample.limits, 'limits')).toHaveProperty('max_turns');
  });
});

describe('states (workflow-state.md §2, GS-FR-013)', () => {
  it('declares exactly the thirteen PRD states', () => {
    expect(asStrings(fixture.states, 'states')).toEqual([...WORKFLOW_STATES]);
    expect(WORKFLOW_STATES).toHaveLength(13);
  });

  it('declares exactly four terminal states', () => {
    expect(asStrings(fixture.terminal_states, 'terminal_states')).toEqual([...TERMINAL_STATES]);
    expect(TERMINAL_STATES).toHaveLength(4);
  });

  it.each([...TERMINAL_STATES])('%s has no outgoing transition', (state) => {
    expect(WORKFLOW_TRANSITIONS[state]).toEqual([]);
    expect(isTerminal(state)).toBe(true);
  });

  it('reaches every non-terminal state from somewhere', () => {
    const reachable = new Set(Object.values(WORKFLOW_TRANSITIONS).flat());
    for (const state of WORKFLOW_STATES) {
      if (state === 'draft') continue; // the entry state
      expect(reachable, `${state} is unreachable`).toContain(state);
    }
  });
});

describe('the transition table (workflow-state.md §3.1, GS-FR-014)', () => {
  const table = asRecord(fixture.transitions, 'transitions');

  it.each(WORKFLOW_STATES)('%s matches the frozen row', (state) => {
    expect(asStrings(table[state], `transitions.${state}`)).toEqual([...WORKFLOW_TRANSITIONS[state]]);
  });

  it.each(names(illegal))('%s is rejected', (name) => {
    const testCase = byName(illegal, name);
    expect(
      isLegalTransition(testCase.from as WorkflowState, testCase.to as WorkflowState),
    ).toBe(false);
  });

  it('reaches `dispatched` only from `ready`', () => {
    // One gate to every external instruction, so dispatch.md §2 has exactly
    // one place to enforce the checkpoint.
    const sources = WORKFLOW_STATES.filter((state) => WORKFLOW_TRANSITIONS[state].includes('dispatched'));
    expect(sources).toEqual(['ready']);
  });

  it('routes a fix back through `ready` rather than straight to `dispatched`', () => {
    expect(WORKFLOW_TRANSITIONS.changes_requested).toContain('ready');
    expect(WORKFLOW_TRANSITIONS.changes_requested).not.toContain('dispatched');
  });

  it('gives `ready` no self-transition, so a failed dispatch is a failure', () => {
    expect(WORKFLOW_TRANSITIONS.ready).not.toContain('ready');
  });

  it('allows self-transitions only where progress genuinely repeats', () => {
    const selfLooping = WORKFLOW_STATES.filter((state) => WORKFLOW_TRANSITIONS[state].includes(state));
    expect(selfLooping.slice().sort()).toEqual([
      'clarifying',
      'reviewing',
      'running',
      'waiting_bot',
    ]);
  });

  it('lets every non-terminal state be cancelled and timed out', () => {
    for (const state of WORKFLOW_STATES.filter((candidate) => !isTerminal(candidate))) {
      expect(WORKFLOW_TRANSITIONS[state], `${state} cannot be cancelled`).toContain('cancelled');
      expect(WORKFLOW_TRANSITIONS[state], `${state} cannot time out`).toContain('timed_out');
    }
  });
});

describe('compare-and-set (workflow-state.md §3.2)', () => {
  it.each(names(casCases))('%s', (name) => {
    const testCase = byName(casCases, name);
    const result = evaluateTransition(
      testCase.stored as unknown as StoredWorkflow,
      testCase.request as unknown as TransitionRequest,
    );
    expect(result.outcome).toBe(testCase.expect_outcome);
    expect(result.reason).toBe(testCase.expect_reason);
  });

  it('covers every rejection mode', () => {
    const reasons = casCases.map((testCase) => testCase.expect_reason);
    for (const reason of [
      'state_mismatch',
      'version_mismatch',
      'illegal_transition',
      'terminal_workflow',
      'duplicate_source_event',
    ]) {
      expect(reasons, `no case exercises ${reason}`).toContain(reason);
    }
  });

  it('treats a replayed source event as an idempotent success, not an error', () => {
    // GS-FR-014 and GS-FR-020. A retried or replayed event must converge on
    // one transition, and the second attempt must not be an error the caller
    // has to invent a recovery for.
    const testCase = byName(casCases, 'replayed_source_event_is_idempotent');
    const result = evaluateTransition(
      testCase.stored as unknown as StoredWorkflow,
      testCase.request as unknown as TransitionRequest,
    );
    expect(result.outcome).toBe('idempotent');
    expect(result.outcome).not.toBe('rejected');
  });

  it('rejects a stale decision whose action version moved on', () => {
    const testCase = byName(casCases, 'version_mismatch_rejects_a_stale_decision');
    expect(
      evaluateTransition(
        testCase.stored as unknown as StoredWorkflow,
        testCase.request as unknown as TransitionRequest,
      ).outcome,
    ).toBe('rejected');
  });

  it('rejects every transition out of a terminal workflow', () => {
    for (const state of TERMINAL_STATES) {
      const result = evaluateTransition(
        { state, pending_action_version: null, committed_source_events: [] },
        {
          expected_state: state,
          expected_action_version: null,
          next_state: 'running',
          source_event_key: 'T0SUPVTEST/C0SUPVTESTA/1756684860.000200',
        },
      );
      expect(result.reason, `${state} must be terminal`).toBe('terminal_workflow');
    }
  });
});

describe('requester authority (workflow-state.md §3.3)', () => {
  it.each(names(authority))('%s', (name) => {
    const testCase = byName(authority, name);
    expect(
      mayRequestTransition(testCase.transition_class as TransitionClass, {
        actor_class: testCase.actor_class as ActorClass,
        is_owner: Boolean(testCase.is_owner),
        is_approver: Boolean(testCase.is_approver),
      }),
    ).toBe(testCase.expect_allowed);
  });

  it('restricts material redirect to the owner alone', () => {
    expect(
      mayRequestTransition('material_redirect', {
        actor_class: 'authorized_human',
        is_owner: false,
        is_approver: true,
      }),
    ).toBe(false);
  });

  it('never lets a bot, an unauthorized human, or Gist request a control transition', () => {
    for (const actor of [
      'kilo',
      'linear',
      'unknown_automation',
      'unauthorized_human',
      'gist_self',
    ] as ActorClass[]) {
      for (const transitionClass of [
        'cancel',
        'approval_grant',
        'material_redirect',
        'ownership_transfer',
      ] as TransitionClass[]) {
        expect(
          mayRequestTransition(transitionClass, {
            actor_class: actor,
            is_owner: true,
            is_approver: true,
          }),
          `${actor} must not request ${transitionClass}`,
        ).toBe(false);
      }
    }
  });

  it('records Gist as the requester when a trusted bot event causes a step', () => {
    const testCase = byName(authority, 'trusted_bot_event_causes_but_does_not_request');
    expect(recordedRequester(testCase.actor_class as ActorClass)).toBe(
      testCase.expect_recorded_requester,
    );
  });

  it('records nobody for an actor class that is never evaluated', () => {
    for (const actor of ['gist_self', 'unknown_automation', 'unauthorized_human'] as ActorClass[]) {
      expect(recordedRequester(actor)).toBeNull();
    }
  });
});

describe('dispatch never advances on hope, and §2.3 says what actually happens', () => {
  const doc = loadContractDoc('workflow-state.md');

  it('names all three delivery outcomes, not just success and failure', () => {
    // §2.3 previously said a timeout or unknown outcome left the workflow
    // `ready` and incremented failures, which contradicted dispatch.md once
    // `indeterminate` existed.
    for (const outcome of ['delivered', 'definitive_failure', 'indeterminate']) {
      expect(doc, `§2.3 does not mention ${outcome}`).toContain(outcome);
    }
  });

  it('no longer claims an ambiguous attempt increments the failure counter', () => {
    expect(doc).toContain('An ambiguous attempt is not a failure');
    expect(doc).toContain('no retry is scheduled');
  });

  it('agrees with dispatch.md about what an indeterminate outcome does', () => {
    // Same fact, two documents: the checkpoint does not move and no retry is
    // permitted from it.
    expect(applyDeliveryOutcome('in_flight', 'indeterminate')).toBe('in_flight');
    expect(
      retryAllowed({
        delivery_state: 'in_flight',
        consecutive_failures: 0,
        max_consecutive_failures: 3,
        workflow_state: 'ready',
      }),
    ).toBe(false);
  });

  it('still counts a definitive failure', () => {
    const result = applyFailedDispatch({
      workflow_state_before: 'ready',
      consecutive_failures_before: 0,
      max_consecutive_failures: 3,
    });
    expect(result.workflow_state).toBe('ready');
    expect(result.consecutive_failures).toBe(1);
  });
});

describe('a Gist-expected state schedules its own next turn (§3.4)', () => {
  it('names the three states that carry `gist`', () => {
    const expectedActor: Record<string, string> = {
      draft: 'gist',
      ready: 'gist',
      changes_requested: 'gist',
    };
    // Stated here as well as in continuation.test.ts because the enqueue is
    // part of the transition's commit, not a separate subsystem.
    expect(Object.keys(expectedActor).sort()).toEqual([
      'changes_requested',
      'draft',
      'ready',
    ]);
    expect(loadContractDoc('workflow-state.md')).toContain('enqueues its own next turn');
  });

  it('says the enqueue is atomic with the transition', () => {
    const doc = loadContractDoc('workflow-state.md');
    expect(doc).toContain('same atomic commit as the transition');
    expect(doc).toContain('enqueue ContinuationEvent');
  });
});

describe('terminal immutability and reopen (workflow-state.md §2.4)', () => {
  const reopen = asRecord(fixture.reopen, 'reopen');
  const terminal = asRecord(reopen.terminal_record, 'terminal_record');
  const reopened = asRecord(reopen.reopened_record, 'reopened_record');

  it('creates a new linked record rather than transitioning out of a terminal state', () => {
    expect(reopened.reopened_from).toBe(terminal.workflow_id);
    expect(reopened.workflow_id).not.toBe(terminal.workflow_id);
    expect(reopened.state).toBe('draft');
  });

  it('leaves the terminal record untouched', () => {
    expect(terminal.state).toBe(reopen.expect_terminal_state_unchanged);
    expect(isTerminal(terminal.state as WorkflowState)).toBe(true);
  });

  it('records the assumption rather than resolving it silently', () => {
    // The PRD names reopen as a human power (§5.1) but lists no `reopened`
    // state. T801 took the reading that a later decision can still change
    // safely, and said so where a reviewer will find it.
    expect(loadContractDoc('workflow-state.md')).toContain('Assumption recorded by T801');
    expect(loadContractDoc('requirements-map.md')).toContain('Open item recorded against the PRD');
  });
});

describe('implementation-then-review lifecycle (workflow-state.md §5)', () => {
  it.each(names(review))('%s', (name) => {
    const testCase = byName(review, name);
    expect(
      isLegalTransition(
        testCase.from as WorkflowState,
        testCase.expect_next_state as WorkflowState,
      ),
      `${String(testCase.from)} → ${String(testCase.expect_next_state)} must be legal`,
    ).toBe(true);
  });

  it('never completes on a PR result alone (GS-FR-030)', () => {
    const testCase = byName(review, 'pr_result_does_not_complete');
    expect(testCase.expect_completes).toBe(false);
    expect(testCase.expect_next_state).not.toBe('completed');
  });

  it('dispatches review as a new action version rather than reusing the implementing turn', () => {
    // GS-FR-029 — an implementation result is not an independent review.
    const testCase = byName(review, 'fresh_review_is_a_new_action_version');
    expect(testCase.expect_new_action_version).toBe(true);
  });

  it('routes findings to changes_requested and back through ready', () => {
    expect(byName(review, 'findings_route_to_changes_requested').expect_next_state).toBe(
      'changes_requested',
    );
    expect(byName(review, 'fix_re_enters_the_dispatch_gate').expect_next_state).toBe('ready');
  });

  it('completes only from an acceptance signal', () => {
    const completing = review.filter((testCase) => testCase.expect_completes === true);
    expect(completing).toHaveLength(1);
    expect(completing[0]?.signal).toBe('review_accepted');
  });
});

describe('audit records (workflow-state.md §6, GS-NFR-005)', () => {
  const required = asStrings(
    fixture.transition_record_required_fields,
    'transition_record_required_fields',
  );

  it('carries prior and next state, actor, action, reason, and outcome', () => {
    for (const field of [
      'prior_state',
      'next_state',
      'actor_class',
      'action_class',
      'reason_class',
      'outcome',
      'occurred_at',
    ]) {
      expect(required, `TransitionRecord is missing ${field}`).toContain(field);
    }
  });

  it('has no field a message body could occupy', () => {
    for (const field of ['text', 'message_text', 'objective', 'summary', 'prompt']) {
      expect(required).not.toContain(field);
    }
  });

  it('sets an outcome class exactly once, from a closed union', () => {
    const outcomes = asStrings(fixture.outcome_classes, 'outcome_classes');
    expect(new Set(outcomes).size).toBe(outcomes.length);
    for (const outcome of ['timeout_inactivity', 'timeout_lifetime', 'compatibility_blocked']) {
      expect(outcomes).toContain(outcome);
    }
  });
});
