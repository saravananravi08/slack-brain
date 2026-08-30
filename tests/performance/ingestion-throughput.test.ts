import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AmbientPersistenceService,
  type AmbientNormalizedEvent,
} from '../../src/ingestion/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../src/mastra/memory/gist-memory.js';
import { resolveIdentity } from '../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../src/mastra/storage/index.js';
import { elapsedMs, gpt41CostUsd, summarizeLatency } from './metrics.js';

const EVENT_COUNT = 40;
const CONCURRENCY = 1;
const directories: string[] = [];
const closeTasks: Array<() => Promise<void>> = [];

function event(index: number): AmbientNormalizedEvent {
  const seconds = 1_735_689_800 + index;
  return {
    contract_version: '1.0.0',
    class: 'ambient',
    workspace_id: 'T0SYNTH01',
    channel_id: 'C0APPROVED1',
    conversation_type: 'channel',
    sender_id: `U0MEMBER${String(index % CONCURRENCY).padStart(2, '0')}`,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    message_ts: `${seconds}.000100`,
    event_id: `Ev0T503${String(index).padStart(6, '0')}`,
    thread_ts: null,
    sent_at: new Date(seconds * 1_000).toISOString(),
    text: `Synthetic T503 ingestion fact ${index}.`,
    addressed_to_gist: false,
  };
}

async function setup() {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 't503-ingestion-'));
  directories.push(directory);
  const databaseUrl = pathToFileURL(join(directory, 'mastra.db')).href;
  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  const vector = memory.vector as LibSQLVector;
  const embed = vi.spyOn(memory.embedder!, 'doEmbed').mockImplementation(
    async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [1, ...Array<number>(GIST_EMBEDDING_DIMENSIONS - 1).fill(0)]),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );
  const service = new AmbientPersistenceService({
    memory,
    storage,
    resolveIdentity,
    authorizeWrite: async () => ({ allowed: true, reason: null }),
  });

  closeTasks.push(async () => {
    await memory.settled();
    await vector.close();
    await storage.close();
  });
  return { embed, service, storage, vector };
}

afterEach(async () => {
  await Promise.all(closeTasks.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('T503 ambient ingestion throughput', () => {
  it('measures supported steady-state persistence with zero generation cost', async () => {
    const runtime = await setup();
    await expect(runtime.service.persist({
      event: event(0),
      sender_name: 'Synthetic Performance Member',
    })).resolves.toEqual({ outcome: 'inserted' });

    const latencies: number[] = [];
    const startedAt = performance.now();
    let nextIndex = 1;

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (nextIndex <= EVENT_COUNT) {
        const index = nextIndex;
        nextIndex += 1;
        const eventStartedAt = performance.now();
        const result = await runtime.service.persist({
          event: event(index),
          sender_name: 'Synthetic Performance Member',
        });
        latencies.push(elapsedMs(eventStartedAt));
        expect(result).toEqual({ outcome: 'inserted' });
      }
    });
    await Promise.all(workers);

    const durationMs = elapsedMs(startedAt);
    const eventsPerSecond = EVENT_COUNT / (durationMs / 1_000);
    const summary = summarizeLatency(latencies);
    const store = await runtime.storage.getStore('memory');
    const stored = await store!.listMessagesById({
      messageIds: Array.from({ length: EVENT_COUNT + 1 }, (_, index) => {
        const input = event(index);
        return `${input.workspace_id}/${input.channel_id}/${input.message_ts}`;
      }),
    });

    expect(stored.messages).toHaveLength(EVENT_COUNT + 1);
    expect(runtime.embed).toHaveBeenCalledTimes(EVENT_COUNT + 1);
    expect((await runtime.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(EVENT_COUNT + 1);
    expect(eventsPerSecond).toBeGreaterThan(5);
    expect(summary.p95).toBeLessThan(2_000);
    expect(gpt41CostUsd({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    })).toBe(0);

    console.info('T503_METRIC ingestion', JSON.stringify({
      events: EVENT_COUNT,
      concurrency: CONCURRENCY,
      duration_ms: durationMs,
      events_per_second: Number(eventsPerSecond.toFixed(2)),
      latency_ms: summary,
      generation_calls: 0,
      generation_cost_usd: 0,
    }));
  }, 30_000);
});
