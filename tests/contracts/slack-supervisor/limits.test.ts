/**
 * workflow-state.md §7 — bounded autonomy: limits, counting, limit outcomes,
 * and the rules that keep bounds effective after restart
 * (GS-FR-038, GS-FR-039, GS-NFR-007, GS-INV-13).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  applyCounters,
  limitStop,
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

  it('covers the owner as well as every automation class', () => {
    const actors = cases.map((testCase) => testCase.actor_class);
    for (const actor of ['authorized_human', 'kilo', 'linear', 'unknown_automation', 'gist_self']) {
      expect(actors, `no attempt from ${actor}`).toContain(actor);
    }
  });

  it('makes continuing after a limit stop produce a new action under the same limits', () => {
    const continuation = asRecord(
      fixture.continue_after_a_limit_stop,
      'continue_after_a_limit_stop',
    );
    expect(continuation.expect_limits_changed).toBe(false);
    expect(continuation.expect_stops_again).toBe(true);
  });
});
