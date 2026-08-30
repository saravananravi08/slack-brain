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
} from '../integration/memory-validation/helpers.js';
import { elapsedMs, summarizeLatency } from './metrics.js';

const MESSAGE_COUNT = 25;
const QUERY_COUNT = 30;
const resources: ValidationMemory[] = [];
const removals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(closeValidationMemory));
  await Promise.all(removals.splice(0).map((remove) => remove()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('T503 semantic recall latency', () => {
  it('reports p50/p90/p95 over repeated cross-thread recall', async () => {
    const database = await temporaryDatabase();
    removals.push(database.remove);
    const resource = await openValidationMemory(database.databaseUrl);
    resources.push(resource);
    const sourceThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735689800.000100',
    );
    const queryThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735690800.000200',
    );

    await resource.memory.saveMessages({
      messages: Array.from({ length: MESSAGE_COUNT }, (_, index) => {
        const seconds = 1_735_689_800 + index;
        const timestamp = `${seconds}.000100`;
        return syntheticMessage({
          id: `${SYNTHETIC.workspace}/${SYNTHETIC.channelAlpha}/${timestamp}`,
          boundaryId: BOUNDARIES.channelAlpha,
          threadId: sourceThread,
          channelId: SYNTHETIC.channelAlpha,
          senderName: 'Synthetic Performance Member',
          timestamp,
          text: `Project Lantern deployment output ${index} belongs in object storage.`,
        });
      }),
    });

    const latencies: number[] = [];
    for (let index = 0; index < QUERY_COUNT; index += 1) {
      const startedAt = performance.now();
      const recalled = await resource.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: BOUNDARIES.channelAlpha,
        vectorSearchString: 'Where should deployment output live?',
        perPage: 0,
      });
      latencies.push(elapsedMs(startedAt));
      expect(recalled.length).toBeGreaterThan(0);
      expect(recalled.every(({ boundary_id }) => boundary_id === BOUNDARIES.channelAlpha))
        .toBe(true);
    }

    const summary = summarizeLatency(latencies);
    expect(summary.p95).toBeLessThan(1_000);
    console.info('T503_METRIC recall', JSON.stringify({
      corpus_messages: MESSAGE_COUNT,
      queries: QUERY_COUNT,
      latency_ms: summary,
    }));
  }, 30_000);
});
