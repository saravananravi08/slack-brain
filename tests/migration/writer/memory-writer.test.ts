import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import {
  MastraMemoryWriter,
  type ArchiveWriterRecord,
} from '../../../src/migration/writer/index.js';

const directories: string[] = [];
const resources: Array<{
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

function deterministicVector(text: string): number[] {
  const vector = Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0);
  vector[text.includes('updated') ? 1 : 0] = 1;
  return vector;
}

async function makeMemory() {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 'gist-memory-writer-test-'));
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
      embeddings: values.map(deterministicVector),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );
  resources.push({ memory, storage, vector });
  return { memory, storage, vector, embed };
}

function record(
  runId = 'synthetic-run-001',
  overrides: Partial<ArchiveWriterRecord['message']> = {},
): ArchiveWriterRecord {
  const message = {
    contract_version: '1.0.0',
    message_key: 'T0SYNTH01/C0APPROVED1/1735689600.000100',
    boundary_id: 'ch:T0SYNTH01:C0APPROVED1',
    thread_id: 'ch:T0SYNTH01:C0APPROVED1#1735689600.000100',
    conversation_type: 'channel',
    sender_id: 'U0MEMBER01',
    sender_name: 'Synthetic Member One',
    sent_at: '2025-01-01T00:00:00.000Z',
    message_ts: '1735689600.000100',
    text: 'Synthetic import content.',
    edited_at: null,
    source: 'import',
    ingested_at: '2025-02-01T00:00:00.000Z',
    ...overrides,
  } as const;

  return {
    delivery_key: `import:${runId}:${message.message_key}`,
    message,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    resources.splice(0).map(async ({ memory, storage, vector }) => {
      await memory.settled();
      await vector.close();
      await storage.close();
    }),
  );
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('MastraMemoryWriter', () => {
  it('uses delivery and content keys without duplicating messages or embeddings', async () => {
    const { memory, storage, vector, embed } = await makeMemory();
    const writer = new MastraMemoryWriter({ memory, storage, batchSize: 1 });

    const first = await writer.write([record()]);
    const repeatedDelivery = await writer.write([record()]);
    const newRun = await writer.write([
      record('synthetic-run-002', {
        ingested_at: '2025-02-02T00:00:00.000Z',
      }),
    ]);

    expect(first).toMatchObject({
      accepted: 1,
      rejected: 0,
      writer: { inserted: 1, updated: 0, unchanged: 0, failed: 0 },
      embeddings: { written: 1, unchanged: 0, failed: 0 },
      failures: [],
    });
    expect(repeatedDelivery.writer).toEqual({
      inserted: 0, updated: 0, unchanged: 1, failed: 0,
    });
    expect(newRun.writer).toEqual({
      inserted: 0, updated: 0, unchanged: 1, failed: 0,
    });
    expect(newRun.embeddings).toEqual({ written: 0, unchanged: 1, failed: 0 });
    expect(embed).toHaveBeenCalledTimes(1);

    const store = await storage.getStore('memory');
    const messages = await store!.listMessagesById({
      messageIds: [record().message.message_key],
    });
    expect(messages.messages).toHaveLength(1);
    expect(await vector.describeIndex({ indexName: 'memory_messages' })).toMatchObject({
      dimension: GIST_EMBEDDING_DIMENSIONS,
      count: 1,
    });
  });

  it('replaces changed content and its embedding under the same message key', async () => {
    const { memory, storage, vector } = await makeMemory();
    const writer = new MastraMemoryWriter({ memory, storage });
    await writer.write([record()]);

    const updated = await writer.write([
      record('synthetic-run-002', {
        text: 'Synthetic updated import content.',
        edited_at: '2025-01-01T00:01:00.000Z',
        ingested_at: '2025-02-02T00:00:00.000Z',
      }),
    ]);

    expect(updated.writer).toEqual({
      inserted: 0, updated: 1, unchanged: 0, failed: 0,
    });
    expect(updated.embeddings).toEqual({ written: 1, unchanged: 0, failed: 0 });
    expect((await vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);

    const store = await storage.getStore('memory');
    const saved = (await store!.listMessagesById({
      messageIds: [record().message.message_key],
    })).messages[0]!;
    expect(saved.content.parts).toEqual([
      { type: 'text', text: 'Synthetic updated import content.' },
    ]);
  });

  it('resumes the same delivery after a partial vector failure', async () => {
    const { memory, storage, vector } = await makeMemory();
    const upsert = vi.spyOn(vector, 'upsert');
    upsert.mockRejectedValueOnce(new Error('synthetic vector failure'));
    const writer = new MastraMemoryWriter({ memory, storage, maxAttempts: 1 });

    const failed = await writer.write([record()]);

    expect(failed).toEqual({
      accepted: 0,
      rejected: 1,
      writer: { inserted: 0, updated: 0, unchanged: 0, failed: 1 },
      embeddings: { written: 0, unchanged: 0, failed: 1 },
      failures: [{ record_index: 0, reason: 'writer_failed', retryable: true }],
    });
    const store = await storage.getStore('memory');
    expect((await store!.listMessagesById({
      messageIds: [record().message.message_key],
    })).messages).toHaveLength(0);
    expect((await vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(0);

    const resumed = await writer.write([record()]);
    expect(resumed.writer).toEqual({
      inserted: 1, updated: 0, unchanged: 0, failed: 0,
    });
    expect((await vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);

    expect((await store!.listMessagesById({
      messageIds: [record().message.message_key],
    })).messages).toHaveLength(1);
  });

  it('rejects non-channel records without exposing record data in failures', async () => {
    const { memory, storage } = await makeMemory();
    const writer = new MastraMemoryWriter({ memory, storage });
    const invalid = record() as unknown as {
      delivery_key: ArchiveWriterRecord['delivery_key'];
      message: ArchiveWriterRecord['message'] & { conversation_type: 'dm' };
    };
    invalid.message = { ...invalid.message, conversation_type: 'dm' };

    const result = await writer.write([invalid as unknown as ArchiveWriterRecord]);

    expect(result).toEqual({
      accepted: 0,
      rejected: 1,
      writer: { inserted: 0, updated: 0, unchanged: 0, failed: 1 },
      embeddings: { written: 0, unchanged: 0, failed: 1 },
      failures: [{ record_index: 0, reason: 'writer_failed', retryable: false }],
    });
    expect(JSON.stringify(result)).not.toContain(record().message.text);
    expect(JSON.stringify(result)).not.toContain(record().message.message_key);
  });
});
