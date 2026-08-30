import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOUNDARIES,
  closeValidationMemory,
  createThread,
  openValidationMemory,
  SYNTHETIC,
  syntheticMessage,
  temporaryDatabase,
  type ValidationMemory,
} from './helpers.js';

const resources: ValidationMemory[] = [];
const removals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(closeValidationMemory));
  await Promise.all(removals.splice(0).map((remove) => remove()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function makeMemory(): Promise<ValidationMemory> {
  const database = await temporaryDatabase();
  removals.push(database.remove);
  const resource = await openValidationMemory(database.databaseUrl);
  resources.push(resource);
  return resource;
}

describe('privacy gate: persisted retrieval boundaries', () => {
  it('never returns another channel or user DM for the same semantic query', async () => {
    const resource = await makeMemory();
    const fixtures = [
      {
        boundaryId: BOUNDARIES.channelAlpha,
        channelId: SYNTHETIC.channelAlpha,
        senderName: 'Synthetic Alpha Member',
        timestamp: '1735689800.000100',
      },
      {
        boundaryId: BOUNDARIES.channelBeta,
        channelId: SYNTHETIC.channelBeta,
        senderName: 'Synthetic Beta Member',
        timestamp: '1735689801.000100',
      },
      {
        boundaryId: BOUNDARIES.dmAvery,
        channelId: 'D0DMCONV01',
        senderName: 'Synthetic Avery',
        timestamp: '1735689802.000100',
      },
      {
        boundaryId: BOUNDARIES.dmBlake,
        channelId: 'D0DMCONV02',
        senderName: 'Synthetic Blake',
        timestamp: '1735689803.000100',
      },
    ] as const;

    const queryThreads = new Map<string, string>();
    for (const [index, fixture] of fixtures.entries()) {
      const sourceThread = await createThread(resource, fixture.boundaryId, fixture.timestamp);
      const queryTimestamp = `1735690${index}00.000200`;
      queryThreads.set(
        fixture.boundaryId,
        await createThread(resource, fixture.boundaryId, queryTimestamp),
      );
      await resource.memory.saveMessages({
        messages: [
          syntheticMessage({
            id: `${SYNTHETIC.workspace}/${fixture.channelId}/${fixture.timestamp}`,
            boundaryId: fixture.boundaryId,
            threadId: sourceThread,
            channelId: fixture.channelId,
            senderName: fixture.senderName,
            timestamp: fixture.timestamp,
            text: `Synthetic rollout window evidence for ${fixture.boundaryId}.`,
          }),
        ],
      });
    }

    for (const fixture of fixtures) {
      const queryThread = queryThreads.get(fixture.boundaryId);
      if (!queryThread) throw new Error('Missing synthetic query thread.');
      const items = await resource.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: fixture.boundaryId,
        vectorSearchString: 'What is the rollout window?',
        perPage: 0,
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        boundary_id: fixture.boundaryId,
        channel_id: fixture.channelId,
        sender_name: fixture.senderName,
      });
      expect(items.every(({ boundary_id }) => boundary_id === fixture.boundaryId)).toBe(true);
    }
  });

  it('fails closed when a thread is paired with another boundary', async () => {
    const resource = await makeMemory();
    const alphaThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735689900.000100',
    );

    await expect(
      resource.memory.recallWithCitationMetadata({
        threadId: alphaThread,
        resourceId: BOUNDARIES.channelBeta,
        vectorSearchString: 'rollout window',
        perPage: 0,
      }),
    ).rejects.toThrow();
  });
});
