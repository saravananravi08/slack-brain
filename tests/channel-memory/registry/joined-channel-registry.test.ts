import { afterEach, describe, expect, it } from 'vitest';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  compareMessageTs,
  type MembershipFact,
} from '../../../src/channel-memory/registry/index.js';
import {
  createHarness,
  joinedFact,
  leftFact,
  SYNTHETIC,
  type RegistryHarness,
} from './helpers.js';

const harnesses: RegistryHarness[] = [];

async function harness(): Promise<RegistryHarness> {
  const value = await createHarness();
  harnesses.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(({ storage }) => storage.close()));
});

describe('JoinedChannelRegistry membership lifecycle', () => {
  it('enrolls two channels independently and lists deterministic records', async () => {
    const { registry } = await harness();

    expect(await registry.applyMembershipFact(joinedFact())).toEqual({
      outcome: 'inserted',
      reason: null,
    });
    expect(await registry.applyMembershipFact(joinedFact({
      boundary_id: SYNTHETIC.boundaryB,
      channel_id: SYNTHETIC.channelB,
      event_id: 'Ev0CHANTEST0003',
    }))).toEqual({ outcome: 'inserted', reason: null });

    const records = await registry.list();
    expect(records.map(({ boundary_id }) => boundary_id)).toEqual([
      SYNTHETIC.boundaryA,
      SYNTHETIC.boundaryB,
    ]);
    expect(records.every(({ state, epoch }) => state === 'enrolled' && epoch === 1)).toBe(true);
  });

  it('persists the frozen enrollment shape from a verified join', async () => {
    const { registry } = await harness();
    await registry.applyMembershipFact(joinedFact());

    expect(await registry.enrollmentFor(SYNTHETIC.boundaryA)).toEqual({
      contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
      boundary_id: SYNTHETIC.boundaryA,
      workspace_id: SYNTHETIC.workspaceId,
      channel_id: SYNTHETIC.channelA,
      state: 'enrolled',
      epoch: 1,
      enrolled_at: '2026-01-05T09:00:00.000Z',
      capture_floor_ts: SYNTHETIC.firstJoinTs,
      left_at: null,
      membership_source: 'member_joined_channel',
      membership_confirmed_at: '2026-01-05T09:00:00.000Z',
      retention: 'retained',
    });
  });

  it('makes exact and older join replays no-ops without moving the floor', async () => {
    const { registry } = await harness();
    await registry.applyMembershipFact(joinedFact());

    expect(await registry.applyMembershipFact(joinedFact())).toEqual({
      outcome: 'unchanged',
      reason: null,
    });
    expect(await registry.applyMembershipFact(joinedFact({
      ts: '1767500000.000100',
      event_id: 'Ev0CHANTEST0004',
    }))).toEqual({ outcome: 'unchanged', reason: 'stale_membership_fact' });

    const record = await registry.enrollmentFor(SYNTHETIC.boundaryA);
    expect(record).toMatchObject({ epoch: 1, capture_floor_ts: SYNTHETIC.firstJoinTs });
  });

  it('deactivates on leave without changing epoch or floor, then re-enrolls at epoch 2', async () => {
    const { registry } = await harness();
    await registry.applyMembershipFact(joinedFact());

    expect(await registry.applyMembershipFact(leftFact())).toEqual({
      outcome: 'updated',
      reason: null,
    });
    expect(await registry.applyMembershipFact(leftFact())).toEqual({
      outcome: 'unchanged',
      reason: null,
    });

    const left = await registry.enrollmentFor(SYNTHETIC.boundaryA);
    expect(left).toMatchObject({
      state: 'left',
      epoch: 1,
      capture_floor_ts: SYNTHETIC.firstJoinTs,
      left_at: '2026-01-06T17:00:00.000Z',
      retention: 'retained',
    });
    expect(await registry.list({ state: 'enrolled' })).toEqual([]);
    expect(await registry.contextEligibilityFor(SYNTHETIC.boundaryA)).toEqual({
      context_allowed: true,
      reason: null,
    });

    const rejoin = joinedFact({
      ts: SYNTHETIC.rejoinTs,
      event_id: 'Ev0CHANTEST0005',
    });
    expect(await registry.applyMembershipFact(rejoin)).toEqual({
      outcome: 'updated',
      reason: null,
    });
    expect(await registry.applyMembershipFact(rejoin)).toEqual({
      outcome: 'unchanged',
      reason: null,
    });
    expect(await registry.enrollmentFor(SYNTHETIC.boundaryA)).toMatchObject({
      state: 'enrolled',
      epoch: 2,
      capture_floor_ts: SYNTHETIC.rejoinTs,
      left_at: null,
      retention: 'retained',
    });
  });

  it('accepts only explicit Slack-confirmed lifecycle facts', async () => {
    const { registry } = await harness();
    const unverified = {
      ...joinedFact(),
      verification: 'configuration',
    } as unknown as MembershipFact;
    const messageTraffic = {
      ...joinedFact(),
      kind: 'message',
    } as unknown as MembershipFact;
    const inconsistentBoundary = joinedFact({ channel_id: SYNTHETIC.channelB });

    for (const fact of [unverified, messageTraffic, inconsistentBoundary]) {
      expect(await registry.applyMembershipFact(fact)).toEqual({
        outcome: 'rejected',
        reason: 'invalid_membership_fact',
      });
    }
    expect(await registry.list()).toEqual([]);
  });

  it('does not create an incomplete record for a confirmed leave of an unknown channel', async () => {
    const { registry } = await harness();

    expect(await registry.applyMembershipFact(leftFact())).toEqual({
      outcome: 'unchanged',
      reason: 'channel_not_enrolled',
    });
    expect(await registry.enrollmentFor(SYNTHETIC.boundaryA)).toBeNull();
  });

  it('supports positive API confirmation and explicit operator reconciliation', async () => {
    const { registry } = await harness();

    expect(await registry.applyMembershipFact({
      contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
      boundary_id: SYNTHETIC.boundaryA,
      workspace_id: SYNTHETIC.workspaceId,
      channel_id: SYNTHETIC.channelA,
      verification: 'slack_gist_membership',
      kind: 'conversations_members',
      state: 'enrolled',
      ts: SYNTHETIC.firstJoinTs,
    })).toEqual({ outcome: 'inserted', reason: null });

    expect(await registry.applyMembershipFact({
      contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
      boundary_id: SYNTHETIC.boundaryA,
      workspace_id: SYNTHETIC.workspaceId,
      channel_id: SYNTHETIC.channelA,
      verification: 'slack_gist_membership',
      kind: 'operator_reconciliation',
      state: 'left',
      ts: SYNTHETIC.leaveTs,
    })).toEqual({ outcome: 'updated', reason: null });

    expect(await registry.enrollmentFor(SYNTHETIC.boundaryA)).toMatchObject({
      state: 'left',
      membership_source: 'operator_reconciliation',
    });
  });
});

