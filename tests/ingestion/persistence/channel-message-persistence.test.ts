import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messagesFixture from '../../contracts/channel-memory/fixtures/messages.v1.json' with { type: 'json' };
import {
  ChannelMessagePersistenceService,
  type ChannelMessageRecord,
} from '../../../src/ingestion/persistence/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';

const records = messagesFixture.records.map(({ record }) => record as ChannelMessageRecord);
const directories: string[] = [];
const resources: Array<{
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

function deterministicVector(): number[] {
  return [1, ...Array<number>(GIST_EMBEDDING_DIMENSIONS - 1).fill(0)];
}

async function setup(maxAttempts = 3) {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 'gist-channel-message-persistence-test-'));
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
  const service = new ChannelMessagePersistenceService({ memory, storage, maxAttempts });
  const context = { storage, memory, vector, embed, service };
  resources.push({ storage, memory, vector });
  return context;
}

async function savedRecord(
  context: Awaited<ReturnType<typeof setup>>,
  record: ChannelMessageRecord,
) {
  const store = await context.storage.getStore('memory');
  return (await store!.listMessagesById({ messageIds: [record.message_key] })).messages[0];
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
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ChannelMessagePersistenceService', () => {
  it('persists every capture-eligible sender class with canonical channel/thread metadata', async () => {
    const context = await setup();

    for (const record of records) {
      await expect(context.service.persist(record)).resolves.toEqual({
        outcome: 'inserted',
        embedding: 'stored',
      });
      const saved = await savedRecord(context, record);
      expect(saved).toMatchObject({
        id: record.message_key,
        resourceId: record.boundary_id,
        threadId: record.thread_id,
        role: record.sender.sender_class === 'gist' ? 'assistant' : 'user',
      });
      expect(saved?.content.metadata).toMatchObject({
        message_key: record.message_key,
        boundary_id: record.boundary_id,
        thread_id: record.thread_id,
        workspace_id: record.workspace_id,
        channel_id: record.channel_id,
        message_ts: record.message_ts,
        thread_root_ts: record.thread_root_ts,
        is_thread_reply: record.is_thread_reply,
        sender: record.sender,
        capture_source: record.capture_source,
        enrollment_epoch: record.enrollment_epoch,
      });
    }

    expect(new Set(records.map((record) => record.sender.sender_class))).toEqual(
      new Set(['human', 'kilo', 'gist', 'bot', 'app']),
    );
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(records.length);
  });

  it('preserves empty text plus available file/link metadata in row and vector', async () => {
    const context = await setup();
    const record = records.find(({ sender }) => sender.sender_class === 'app')!;

    await expect(context.service.persist(record)).resolves.toMatchObject({ embedding: 'stored' });

    const saved = await savedRecord(context, record);
    expect(saved?.content.parts).toEqual([{ type: 'text', text: '' }]);
    expect(saved?.content.metadata).toMatchObject({
      files: record.files,
      links: record.links,
      sender_id: record.sender.sender_id,
      sender_name: record.sender.sender_display_name,
    });
    const vectors = await context.vector.query({
      indexName: 'memory_messages',
      queryVector: deterministicVector(),
      topK: 1,
    });
    expect(vectors[0]?.metadata).toMatchObject({
      files: record.files,
      links: record.links,
      sender_class: 'app',
      capture_source: 'live_event',
    });
  });

  it('converges duplicate envelopes and outgoing-self echo on one first-writer row/vector', async () => {
    const context = await setup();
    const outgoing = records.find(({ capture_source }) => capture_source === 'outgoing_self')!;
    const echo: ChannelMessageRecord = {
      ...outgoing,
      capture_source: 'live_event',
      ingested_at: '2026-01-05T09:06:41.000Z',
    };

    await expect(context.service.persist(outgoing)).resolves.toEqual({
      outcome: 'inserted', embedding: 'stored',
    });
    await expect(context.service.persist(echo)).resolves.toEqual({
      outcome: 'unchanged', embedding: 'stored',
    });

    expect(context.embed).toHaveBeenCalledOnce();
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
    expect((await savedRecord(context, outgoing))?.content.metadata).toMatchObject({
      capture_source: 'outgoing_self',
      ingested_at: outgoing.ingested_at,
    });
  });

  it('rejects conflicting content under an existing Slack message identity', async () => {
    const context = await setup();
    const original = records[0]!;
    const conflict: ChannelMessageRecord = { ...original, text: `${original.text} conflict` };

    await context.service.persist(original);
    await expect(context.service.persist(conflict)).resolves.toEqual({
      outcome: 'failed', reason: 'content_conflict', retryable: false,
    });

    expect(context.embed).toHaveBeenCalledOnce();
    expect((await savedRecord(context, original))?.content.parts).toEqual([
      { type: 'text', text: original.text },
    ]);
  });

  it('keeps the canonical row when embedding fails and repairs it from an echo retry', async () => {
    const context = await setup(2);
    const record = records.find(({ capture_source }) => capture_source === 'outgoing_self')!;
    const echo: ChannelMessageRecord = {
      ...record,
      capture_source: 'live_event',
      ingested_at: '2026-01-05T09:06:41.000Z',
    };
    context.embed.mockRejectedValue(new Error('synthetic embedding unavailable'));

    await expect(context.service.persist(record)).resolves.toEqual({
      outcome: 'inserted', embedding: 'pending', retryable: true,
    });
    expect((await savedRecord(context, record))?.content).toMatchObject({
      parts: [{ type: 'text', text: record.text }],
      metadata: expect.objectContaining({
        message_key: record.message_key,
        channel_embedding_pending: true,
      }),
    });

    context.embed.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(deterministicVector),
      usage: { tokens: values.length },
      warnings: [],
    }));
    await expect(context.service.persist(echo)).resolves.toEqual({
      outcome: 'unchanged', embedding: 'stored',
    });

    expect((await savedRecord(context, record))?.content.metadata).toMatchObject({
      capture_source: 'outgoing_self',
      ingested_at: record.ingested_at,
    });
    expect((await savedRecord(context, record))?.content.metadata)
      .not.toHaveProperty('channel_embedding_pending');
    const vectors = await context.vector.query({
      indexName: 'memory_messages',
      queryVector: deterministicVector(),
      topK: 1,
    });
    expect(vectors[0]?.metadata).toMatchObject({
      capture_source: 'outgoing_self',
      embedded_at: record.ingested_at,
    });
  });

  it('retries a transient canonical-row write without duplicating row or vector', async () => {
    const context = await setup(2);
    const record = records[0]!;
    const store = await context.storage.getStore('memory');
    vi.spyOn(store!, 'saveMessages').mockRejectedValueOnce(
      new Error('synthetic transient row failure'),
    );

    await expect(context.service.persist(record)).resolves.toEqual({
      outcome: 'inserted', embedding: 'stored',
    });
    expect((await store!.listMessagesById({ messageIds: [record.message_key] })).messages)
      .toHaveLength(1);
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
  });

  it('fails malformed or cross-boundary records before storage and embedding', async () => {
    const context = await setup();
    const getStore = vi.spyOn(context.storage, 'getStore');
    const invalid = {
      ...records[0]!,
      boundary_id: records[4]!.boundary_id,
    } as ChannelMessageRecord;

    await expect(context.service.persist(invalid)).resolves.toEqual({
      outcome: 'skipped', reason: 'invalid_record',
    });
    expect(getStore).not.toHaveBeenCalled();
    expect(context.embed).not.toHaveBeenCalled();
  });

  it('contains no response, typing, workflow, generation, or Slack action surface', async () => {
    const source = await readFile(
      new URL(
        '../../../src/ingestion/persistence/channel-message-persistence.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).not.toMatch(/\.(generate|stream|respond|post|postMessage|setStatus)\s*\(/);
    expect(source).not.toMatch(/import (?!type)[^;]*(agent|channels|slack|workflow)/i);
  });
});
