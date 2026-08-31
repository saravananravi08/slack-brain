/**
 * dispatch.md — action checkpoints, the delivery state machine, restart
 * reconciliation, and the failure taxonomy
 * (GS-FR-015, GS-FR-020, GS-FR-024, GS-FR-042, GS-FR-043, GS-INV-09,
 * GS-INV-12).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  DEFINITIVE_NON_DELIVERY,
  DELIVERY_TRANSITIONS,
  actionClaimAllowed,
  actionClaimKey,
  applyDeliveryOutcome,
  applyFailedDispatch,
  deliveryOutcome,
  dispatchBlockedBy,
  dispatchClaimKey,
  failureBehavior,
  isLegalDeliveryTransition,
  looksLikeSlackId,
  reconcile,
  reconciliationCanConclude,
  retryAllowed,
  type ActionClass,
  type AttemptResult,
  type DeliveryState,
  type FailureClass,
  type ReconciliationInput,
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

describe('ActionCheckpoint (dispatch.md §1)', () => {
  const required = asStrings(fixture.checkpoint_required_fields, 'checkpoint_required_fields');
  const forbidden = asStrings(fixture.checkpoint_forbidden_fields, 'checkpoint_forbidden_fields');

  it.each(required)('carries %s', (field) => {
    expect(sample).toHaveProperty(field);
  });

  it.each(forbidden)('does not carry %s', (field) => {
    expect(sample).not.toHaveProperty(field);
  });

  it('records the destination as an opaque handle, not as an input', () => {
    // destination_ref is resolved from the binding, so recording it makes the
    // audit complete without making the record a place to inject one.
    expect(looksLikeSlackId(String(sample.destination_ref))).toBe(false);
  });

  it('records the outgoing message identity only on a delivered action', () => {
    expect(sample.delivery_state).toBe('delivered');
    expect(typeof sample.slack_message_key).toBe('string');
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

  it('declares the same definitive set as the contract', () => {
    expect(asStrings(outcomeFixture.definitive_non_delivery, 'definitive_non_delivery')).toEqual([
      ...DEFINITIVE_NON_DELIVERY,
    ]);
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
    for (const errorClass of [null, 'slack_transport_error'] as (FailureClass | null)[]) {
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
    // Without an event-global key this action had no key to claim, so a Slack
    // retry could have produced a second notification.
    const first = byName(cases, 'unmatched_trusted_bot_notice_is_claimed');
    const retry = byName(cases, 'retried_delivery_of_that_notice_is_refused');
    expect(first.workflow_id).toBeNull();
    expect(retry.expect_failure_class).toBe('claim_conflict');
  });

  it('uses one key shape for bound and unbound actions alike', () => {
    const keys = cases.map((testCase) => actionClaimKey(String(testCase.source_event_key)));
    for (const key of keys) expect(key).toMatch(/^ev:/);
  });
});

describe('retry convergence (dispatch.md §3, GS-FR-043)', () => {
  const retry = asRecord(fixture.retry_convergence, 'retry_convergence');
  const attempts = asArray(retry.attempts, 'retry_convergence.attempts');

  it('shares one action and one version across every attempt', () => {
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
    for (const key of keys) {
      expect(key).toContain(`act:${String(retry.action_id)}|v:${String(retry.version)}`);
    }
  });

  it('stops a slow attempt that completes after a retry already succeeded', () => {
    const late = attempts.find((attempt) => attempt.expect_additional_dispatch === false);
    expect(late, 'no fixture covers a late attempt').toBeDefined();
    expect(late?.expect_delivery_state).toBe('delivered');
    // The compare-and-set on `delivered` is what makes this converge: the
    // first success wins and later attempts observe it.
    expect(attempts.filter((attempt) => attempt.result === 'delivered').length).toBeGreaterThan(1);
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

  it('runs inline after an indeterminate outcome and again at restart', () => {
    expect(asStrings(fixture.reconciliation_callers, 'reconciliation_callers')).toEqual([
      'inline_after_indeterminate_outcome',
      'restart',
    ]);
  });

  it('replays state, not effects', () => {
    const restart = asRecord(fixture.restart, 'restart');
    expect(restart.expect_resends_confirmed_delivered).toBe(false);
    expect(restart.expect_reapplies_committed_transitions).toBe(false);
    expect(restart.expect_rearms_timers_from_durable_timestamps).toBe(true);
    expect(restart.expect_reconciles_before_accepting_new_events).toBe(true);
  });
});

describe('ordering and failure taxonomy (dispatch.md §6, GS-NFR-006)', () => {
  const ordering = asRecord(fixture.ordering, 'ordering');

  it('writes the checkpoint before the Slack call', () => {
    // A process that sends first and records after cannot survive its own crash.
    const order = asStrings(ordering.expect_order, 'expect_order');
    expect(order.indexOf('write_checkpoint')).toBeLessThan(order.indexOf('slack_call'));
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
    // say whether the post landed.
    const behavior = failureBehavior('slack_transport_error');
    expect(behavior.retryable).toBe(false);
    expect(behavior.reconciles).toBe(true);
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
