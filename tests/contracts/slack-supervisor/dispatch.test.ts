/**
 * dispatch.md — action checkpoints, the delivery state machine, restart
 * reconciliation, and the failure taxonomy
 * (GS-FR-015, GS-FR-020, GS-FR-024, GS-FR-042, GS-FR-043, GS-INV-09,
 * GS-INV-12).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  CHECKPOINT_FIELDS,
  DEFINITIVE_NON_DELIVERY,
  DELIVERY_TRANSITIONS,
  actionClaimAllowed,
  actionClaimKey,
  applyDeliveryOutcome,
  applyFailedDispatch,
  attemptsAreSerial,
  checkpointBindingFailure,
  checkpointValidationFailure,
  deliveryOutcome,
  dispatchBlockedBy,
  dispatchClaimKey,
  failureBehavior,
  isLegalDeliveryTransition,
  looksLikeSlackId,
  mayAbandonInFlight,
  outboxRecoveryAction,
  reconcile,
  reconciliationCanConclude,
  retryAllowed,
  type ActionClass,
  type AttemptResult,
  type DeliveryState,
  type ActorClass,
  type AttemptSequenceEntry,
  type FailureClass,
  type ReconciliationInput,
  type SlackAttemptFailureClass,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('dispatch.v1.json');
const sample = asRecord(fixture.sample_checkpoint, 'sample_checkpoint');
const claimKeys = asArray(fixture.claim_keys, 'claim_keys');
const oneEventOneAction = asArray(fixture.one_event_one_action, 'one_event_one_action');
const inFlightCases = asArray(fixture.in_flight_conflict, 'in_flight_conflict');
const illegalDelivery = asArray(fixture.illegal_delivery_transitions, 'illegal_delivery_transitions');
const outcomeFixture = asRecord(fixture.delivery_outcomes, 'delivery_outcomes');
const outcomeCases = asArray(outcomeFixture.cases, 'delivery_outcomes.cases');
const retryCases = asArray(asRecord(fixture.retry_permission, 'retry_permission').cases, 'retry.cases');
const unbound = asRecord(fixture.unbound_visible_actions, 'unbound_visible_actions');
const oneDirectional = asRecord(
  fixture.reconciliation_is_one_directional,
  'reconciliation_is_one_directional',
);
const failedDispatch = asArray(fixture.failed_dispatch, 'failed_dispatch');
const reconciliation = asArray(fixture.reconciliation, 'reconciliation');
const failureCases = asArray(fixture.failure_behavior, 'failure_behavior');

describe('ActionCheckpoint full schemas (dispatch.md §1)', () => {
  const required = asStrings(fixture.checkpoint_required_fields, 'checkpoint_required_fields');
  const forbidden = asStrings(fixture.checkpoint_forbidden_fields, 'checkpoint_forbidden_fields');
  const bound = asRecord(fixture.bound_checkpoint, 'bound_checkpoint');
  const unboundCheckpoint = asRecord(fixture.unbound_checkpoint, 'unbound_checkpoint');
  const matrix = asRecord(fixture.checkpoint_schema_matrix, 'checkpoint_schema_matrix');
  const variants = [bound, unboundCheckpoint];

  it('pins every required and allowed key exactly', () => {
    expect(required).toEqual([...CHECKPOINT_FIELDS]);
    expect(asStrings(matrix.required_fields, 'matrix.required_fields')).toEqual([...CHECKPOINT_FIELDS]);
    for (const checkpoint of variants) {
      expect(Object.keys(checkpoint).sort()).toEqual([...CHECKPOINT_FIELDS].sort());
      expect(checkpointValidationFailure(checkpoint)).toBeNull();
      expect(checkpointBindingFailure(checkpoint)).toBeNull();
    }
  });

  it.each(forbidden)('does not carry %s', (field) => {
    expect(sample).not.toHaveProperty(field);
  });

  it('records runtime destination and confirmed outgoing identity consistently', () => {
    expect(looksLikeSlackId(String(sample.destination_ref))).toBe(false);
    expect(sample.delivery_state).toBe('delivered');
    expect(typeof sample.slack_message_key).toBe('string');
  });

  it.each(['workflow', 'event'])('%s rejects every missing required field', (kind) => {
    const source = kind === 'workflow' ? bound : unboundCheckpoint;
    for (const field of CHECKPOINT_FIELDS) {
      const candidate = { ...source };
      delete candidate[field];
      expect(checkpointValidationFailure(candidate), `${kind} accepted without ${field}`)
        .toBe('missing_required_field');
    }
  });

  it.each(['workflow', 'event'])('%s rejects every malformed field type', (kind) => {
    const source = kind === 'workflow' ? bound : unboundCheckpoint;
    for (const field of CHECKPOINT_FIELDS) {
      const malformed = field === 'version' || field === 'attempt_count' ? '1' : 7;
      const candidate = { ...source, [field]: malformed };
      expect(checkpointValidationFailure(candidate), `${kind} accepted malformed ${field}`)
        .not.toBeNull();
    }
  });

  it.each(['workflow', 'event'])('%s rejects unknown fields', (kind) => {
    const source = kind === 'workflow' ? bound : unboundCheckpoint;
    expect(checkpointValidationFailure({ ...source, unexpected_checkpoint_field: true }))
      .toBe('unknown_field');
  });

  it('rejects empty IDs, unsafe versions, invalid attempts, and bad timestamps', () => {
    for (const field of ['action_id', 'source_event_key', 'destination_ref']) {
      expect(checkpointValidationFailure({ ...bound, [field]: '' }), field).toBe('invalid_field_value');
    }
    for (const [field, value] of [
      ['version', 0],
      ['version', Number.MAX_SAFE_INTEGER + 1],
      ['attempt_count', -1],
      ['attempt_count', 1.5],
    ] as const) {
      expect(checkpointValidationFailure({ ...bound, [field]: value }), field).toBe('invalid_field_value');
    }
    expect(checkpointValidationFailure({ ...bound, created_at: 'not-a-time' })).toBe('invalid_field_type');
    expect(checkpointValidationFailure({
      ...bound,
      updated_at: '2026-08-31T23:59:59.000Z',
    })).toBe('invalid_state_consistency');
  });

  it('accepts only externally visible action classes with target consistency', () => {
    for (const actionClass of ['reply_user', 'ask_user', 'dispatch_bot', 'follow_up_bot', 'request_approval'] as ActionClass[]) {
      const targeted = actionClass === 'dispatch_bot' || actionClass === 'follow_up_bot';
      expect(checkpointValidationFailure({
        ...bound,
        action_class: actionClass,
        logical_target: targeted ? 'kilo' : null,
      }), actionClass).toBeNull();
    }
    for (const actionClass of ['no_action', 'wait', 'complete', 'fail', 'cancel'] as ActionClass[]) {
      expect(checkpointValidationFailure({ ...bound, action_class: actionClass }), actionClass)
        .toBe('invalid_field_value');
    }
  });

  it('enforces delivery-state and message-key consistency', () => {
    expect(checkpointValidationFailure({ ...bound, slack_message_key: null }))
      .toBe('invalid_state_consistency');
    expect(checkpointValidationFailure({
      ...unboundCheckpoint,
      slack_message_key: 'T0SUPVTEST/C0SUPVTESTA/1756684990.000410',
    })).toBe('invalid_state_consistency');
    expect(checkpointValidationFailure({
      ...unboundCheckpoint,
      delivery_state: 'failed',
      last_failure_class: null,
    })).toBe('invalid_state_consistency');
    expect(checkpointValidationFailure({ ...unboundCheckpoint, delivery_state: 'toString' }))
      .toBe('invalid_field_value');
  });

  it('enforces the bound discriminator completely', () => {
    expect(checkpointValidationFailure({ ...bound, workflow_id: null })).toBe('invalid_bound_checkpoint');
    expect(checkpointValidationFailure({ ...bound, destination_source: 'source_event' }))
      .toBe('invalid_bound_checkpoint');
  });

  it('enforces the unbound discriminator without a fabricated workflow', () => {
    expect(unboundCheckpoint.workflow_id).toBeNull();
    expect(checkpointValidationFailure({ ...unboundCheckpoint, workflow_id: 'wf_supv_0001' }))
      .toBe('invalid_unbound_checkpoint');
    expect(checkpointValidationFailure({ ...unboundCheckpoint, action_class: 'ask_user' }))
      .toBe('invalid_unbound_checkpoint');
    expect(checkpointValidationFailure({ ...unboundCheckpoint, destination_source: 'workflow_binding' }))
      .toBe('invalid_unbound_checkpoint');
  });
});

describe('claim keys (dispatch.md §2)', () => {
  it('keys the action claim on the source event alone', () => {
    const testCase = byName(claimKeys, 'action_claim_is_keyed_on_the_event_alone');
    expect(actionClaimKey(String(testCase.source_event_key))).toBe(
      testCase.expect_action_claim_key,
    );
  });

  it('claims a continuation the same way as a Slack event', () => {
    const testCase = byName(claimKeys, 'a_continuation_claims_the_same_way');
    expect(actionClaimKey(String(testCase.source_event_key))).toBe(
      testCase.expect_action_claim_key,
    );
  });

  it('puts no workflow in the action claim key', () => {
    // A workflow-scoped key would have had nothing to put there for the two
    // visible actions that carry no workflow at all.
    expect(actionClaimKey('T0SUPVTEST/C0SUPVTESTA/1756684860.000200')).not.toContain('wf:');
    expect(unbound.expect_workflow_in_key).toBe(false);
    expect(unbound.expect_workflow_recorded_as_metadata).toBe(true);
  });

  it('keys the dispatch claim on the workflow, action, version, and attempt', () => {
    const testCase = byName(claimKeys, 'dispatch_claim_is_per_attempt');
    expect(
      dispatchClaimKey(
        String(testCase.workflow_id),
        String(testCase.action_id),
        Number(testCase.version),
        Number(testCase.attempt),
      ),
    ).toBe(testCase.expect_dispatch_claim_key);
  });

  it('separates the two claims so a retry cannot re-use the action claim', () => {
    const action = actionClaimKey('T0SUPVTEST/C0SUPVTESTA/1756684860.000200');
    const dispatch = dispatchClaimKey('wf_supv_0001', 'act_supv_0001', 1, 1);
    expect(action).not.toBe(dispatch);
  });
});

describe('one event, at most one durable external action (GS-FR-024, GS-INV-09)', () => {
  it.each(names(oneEventOneAction))('%s', (name) => {
    const testCase = byName(oneEventOneAction, name);
    const result = actionClaimAllowed({
      action_class: testCase.action_class as ActionClass,
      already_claimed: Boolean(testCase.already_claimed),
    });
    expect(result.allowed).toBe(testCase.expect_allowed);
    expect(result.failure_class).toBe(testCase.expect_failure_class ?? null);
  });

  it('refuses a second externally visible action for the same event', () => {
    expect(
      actionClaimAllowed({ action_class: 'reply_user', already_claimed: true }).failure_class,
    ).toBe('claim_conflict');
  });

  it('lets internal actions proceed under a consumed claim', () => {
    // The claim bounds what becomes externally visible, not what the workflow
    // records about itself.
    for (const actionClass of ['no_action', 'wait', 'complete', 'fail', 'cancel'] as ActionClass[]) {
      expect(actionClaimAllowed({ action_class: actionClass, already_claimed: true }).allowed).toBe(
        true,
      );
    }
  });

  it('lets a different event claim independently', () => {
    expect(
      actionClaimAllowed({ action_class: 'follow_up_bot', already_claimed: false }).allowed,
    ).toBe(true);
  });
});

describe('one in-flight action per workflow (dispatch.md §2)', () => {
  it.each(names(inFlightCases))('%s', (name) => {
    const testCase = byName(inFlightCases, name);
    const blocked = dispatchBlockedBy(
      (testCase.in_flight_delivery_state as DeliveryState | null) ?? null,
    );
    expect(blocked === null).toBe(testCase.expect_allowed);
    if (blocked !== null) expect(blocked).toBe(testCase.expect_failure_class);
  });

  it('blocks on pending and in_flight only', () => {
    expect(dispatchBlockedBy('pending')).toBe('in_flight_conflict');
    expect(dispatchBlockedBy('in_flight')).toBe('in_flight_conflict');
    for (const state of ['delivered', 'failed', 'abandoned'] as DeliveryState[]) {
      expect(dispatchBlockedBy(state), state).toBeNull();
    }
  });
});

describe('the delivery state machine (dispatch.md §3)', () => {
  const declared = asRecord(fixture.delivery_transitions, 'delivery_transitions');

  it('declares exactly five delivery states', () => {
    expect(asStrings(fixture.delivery_states, 'delivery_states')).toEqual([
      'pending',
      'in_flight',
      'delivered',
      'failed',
      'abandoned',
    ]);
  });

  it.each(Object.keys(DELIVERY_TRANSITIONS))('%s matches the frozen row', (state) => {
    expect(asStrings(declared[state], `delivery_transitions.${state}`)).toEqual([
      ...DELIVERY_TRANSITIONS[state as DeliveryState],
    ]);
  });

  it.each(names(illegalDelivery))('%s is rejected', (name) => {
    const testCase = byName(illegalDelivery, name);
    expect(
      isLegalDeliveryTransition(
        testCase.from as DeliveryState,
        testCase.to as DeliveryState,
      ),
    ).toBe(false);
  });

  it('makes delivered terminal, so a delivered action is never re-sent', () => {
    expect(DELIVERY_TRANSITIONS.delivered).toEqual([]);
    expect(DELIVERY_TRANSITIONS.abandoned).toEqual([]);
  });

  it('lets in_flight stay in_flight, which is where an ambiguous attempt rests', () => {
    expect(DELIVERY_TRANSITIONS.in_flight).toContain('in_flight');
  });

  it('reaches delivered only from in_flight', () => {
    const sources = (Object.keys(DELIVERY_TRANSITIONS) as DeliveryState[]).filter((state) =>
      DELIVERY_TRANSITIONS[state].includes('delivered'),
    );
    expect(sources).toEqual(['in_flight']);
  });
});

describe('three delivery outcomes, not two (dispatch.md §3.1)', () => {
  it.each(names(outcomeCases))('%s', (name) => {
    const testCase = byName(outcomeCases, name);
    const attempt = testCase.attempt as unknown as AttemptResult;
    expect(deliveryOutcome(attempt)).toBe(testCase.expect_outcome);
    expect(
      applyDeliveryOutcome(
        testCase.current_delivery_state as DeliveryState,
        deliveryOutcome(attempt),
      ),
    ).toBe(testCase.expect_delivery_state);
  });

  it('declares only Slack pre-acceptance rejections as definitive attempt results', () => {
    expect(asStrings(outcomeFixture.definitive_non_delivery, 'definitive_non_delivery')).toEqual([
      ...DEFINITIVE_NON_DELIVERY,
    ]);
    expect(DEFINITIVE_NON_DELIVERY).not.toContain('destination_unresolved');
  });

  it('treats a timeout as indeterminate, never as a failure', () => {
    // The defect this fixes: mapping a timeout to `failed` made it retryable,
    // and a slow post that eventually succeeded would have been sent twice.
    const attempt: AttemptResult = {
      slack_message_key: null,
      error_class: null,
      timed_out: true,
    };
    expect(deliveryOutcome(attempt)).toBe('indeterminate');
    expect(applyDeliveryOutcome('in_flight', deliveryOutcome(attempt))).toBe('in_flight');
  });

  it('treats a transport error as indeterminate', () => {
    expect(
      deliveryOutcome({
        slack_message_key: null,
        error_class: 'slack_transport_error',
        timed_out: false,
      }),
    ).toBe('indeterminate');
  });

  it('treats silence as indeterminate rather than as either answer', () => {
    // An absence of error is not a confirmation, and it is not a disproof.
    expect(
      deliveryOutcome({ slack_message_key: null, error_class: null, timed_out: false }),
    ).toBe('indeterminate');
  });

  it('confirms delivery only from a returned identity', () => {
    for (const errorClass of [null, 'slack_transport_error'] as (SlackAttemptFailureClass | null)[]) {
      expect(
        deliveryOutcome({
          slack_message_key: 'T0SUPVTEST/C0SUPVTESTA/1756684865.000250',
          error_class: errorClass,
          timed_out: false,
        }),
      ).toBe('delivered');
    }
  });

  it('never moves an indeterminate attempt out of in_flight', () => {
    expect(applyDeliveryOutcome('in_flight', 'indeterminate')).toBe('in_flight');
    expect(applyDeliveryOutcome('pending', 'indeterminate')).toBe('pending');
  });
});

describe('retry needs a definitive non-delivery (dispatch.md §3.3)', () => {
  it.each(names(retryCases))('%s', (name) => {
    const testCase = byName(retryCases, name);
    expect(
      retryAllowed({
        delivery_state: testCase.delivery_state as DeliveryState,
        consecutive_failures: Number(testCase.consecutive_failures),
        max_consecutive_failures: Number(testCase.max_consecutive_failures),
        workflow_state: testCase.workflow_state as WorkflowState,
      }),
    ).toBe(testCase.expect_allowed);
  });

  it('never retries from in_flight, whatever the counters say', () => {
    // There is no path from indeterminate to a retry that does not pass
    // through reconciliation first.
    for (const failures of [0, 1, 2]) {
      expect(
        retryAllowed({
          delivery_state: 'in_flight',
          consecutive_failures: failures,
          max_consecutive_failures: 3,
          workflow_state: 'ready',
        }),
      ).toBe(false);
    }
  });

  it('has no route from an ambiguous attempt to a second send', () => {
    // `failed` can only be set by a definitive pre-acceptance rejection, and
    // reconciliation can never produce it.
    expect(reconciliationCanConclude()).not.toContain('failed');
    for (const readable of [true, false]) {
      const result = reconcile({
        delivery_state: 'in_flight',
        own_outgoing_record: false,
        marker_found_in_thread: false,
        thread_readable: readable,
      });
      expect(
        retryAllowed({
          delivery_state: result.delivery_state,
          consecutive_failures: 0,
          max_consecutive_failures: 3,
          workflow_state: result.workflow_state,
        }),
      ).toBe(false);
    }
  });

  it('permits a retry from failed only', () => {
    const states: DeliveryState[] = ['pending', 'in_flight', 'delivered', 'failed', 'abandoned'];
    for (const state of states) {
      expect(
        retryAllowed({
          delivery_state: state,
          consecutive_failures: 0,
          max_consecutive_failures: 3,
          workflow_state: 'ready',
        }),
        state,
      ).toBe(state === 'failed');
    }
  });
});

describe('the unbound visible-action claim (dispatch.md §2, GS-FR-024)', () => {
  const cases = asArray(unbound.cases, 'unbound_visible_actions.cases');

  it.each(names(cases))('%s', (name) => {
    const testCase = byName(cases, name);
    const result = actionClaimAllowed({
      action_class: testCase.action_class as ActionClass,
      already_claimed: Boolean(testCase.already_claimed),
    });
    expect(result.allowed).toBe(testCase.expect_allowed);
    if (testCase.expect_action_claim_key !== undefined) {
      expect(actionClaimKey(String(testCase.source_event_key))).toBe(
        testCase.expect_action_claim_key,
      );
    }
  });

  it('bounds a reply that carries no workflow at all', () => {
    const first = byName(cases, 'unmatched_trusted_bot_notice_is_claimed');
    const retry = byName(cases, 'retried_delivery_of_that_notice_is_refused');
    expect(first.workflow_id).toBeNull();
    expect(first.destination_source).toBe('source_event');
    expect(checkpointValidationFailure(
      asRecord(fixture.unbound_checkpoint, 'unbound_checkpoint'),
    )).toBeNull();
    expect(retry.expect_failure_class).toBe('claim_conflict');
  });

  it('uses one key shape for bound and unbound actions alike', () => {
    const keys = cases.map((testCase) => actionClaimKey(String(testCase.source_event_key)));
    for (const key of keys) expect(key).toMatch(/^ev:/);
  });

  it('resumes an unbound pending command after restart without another claim or workflow ID', () => {
    const checkpoint = asRecord(fixture.unbound_checkpoint, 'unbound_checkpoint');
    expect(checkpoint.workflow_id).toBeNull();
    expect(checkpoint.destination_source).toBe('source_event');
    expect(outboxRecoveryAction('pending')).toBe('resume_pending_first_send');
  });
});

describe('serial retry convergence (dispatch.md §3, GS-FR-043)', () => {
  const retry = asRecord(fixture.retry_convergence, 'retry_convergence');
  const attempts = asArray(retry.attempts, 'retry_convergence.attempts');

  it('shares one action and one version across every serial attempt', () => {
    expect(retry.expect_distinct_actions).toBe(1);
    expect(retry.expect_expected_bot_turns).toBe(1);
    const keys = attempts.map((attempt) =>
      dispatchClaimKey(
        'wf_supv_0001',
        String(retry.action_id),
        Number(retry.version),
        Number(attempt.attempt),
      ),
    );
    expect(new Set(keys).size).toBe(attempts.length);
  });

  it('creates attempt N+1 only after N definitively ended before acceptance', () => {
    expect(attemptsAreSerial(attempts as unknown as AttemptSequenceEntry[])).toBe(true);
    expect(retry.expect_attempts_serial).toBe(true);
    expect(retry.expect_overlapping_attempts).toBe(false);
  });

  it('rejects a mutation that starts a retry after ambiguity', () => {
    const mutated = attempts.map((entry) => ({ ...entry }));
    mutated[1] = { ...mutated[1], prior_outcome: 'indeterminate' };
    expect(attemptsAreSerial(mutated as unknown as AttemptSequenceEntry[])).toBe(false);
  });

  it('rejects a mutation that skips or overlaps an attempt number', () => {
    const mutated = attempts.map((entry) => ({ ...entry }));
    mutated[1] = { ...mutated[1], attempt: 3 };
    expect(attemptsAreSerial(mutated as unknown as AttemptSequenceEntry[])).toBe(false);
  });

  it('cannot legally move a delivered action back to pending', () => {
    expect(isLegalDeliveryTransition('delivered', 'pending')).toBe(false);
  });
});

describe('a failed dispatch does not advance the workflow (GS-FR-042)', () => {
  it.each(names(failedDispatch))('%s', (name) => {
    const testCase = byName(failedDispatch, name);
    const result = applyFailedDispatch({
      workflow_state_before: testCase.workflow_state_before as WorkflowState,
      consecutive_failures_before: Number(testCase.consecutive_failures_before),
      max_consecutive_failures: Number(testCase.max_consecutive_failures),
    });
    expect(result.workflow_state).toBe(testCase.expect_workflow_state);
    expect(result.consecutive_failures).toBe(testCase.expect_consecutive_failures);
    expect(result.expected_actor).toBe(testCase.expect_expected_actor);
  });

  it('never enters dispatched and never expects a bot after a failure', () => {
    const result = applyFailedDispatch({
      workflow_state_before: 'ready',
      consecutive_failures_before: 0,
      max_consecutive_failures: 3,
    });
    expect(result.workflow_state).toBe('ready');
    expect(result.expected_actor).not.toBe('kilo');
    expect(result.expected_actor).not.toBe('linear');
  });

  it('asks a human once the failure limit is reached rather than retrying forever', () => {
    const result = applyFailedDispatch({
      workflow_state_before: 'ready',
      consecutive_failures_before: 2,
      max_consecutive_failures: 3,
    });
    expect(result.workflow_state).toBe('waiting_human');
    expect(result.expected_actor).toBe('human');
  });
});

describe('restart reconciliation (dispatch.md §5, GS-FR-015)', () => {
  it.each(names(reconciliation))('%s', (name) => {
    const testCase = byName(reconciliation, name);
    const result = reconcile(testCase as unknown as ReconciliationInput);
    expect(result.delivery_state).toBe(testCase.expect_delivery_state);
    expect(result.workflow_state).toBe(testCase.expect_workflow_state);
    expect(result.reason_class).toBe(testCase.expect_reason_class);
  });

  it('trusts its own outgoing record before scanning the thread', () => {
    // The send path persists outgoing messages directly, so the local record
    // does not depend on Slack echo behavior.
    expect(
      reconcile({
        delivery_state: 'in_flight',
        own_outgoing_record: true,
        marker_found_in_thread: false,
        thread_readable: false,
      }).delivery_state,
    ).toBe('delivered');
  });

  it('asks a human rather than re-sending when the answer is unknown', () => {
    // A duplicate instruction to a coding bot is a duplicate pull request.
    const result = reconcile({
      delivery_state: 'in_flight',
      own_outgoing_record: false,
      marker_found_in_thread: false,
      thread_readable: false,
    });
    expect(result.workflow_state).toBe('waiting_human');
    expect(result.reason_class).toBe('dispatch_unreconciled');
    // Not `failed`, which would make it retryable; not `delivered`, which
    // nothing proved; not `abandoned`, which would deny a live instruction.
    expect(result.delivery_state).toBe('in_flight');
    expect(
      retryAllowed({
        delivery_state: result.delivery_state,
        consecutive_failures: 0,
        max_consecutive_failures: 3,
        workflow_state: result.workflow_state,
      }),
    ).toBe(false);
  });

  it('never treats absence as proof of non-delivery', () => {
    // The defect this fixes. A post can be accepted and still not be visible
    // yet — event delivery lags, history lags, our own capture may be
    // mid-write — so a readable empty thread looks identical to a send that
    // never happened, and letting it license a retry would break GS-INV-12
    // exactly when the timing was unlucky.
    const result = reconcile({
      delivery_state: 'in_flight',
      own_outgoing_record: false,
      marker_found_in_thread: false,
      thread_readable: true,
    });
    expect(result.delivery_state).toBe('in_flight');
    expect(result.workflow_state).toBe('waiting_human');
    expect(result.reason_class).toBe('dispatch_unreconciled');
    expect(
      retryAllowed({
        delivery_state: result.delivery_state,
        consecutive_failures: 0,
        max_consecutive_failures: 3,
        workflow_state: result.workflow_state,
      }),
    ).toBe(false);
  });

  it('reaches the same answer whether or not the thread read cleanly', () => {
    // `thread_readable` is recorded as audit evidence and deliberately does
    // not change the outcome.
    const readable = reconcile({
      delivery_state: 'in_flight',
      own_outgoing_record: false,
      marker_found_in_thread: false,
      thread_readable: true,
    });
    const unreadable = reconcile({
      delivery_state: 'in_flight',
      own_outgoing_record: false,
      marker_found_in_thread: false,
      thread_readable: false,
    });
    expect(readable).toEqual(unreadable);
    expect(oneDirectional.expect_thread_readable_changes_outcome).toBe(false);
  });

  it('is one-directional: it can conclude delivery, never failure', () => {
    expect(reconciliationCanConclude()).not.toContain('failed');
    expect(
      asStrings(oneDirectional.expect_reachable_delivery_states, 'reachable').slice().sort(),
    ).toEqual([...reconciliationCanConclude()].sort());
    expect(oneDirectional.expect_can_conclude_failed).toBe(false);
    expect(oneDirectional.expect_absence_permits_resend).toBe(false);
  });

  it('reaches only the concludable states across every reconciliation input', () => {
    const concludable = reconciliationCanConclude();
    for (const state of ['pending', 'in_flight'] as DeliveryState[]) {
      for (const own of [true, false]) {
        for (const marker of [true, false]) {
          for (const readable of [true, false]) {
            const result = reconcile({
              delivery_state: state,
              own_outgoing_record: own,
              marker_found_in_thread: marker,
              thread_readable: readable,
            });
            expect(concludable, `${state}/${own}/${marker}/${readable}`).toContain(
              result.delivery_state,
            );
          }
        }
      }
    }
  });

  it('names the delayed-visibility causes that make absence inconclusive', () => {
    const causes = asStrings(oneDirectional.delayed_visibility_causes, 'delayed_visibility_causes');
    expect(causes.length).toBeGreaterThanOrEqual(3);
    expect(causes).toContain('capture_write_in_progress');
  });

  it('runs inline after an indeterminate outcome and at restart only for in_flight', () => {
    expect(asStrings(fixture.reconciliation_callers, 'reconciliation_callers')).toEqual([
      'inline_after_indeterminate_outcome',
      'restart_in_flight',
    ]);
  });

  it('drains a pending durable intent before accepting new events', () => {
    const restart = asRecord(fixture.restart, 'restart');
    expect(outboxRecoveryAction('pending')).toBe('resume_pending_first_send');
    expect(reconcile({
      delivery_state: 'pending',
      own_outgoing_record: false,
      marker_found_in_thread: false,
      thread_readable: false,
    }).delivery_state).toBe('pending');
    expect(restart.expect_drains_pending_outbox_before_new_events).toBe(true);
    expect(restart.expect_pending_first_send_resumed).toBe(true);
  });

  it('replays commands and state, not completed effects', () => {
    const restart = asRecord(fixture.restart, 'restart');
    expect(restart.expect_resends_confirmed_delivered).toBe(false);
    expect(restart.expect_reapplies_committed_transitions).toBe(false);
    expect(restart.expect_rearms_timers_from_durable_timestamps).toBe(true);
    expect(restart.expect_reconciles_before_accepting_new_events).toBe(true);
  });
});

describe('durable command/outbox crash matrix (dispatch.md §2–§5)', () => {
  const crashMatrix = asArray(fixture.crash_matrix, 'crash_matrix');

  it.each(names(crashMatrix))('%s chooses the safe recovery branch', (name) => {
    const testCase = byName(crashMatrix, name);
    if (testCase.durable_state === 'continuation_processing') {
      expect(testCase.expect_recovery).toBe('resume_continuation');
    } else {
      expect(outboxRecoveryAction(testCase.durable_state as DeliveryState)).toBe(testCase.expect_recovery);
    }
    expect(testCase.expect_blind_retry).toBe(false);
    expect(Number(testCase.expect_max_effects)).toBeLessThanOrEqual(1);
  });

  it('cannot lose a first send committed as pending before any Slack call', () => {
    const testCase = byName(crashMatrix, 'pending_checkpoint_committed_call_not_started');
    expect(testCase.slack_call_started).toBe(false);
    expect(testCase.expect_recovery).toBe('resume_pending_first_send');
    expect(testCase.expect_min_effects).toBe(1);
    expect(testCase.expect_max_effects).toBe(1);
  });

  it('never blindly retries once in_flight makes call start ambiguous', () => {
    for (const testCase of crashMatrix.filter((entry) => entry.durable_state === 'in_flight')) {
      expect(testCase.expect_recovery).toBe('reconcile_in_flight');
      expect(testCase.expect_blind_retry).toBe(false);
    }
  });

  it('is mutation-sensitive to abandoning pending on restart', () => {
    expect(outboxRecoveryAction('pending')).not.toBe('skip_terminal');
    expect(outboxRecoveryAction('pending')).not.toBe('reconcile_in_flight');
  });
});

describe('abandoning an in-flight action needs a person (dispatch.md §3.4)', () => {
  const abandonment = asRecord(fixture.abandonment, 'abandonment');
  const cases = asArray(abandonment.cases, 'abandonment.cases');

  it.each(names(cases))('%s', (name) => {
    const testCase = byName(cases, name);
    expect(
      mayAbandonInFlight({
        resolver_actor_class: (testCase.resolver_actor_class as ActorClass | null) ?? null,
        is_owner_or_approver: Boolean(testCase.is_owner_or_approver),
      }),
    ).toBe(testCase.expect_allowed);
  });

  it('never lets the runtime abandon on its own', () => {
    // Writing `abandoned` asserts that nothing was published, which §5.1 says
    // cannot be inferred. A person can go and look at the channel.
    expect(
      mayAbandonInFlight({ resolver_actor_class: null, is_owner_or_approver: true }),
    ).toBe(false);
    expect(abandonment.expect_reconciliation_can_abandon_in_flight).toBe(false);
  });

  it('never lets a bot or an unauthorized human abandon', () => {
    for (const actor of [
      'kilo',
      'linear',
      'gist_self',
      'unknown_automation',
      'unauthorized_human',
    ] as ActorClass[]) {
      expect(
        mayAbandonInFlight({ resolver_actor_class: actor, is_owner_or_approver: true }),
        actor,
      ).toBe(false);
    }
  });

  it.each(asStrings(abandonment.non_grounds, 'non_grounds'))('%s is not grounds', (ground) => {
    expect(ground.length).toBeGreaterThan(0);
    expect(abandonment.expect_reconciliation_can_abandon_in_flight).toBe(false);
  });

  it('rests an unresolved action at waiting_human and terminates only by timeout', () => {
    expect(abandonment.unresolved_workflow_rests_at).toBe('waiting_human');
    expect(asStrings(abandonment.unresolved_terminates_via, 'terminates_via')).toEqual([
      'timeout_inactivity',
      'timeout_lifetime',
    ]);
  });

  it('leaves pending abandonment untouched, since nothing was sent', () => {
    expect(DELIVERY_TRANSITIONS.pending).toContain('abandoned');
    expect(abandonment.expect_pending_abandonment_unaffected).toBe(true);
  });
});

describe('ordering and failure taxonomy (dispatch.md §6, GS-NFR-006)', () => {
  const ordering = asRecord(fixture.ordering, 'ordering');

  it('commits intent, then marks in_flight, then starts the Slack call', () => {
    const order = asStrings(ordering.expect_order, 'expect_order');
    expect(order).toEqual([
      'commit_action_claim_and_pending_outbox',
      'move_pending_to_in_flight',
      'slack_call',
      'record_result',
    ]);
    expect(order.indexOf('move_pending_to_in_flight')).toBeLessThan(order.indexOf('slack_call'));
    expect(ordering.storage_unavailable_expect_sent).toBe(false);
  });

  it.each(names(failureCases.map((entry) => ({ ...entry, name: entry.failure_class }))))(
    '%s behaves as contracted',
    (name) => {
      const testCase = byName(
        failureCases.map((entry) => ({ ...entry, name: entry.failure_class })),
        name,
      );
      const behavior = failureBehavior(testCase.failure_class as FailureClass);
      expect(behavior.retryable).toBe(testCase.expect_retryable);
      expect(behavior.workflow_state).toBe(testCase.expect_workflow_state);
      expect(behavior.reconciles).toBe(testCase.expect_reconciles);
    },
  );

  it('covers every declared failure class', () => {
    const declared = asStrings(fixture.failure_classes, 'failure_classes');
    const covered = failureCases.map((testCase) => testCase.failure_class);
    expect(covered.slice().sort()).toEqual(declared.slice().sort());
  });

  it.each(asStrings(fixture.failure_classes, 'failure_classes'))(
    '%s is a content-free class',
    (failure) => {
      expect(failure).toMatch(/^[a-z][a-z_]*$/);
    },
  );

  it('retries only definitive non-delivery failures', () => {
    const retryable = failureCases
      .filter((testCase) => testCase.expect_retryable === true)
      .map((testCase) => testCase.failure_class);
    expect(retryable.slice().sort()).toEqual([
      'slack_invalid_request',
      'slack_permission_denied',
      'slack_rate_limited',
    ]);
  });

  it('sends an ambiguous transport error to reconciliation rather than to a retry', () => {
    // It reads like a transport hiccup and is the one error class that cannot
    // say whether the post landed. Unresolved it stops at waiting_human — it
    // does not rest in `ready`, which would look dispatchable.
    const behavior = failureBehavior('slack_transport_error');
    expect(behavior.retryable).toBe(false);
    expect(behavior.reconciles).toBe(true);
    expect(behavior.workflow_state).toBe('waiting_human');
  });

  it('never lands an unresolved failure in `ready`', () => {
    for (const testCase of failureCases) {
      if (testCase.expect_retryable === true) continue;
      expect(testCase.expect_workflow_state, String(testCase.failure_class)).not.toBe('ready');
    }
  });

  it('never substitutes a destination or a transport when capability fails', () => {
    // D023 and D029 — no fallback exists, so these stop and ask.
    for (const failure of ['destination_unresolved', 'compatibility_blocked'] as FailureClass[]) {
      const behavior = failureBehavior(failure);
      expect(behavior.retryable).toBe(false);
      expect(behavior.workflow_state).toBe('waiting_human');
    }
  });

  it('preserves exact capture under every failure', () => {
    expect(
      asRecord(fixture.capture_preserved_under_failure, 'capture_preserved_under_failure')
        .expect_exact_capture_continues,
    ).toBe(true);
  });
});
