/**
 * workflow-state.md §7 — bounded autonomy: limits, counting, limit outcomes,
 * and the rules that keep bounds effective after restart
 * (GS-FR-038, GS-FR-039, GS-NFR-007, GS-INV-13).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  admissionAtAutonomyLimit,
  applyCounters,
  consumeLimitGrant,
  deriveResponseDeadlineMs,
  limitGrantKey,
  limitStop,
  mayMintLimitGrant,
  type ActorClass,
  type CountingInput,
  type LimitCheckRecord,
  type WorkflowLimits,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('limits.v1.json');
const limits = fixture.sample_limits as unknown as WorkflowLimits;
const checks = asArray(fixture.checks, 'checks');
const counting = asArray(fixture.counting, 'counting');
const attempts = asRecord(fixture.content_cannot_raise_limits, 'content_cannot_raise_limits');

describe('WorkflowLimits (workflow-state.md §7.1, GS-FR-038)', () => {
  it('declares turns, failures, inactivity, lifetime, and in-flight bounds', () => {
    expect(asStrings(fixture.limit_fields, 'limit_fields')).toEqual([
      'max_turns',
      'max_consecutive_failures',
      'inactivity_timeout_ms',
      'absolute_lifetime_ms',
      'max_in_flight_actions',
    ]);
  });

  it('fixes max_in_flight_actions at one', () => {
    // The one-event/one-action invariant expressed as a limit. Making it
    // tunable would make that invariant a setting.
    expect(asRecord(fixture.fixed_limits, 'fixed_limits').max_in_flight_actions).toBe(1);
    expect(limits.max_in_flight_actions).toBe(1);
  });

  it('uses positive integers for every configurable bound', () => {
    for (const field of [
      'max_turns',
      'max_consecutive_failures',
      'inactivity_timeout_ms',
      'absolute_lifetime_ms',
    ] as const) {
      expect(Number.isSafeInteger(limits[field]), field).toBe(true);
      expect(limits[field], field).toBeGreaterThan(0);
    }
  });
});

describe('limit checks (workflow-state.md §7.3, GS-FR-039)', () => {
  it.each(names(checks))('%s', (name) => {
    const testCase = byName(checks, name);
    const stop = limitStop(
      testCase.record as unknown as LimitCheckRecord,
      limits,
      String(testCase.now),
    );
    expect(stop).toEqual(testCase.expect_stop);
  });

  it('pauses on a turn or failure limit and terminates on a timeout', () => {
    // Turn and failure limits stop and ask because the work may still be
    // salvageable; timeouts terminate because nothing is going to arrive.
    expect(byName(checks, 'turn_limit_asks_a_human').expect_stop).toMatchObject({
      next_state: 'waiting_human',
    });
    expect(byName(checks, 'inactivity_times_out').expect_stop).toMatchObject({
      next_state: 'timed_out',
      outcome_class: 'timeout_inactivity',
    });
    expect(byName(checks, 'lifetime_times_out_even_while_active').expect_stop).toMatchObject({
      next_state: 'timed_out',
      outcome_class: 'timeout_lifetime',
    });
  });

  it('never continues silently once a bound is reached', () => {
    const stopping = checks.filter((testCase) => testCase.expect_stop !== null);
    for (const testCase of stopping) {
      const stop = asRecord(testCase.expect_stop, 'expect_stop');
      expect(['waiting_human', 'timed_out']).toContain(stop.next_state);
      expect(stop.reason_class).toBe('limit_reached');
    }
  });

  it('prefers the terminal answer when a timeout and a turn limit both hold', () => {
    const stop = limitStop(
      {
        state: 'running',
        turn_count: limits.max_turns,
        consecutive_failures: 0,
        created_at: '2026-09-01T00:00:00.000Z',
        last_activity_at: '2026-09-02T00:00:00.000Z',
      },
      limits,
      '2026-09-02T00:00:30.000Z',
    );
    expect(stop?.next_state).toBe('timed_out');
    expect(stop?.outcome_class).toBe('timeout_lifetime');
  });

  it('does not re-check a terminal workflow', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'timed_out'] as WorkflowState[]) {
      expect(
        limitStop(
          {
            state,
            turn_count: 9999,
            consecutive_failures: 999,
            created_at: '2026-09-01T00:00:00.000Z',
            last_activity_at: '2026-09-01T00:00:00.000Z',
          },
          limits,
          '2026-09-30T00:00:00.000Z',
        ),
        state,
      ).toBeNull();
    }
  });
});

describe('counting (workflow-state.md §7.2)', () => {
  it.each(names(counting))('%s', (name) => {
    const testCase = byName(counting, name);
    const result = applyCounters(
      testCase.transition as unknown as CountingInput,
      Number(testCase.turn_count_before),
      Number(testCase.consecutive_failures_before),
    );
    expect(result.turn_count).toBe(testCase.expect_turn_count);
    expect(result.consecutive_failures).toBe(testCase.expect_consecutive_failures);
  });

  it('consumes a turn only for a new supervisor event', () => {
    expect(
      applyCounters({ committed: true, source_event_is_new: false, next_state: 'waiting_bot' }, 4, 0)
        .turn_count,
    ).toBe(4);
  });

  it('resets failures on progress, review, and completion but not on waiting_human', () => {
    for (const state of ['running', 'reviewing', 'completed'] as WorkflowState[]) {
      expect(
        applyCounters({ committed: true, source_event_is_new: true, next_state: state }, 1, 2)
          .consecutive_failures,
        state,
      ).toBe(0);
    }
    expect(
      applyCounters(
        { committed: true, source_event_is_new: true, next_state: 'waiting_human' },
        1,
        2,
      ).consecutive_failures,
    ).toBe(2);
  });

  it('counts nothing for a rejected transition', () => {
    const result = applyCounters(
      { committed: false, source_event_is_new: true, next_state: 'running' },
      9,
      2,
    );
    expect(result).toEqual({ turn_count: 9, consecutive_failures: 2 });
  });
});

describe('limits survive restart (GS-NFR-007)', () => {
  const persistence = asRecord(fixture.restart_persistence, 'restart_persistence');
  const atCreation = persistence.limits_at_creation as unknown as WorkflowLimits;
  const afterRestart = persistence.configuration_after_restart as unknown as WorkflowLimits;

  it('reads the effective limits from the record, not from configuration', () => {
    expect(persistence.expect_effective_limits_source).toBe('record');
    expect(afterRestart.max_turns).toBeGreaterThan(atCreation.max_turns);
  });

  it('still stops a workflow whose record-level turn limit is reached', () => {
    // The laxer configuration must not rescue a workflow already at its bound.
    const record: LimitCheckRecord = {
      state: 'running',
      turn_count: atCreation.max_turns,
      consecutive_failures: 0,
      created_at: '2026-09-01T00:00:00.000Z',
      last_activity_at: '2026-09-01T00:10:00.000Z',
    };
    expect(limitStop(record, atCreation, '2026-09-01T00:20:00.000Z')?.next_state).toBe(
      'waiting_human',
    );
    expect(limitStop(record, afterRestart, '2026-09-01T00:20:00.000Z')).toBeNull();
  });

  it('derives timers from durable timestamps', () => {
    expect(asStrings(persistence.expect_timers_derived_from, 'expect_timers_derived_from')).toEqual([
      'created_at',
      'last_activity_at',
    ]);
  });
});

describe('the response deadline is a projection of these limits (§7.1)', () => {
  const deadline = asRecord(fixture.response_deadline, 'response_deadline');
  const deadlineLimits = deadline.limits as unknown as WorkflowLimits;
  const cases = asArray(deadline.cases, 'response_deadline.cases');

  it.each(names(cases))('%s', (name) => {
    const testCase = byName(cases, name);
    expect(
      deriveResponseDeadlineMs(deadlineLimits, String(deadline.created_at), String(testCase.now)),
    ).toBe(testCase.expect_deadline_ms);
  });

  it('is not model-supplied and cannot exceed the stored bounds', () => {
    expect(deadline.expect_model_supplied).toBe(false);
    expect(deadline.expect_can_exceed_inactivity_timeout).toBe(false);
    expect(deadline.expect_can_outlive_the_workflow).toBe(false);
  });

  it('agrees with the limit check about when the workflow is out of time', () => {
    // The deadline going null and the lifetime timeout firing are the same
    // fact seen from two places; they must not disagree.
    const now = '2026-09-02T00:00:00.000Z';
    expect(deriveResponseDeadlineMs(deadlineLimits, String(deadline.created_at), now)).toBeNull();
    expect(
      limitStop(
        {
          state: 'ready',
          turn_count: 1,
          consecutive_failures: 0,
          created_at: String(deadline.created_at),
          last_activity_at: String(deadline.created_at),
        },
        deadlineLimits,
        now,
      )?.outcome_class,
    ).toBe('timeout_lifetime');
  });
});

describe('human control remains admissible at an autonomy limit (§7.3)', () => {
  const control = asRecord(fixture.human_control_at_limit, 'human_control_at_limit');
  const cases = asArray(control.cases, 'human_control_at_limit.cases');

  it.each(names(cases))('%s', (name) => {
    const testCase = byName(cases, name);
    const input = {
      actor_class: testCase.actor_class as ActorClass,
      is_owner_or_approver: Boolean(testCase.is_owner_or_approver),
      intent: (testCase.intent as 'status' | 'pause' | 'continue' | 'redirect' | 'cancel' | null) ?? null,
      limit_reached: true,
      grant_exists: Boolean(testCase.grant_exists),
      grant_consumed: Boolean(testCase.grant_consumed),
    };
    expect(admissionAtAutonomyLimit(input)).toBe(testCase.expect_admission);
    expect(mayMintLimitGrant({
      actor_class: input.actor_class,
      is_owner_or_approver: input.is_owner_or_approver,
      intent: input.intent,
      existing_event_grant: input.grant_exists,
    })).toBe(testCase.expect_may_mint);
  });

  it('admits continue exactly once without resetting or raising counters', () => {
    const grant = asRecord(control.grant, 'human_control_at_limit.grant');
    expect(limitGrantKey(String(control.workflow_id), String(grant.source_event_key))).toBe(grant.grant_key);
    expect(grant.opportunities).toBe(1);
    const used = consumeLimitGrant('available', limits.max_turns);
    expect(used).toEqual({
      state: 'consumed',
      turn_count: limits.max_turns + 1,
      opportunity_used: true,
    });
    expect(consumeLimitGrant('consumed', used.turn_count)).toEqual({
      state: 'consumed',
      turn_count: used.turn_count,
      opportunity_used: false,
    });
    expect(grant.expect_counters_reset).toBe(false);
    expect(grant.expect_limits_raised).toBe(false);
    expect(grant.expect_limit_applies_after_consumption).toBe(true);
  });

  it('processes redirect and cancel on the control plane despite the limit', () => {
    expect(byName(cases, 'redirect_is_control_only').expect_admission).toBe('control_only');
    expect(byName(cases, 'cancel_is_control_only').expect_admission).toBe('control_only');
  });

  it('cannot mint a second grant from a duplicate human event after restart', () => {
    const duplicate = byName(cases, 'duplicate_continue_cannot_mint_again');
    expect(duplicate.grant_exists).toBe(true);
    expect(duplicate.grant_consumed).toBe(true);
    expect(duplicate.expect_admission).toBe('blocked');
    const restart = byName(cases, 'restart_resumes_unconsumed_grant');
    expect(restart.grant_exists).toBe(true);
    expect(restart.grant_consumed).toBe(false);
    expect(restart.expect_admission).toBe('one_granted_opportunity');
    expect(restart.expect_may_mint).toBe(false);
  });

  it('keeps autonomous bot and continuation events blocked at the limit', () => {
    for (const name of ['bot_event_at_limit_is_blocked', 'continuation_at_limit_is_blocked']) {
      expect(byName(cases, name).expect_admission).toBe('blocked');
    }
  });

  it('is mutation-sensitive to granting a duplicate or autonomous event', () => {
    expect(mayMintLimitGrant({
      actor_class: 'authorized_human',
      is_owner_or_approver: true,
      intent: 'continue',
      existing_event_grant: true,
    })).toBe(false);
    expect(admissionAtAutonomyLimit({
      actor_class: 'kilo',
      is_owner_or_approver: false,
      intent: null,
      limit_reached: true,
      grant_exists: false,
      grant_consumed: false,
    })).toBe('blocked');
  });
});

describe('channel content cannot raise a limit (workflow-state.md §7.4)', () => {
  const cases = asArray(attempts.attempts, 'content_cannot_raise_limits.attempts');

  it.each(cases.map((testCase) => String(testCase.claim) + ' by ' + String(testCase.actor_class)))(
    '%s has no effect',
    (label) => {
      const testCase = cases.find(
        (candidate) => `${String(candidate.claim)} by ${String(candidate.actor_class)}` === label,
      );
      expect(testCase?.expect_effect).toBe('none');
    },
  );

  it('covers the owner, every automation class, and the model itself', () => {
    const actors = cases.map((testCase) => testCase.actor_class);
    for (const actor of [
      'authorized_human',
      'kilo',
      'linear',
      'unknown_automation',
      'gist_self',
      'model_output',
    ]) {
      expect(actors, `no attempt from ${actor}`).toContain(actor);
    }
  });

  it('makes continuing after a limit stop consume one grant under the same limits', () => {
    const continuation = asRecord(
      fixture.continue_after_a_limit_stop,
      'continue_after_a_limit_stop',
    );
    expect(continuation.expect_granted_opportunities).toBe(1);
    expect(continuation.expect_counters_reset).toBe(false);
    expect(continuation.expect_limits_changed).toBe(false);
    expect(continuation.expect_stops_again).toBe(true);
  });
});