describe('fail-closed enrollment checks', () => {
  it('enforces the capture floor without float conversion', async () => {
    const { registry } = await harness();
    await registry.applyMembershipFact(joinedFact());

    expect(await registry.captureEligibilityFor(
      SYNTHETIC.boundaryA,
      '1767603600.0001',
    )).toEqual({ capture: true, reason: null, enrollment_epoch: 1 });
    expect(compareMessageTs('1767603600.0001', SYNTHETIC.firstJoinTs)).toBe(0);
    expect(await registry.captureEligibilityFor(
      SYNTHETIC.boundaryA,
      '1767500000.000100',
    )).toEqual({
      capture: false,
      reason: 'before_capture_floor',
      enrollment_epoch: 1,
    });
  });

  it('denies unknown, left, and malformed channels', async () => {
    const { registry } = await harness();
    await registry.applyMembershipFact(joinedFact());
    await registry.applyMembershipFact(leftFact());

    expect(await registry.captureEligibilityFor(
      SYNTHETIC.boundaryA,
      SYNTHETIC.rejoinTs,
    )).toEqual({ capture: false, reason: 'channel_not_enrolled', enrollment_epoch: null });
    expect(await registry.captureEligibilityFor(
      SYNTHETIC.unknownBoundary,
      SYNTHETIC.rejoinTs,
    )).toEqual({ capture: false, reason: 'channel_not_enrolled', enrollment_epoch: null });
    expect(await registry.captureEligibilityFor(
      'ch:T0CHANTEST:not-a-channel' as typeof SYNTHETIC.boundaryA,
      SYNTHETIC.rejoinTs,
    )).toEqual({ capture: false, reason: 'malformed_event', enrollment_epoch: null });
    expect(await registry.contextEligibilityFor(
      'dm:T0CHANTEST:U0CHANTEST' as typeof SYNTHETIC.boundaryA,
    )).toEqual({ context_allowed: false, reason: 'malformed_request' });
  });

  it('fails closed when storage becomes unavailable', async () => {
    const value = await harness();
    await value.registry.applyMembershipFact(joinedFact());
    await value.storage.close();
    harnesses.splice(harnesses.indexOf(value), 1);

    expect(await value.registry.enrollmentFor(SYNTHETIC.boundaryA)).toBeNull();
    expect(await value.registry.list()).toEqual([]);
    expect(await value.registry.captureEligibilityFor(
      SYNTHETIC.boundaryA,
      SYNTHETIC.rejoinTs,
    )).toEqual({ capture: false, reason: 'channel_not_enrolled', enrollment_epoch: null });
    expect(await value.registry.contextEligibilityFor(SYNTHETIC.boundaryA)).toEqual({
      context_allowed: false,
      reason: 'channel_not_enrolled',
    });
  });

  it('returns content-free operational results', async () => {
    const { registry } = await harness();
    const result = await registry.applyMembershipFact(joinedFact());

    expect(Object.keys(result).sort()).toEqual(['outcome', 'reason']);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC.workspaceId);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC.channelA);
  });
});
