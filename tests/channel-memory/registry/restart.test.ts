import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createHarness, joinedFact, SYNTHETIC } from './helpers.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('JoinedChannelRegistry restart durability', () => {
  it('preserves two distinct joined channels after close and reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't602-registry-'));
    directories.push(directory);
    const databaseUrl = pathToFileURL(join(directory, 'registry.db')).href;

    const first = await createHarness(databaseUrl);
    await first.registry.applyMembershipFact(joinedFact());
    await first.registry.applyMembershipFact(joinedFact({
      boundary_id: SYNTHETIC.boundaryB,
      channel_id: SYNTHETIC.channelB,
      event_id: 'Ev0CHANTEST0003',
    }));
    await first.storage.close();

    const reopened = await createHarness(databaseUrl);
    try {
      const records = await reopened.registry.list({ state: 'enrolled' });
      expect(records).toHaveLength(2);
      expect(records.map(({ boundary_id }) => boundary_id)).toEqual([
        SYNTHETIC.boundaryA,
        SYNTHETIC.boundaryB,
      ]);
      expect(await reopened.registry.captureEligibilityFor(
        SYNTHETIC.boundaryA,
        '1767603601.000100',
      )).toMatchObject({ capture: true, enrollment_epoch: 1 });
      expect(await reopened.registry.captureEligibilityFor(
        SYNTHETIC.boundaryB,
        '1767603601.000100',
      )).toMatchObject({ capture: true, enrollment_epoch: 1 });
    } finally {
      await reopened.storage.close();
    }
  });

  it('keeps replay idempotency after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't602-registry-replay-'));
    directories.push(directory);
    const databaseUrl = pathToFileURL(join(directory, 'registry.db')).href;

    const first = await createHarness(databaseUrl);
    await first.registry.applyMembershipFact(joinedFact());
    await first.storage.close();

    const reopened = await createHarness(databaseUrl);
    try {
      expect(await reopened.registry.applyMembershipFact(joinedFact())).toEqual({
        outcome: 'unchanged',
        reason: null,
      });
      expect(await reopened.registry.enrollmentFor(SYNTHETIC.boundaryA)).toMatchObject({
        epoch: 1,
        capture_floor_ts: SYNTHETIC.firstJoinTs,
      });
    } finally {
      await reopened.storage.close();
    }
  });
});
