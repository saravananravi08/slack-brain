/**
 * enrollment.md — membership-authoritative enrollment, the capture floor, and
 * retention after leave (CM-FR-001…006, CM-INV-10).
 */

import { describe, expect, it } from 'vitest';

import { asArray, byName, loadFixture } from './helpers.js';
import { compareMessageTs, withinCaptureFloor } from './reference-rules.js';

const fixture = loadFixture('enrollment.v1.json');
const records = asArray(fixture.records, 'records');
const facts = asArray(fixture.membership_facts, 'membership_facts');
const floorCases = asArray(fixture.capture_floor_cases, 'capture_floor_cases');
const failClosed = asArray(fixture.fail_closed_cases, 'fail_closed_cases');

function enrollment(name: string): Record<string, unknown> {
  return byName(records, name).enrollment as Record<string, unknown>;
}

describe('enrollment record shape', () => {
  it.each(['channel_a_enrolled', 'channel_b_enrolled', 'channel_a_left', 'channel_a_rejoined'])(
    '%s carries every required field',
    (name) => {
      const record = enrollment(name);
      for (const field of [
        'contract_version',
        'boundary_id',
        'workspace_id',
        'channel_id',
        'state',
        'epoch',
        'enrolled_at',
        'capture_floor_ts',
        'left_at',
        'membership_source',
        'membership_confirmed_at',
        'retention',
      ]) {
        expect(record, `${name} is missing ${field}`).toHaveProperty(field);
      }
      expect(record.boundary_id).toBe(`ch:${record.workspace_id}:${record.channel_id}`);
    },
  );

  it('never carries a retention mode other than "retained"', () => {
    // enrollment.md §1: the one-value union is the type-level statement that
    // no membership transition can carry a deletion mode.
    for (const record of records) {
      expect((record.enrollment as Record<string, unknown>).retention).toBe('retained');
    }
  });

  it('sets left_at iff the state is left', () => {
    for (const record of records) {
      const value = record.enrollment as Record<string, unknown>;
      expect(value.left_at === null).toBe(value.state === 'enrolled');
    }
  });

  it('enrolls two channels simultaneously and independently (CM-FR-003)', () => {
    const a = enrollment('channel_a_enrolled');
    const b = enrollment('channel_b_enrolled');
    expect(a.boundary_id).not.toBe(b.boundary_id);
    expect(a.state).toBe('enrolled');
    expect(b.state).toBe('enrolled');
  });
});

describe('capture floor (CM-FR-006, no backfill)', () => {
  it.each(floorCases.map((c) => c.name as string))('%s', (name) => {
    const testCase = byName(floorCases, name);
    const record = enrollment(testCase.enrollment as string);
    expect(
      withinCaptureFloor(record.capture_floor_ts as string, testCase.message_ts as string),
    ).toBe(testCase.expect_within_floor);
  });

  it('orders equal for the precision pair without collapsing identity (CM-INV-06)', () => {
    const testCase = byName(floorCases, 'floor_comparison_never_uses_float');
    const record = enrollment('channel_a_enrolled');
    const floor = record.capture_floor_ts as string;
    const ts = testCase.message_ts as string;

    expect(compareMessageTs(ts, floor)).toBe(0);
    expect(testCase.expect_ordering_equal_to_floor).toBe(true);
    // Ordering equality is not identity equality: the strings differ, so the
    // message keys differ, so these remain two distinct messages.
    expect(ts).not.toBe(floor);
    expect(testCase.expect_distinct_identity_from_floor).toBe(true);
  });
});

describe('membership is authoritative and idempotent', () => {
  it('replaying a join does not move the floor or bump the epoch (CM-FR-014)', () => {
    const replay = byName(facts, 'replayed_join_is_idempotent');
    const record = enrollment('channel_a_enrolled');
    expect(replay.expect_result).toBe('unchanged');
    expect(replay.expect_epoch).toBe(record.epoch);
    expect(replay.expect_capture_floor_ts).toBe(record.capture_floor_ts);
  });

  it('an older join never moves the floor backwards', () => {
    const older = byName(facts, 'older_join_does_not_move_floor_backwards');
    const record = enrollment('channel_a_enrolled');
    const factTs = (older.fact as Record<string, unknown>).ts as string;

    expect(compareMessageTs(factTs, record.capture_floor_ts as string)).toBe(-1);
    expect(older.expect_capture_floor_ts).toBe(record.capture_floor_ts);
  });

  it.each([
    'unknown_channel_is_not_enrolled',
    'left_channel_denies_new_capture',
    'configuration_cannot_enroll',
    'message_traffic_is_not_membership_evidence',
  ])('%s fails closed', (name) => {
    expect(byName(failClosed, name).expect_capture_deny_reason).toBe('channel_not_enrolled');
  });

  it('configuration and traffic are explicitly non-evidence', () => {
    // enrollment.md §2 rules 1 and 2. Both fixtures deliberately carry the
    // thing that might be mistaken for enrollment, and still deny.
    expect(byName(failClosed, 'configuration_cannot_enroll').present_in_config_allowlist).toBe(true);
    expect(
      byName(failClosed, 'message_traffic_is_not_membership_evidence').observed_message_events,
    ).toBeGreaterThan(0);
  });
});

describe('leaving retains memory (CM-FR-005, CM-INV-10)', () => {
  const left = byName(records, 'channel_a_left');
  const retained = left.expect_retained as Record<string, unknown>;

  it('deletes nothing', () => {
    expect(retained.messages_deleted).toBe(0);
    expect(retained.embeddings_deleted).toBe(0);
    expect(retained.summary_deleted).toBe(false);
    expect(retained.observations_deleted).toBe(false);
  });

  it('calls no delete primitive', () => {
    expect(retained.delete_primitive_calls).toBe(0);
  });

  it('preserves the floor and epoch across the leave', () => {
    const enrolled = enrollment('channel_a_enrolled');
    const afterLeave = enrollment('channel_a_left');
    expect(afterLeave.capture_floor_ts).toBe(enrolled.capture_floor_ts);
    expect(afterLeave.epoch).toBe(enrolled.epoch);
  });
});

describe('re-join (enrollment.md §4)', () => {
  const enrolled = enrollment('channel_a_enrolled');
  const rejoined = enrollment('channel_a_rejoined');

  it('keeps the same boundary — memory follows the channel, not the visit', () => {
    expect(rejoined.boundary_id).toBe(enrolled.boundary_id);
  });

  it('increments the epoch and sets a later floor, leaving the gap unfilled', () => {
    expect(rejoined.epoch).toBe((enrolled.epoch as number) + 1);
    expect(
      compareMessageTs(rejoined.capture_floor_ts as string, enrolled.capture_floor_ts as string),
    ).toBe(1);
    expect(rejoined.left_at).toBeNull();
  });
});
