import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AmbientPersistenceService,
  type AmbientNormalizedEvent,
} from '../../../src/ingestion/persistence/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import {
  IDENTITY_CONTRACT_VERSION,
  resolveIdentity,
} from '../../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
} from '../../../src/security/index.js';
import type { PolicySnapshot } from '../../../src/security/types.js';

const directories: string[] = [];
const resources: Array<{
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

const policy: PolicySnapshot = {
  approved_workspace_id: 'T0SYNTH01',
  approved_channel_ids: ['C0APPROVED1'],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

function ambient(overrides: Partial<AmbientNormalizedEvent> = {}): AmbientNormalizedEvent {
  return {
    contract_version: '1.0.0',
    class: 'ambient',
    workspace_id: 'T0SYNTH01',
    channel_id: 'C0APPROVED1',
    message_ts: '1735689800.000100',
    event_id: 'Ev0SYNTH0003',
    conversation_type: 'channel',
    thread_ts: null,
    sender_id: 'U0MEMBER02',
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    sent_at: '2025-01-01T00:03:20.000Z',
    text: 'Synthetic ambient persistence content.',
    addressed_to_gist: false,
    ...overrides,
  };
}

function deterministicVector(): number[] {
  return [1, ...Array<number>(GIST_EMBEDDING_DIMENSIONS - 1).fill(0)];
}

async function makeResources() {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 'gist-ambient-persistence-test-'));
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

function makeService(
  resources: Awaited<ReturnType<typeof makeResources>>,
  options: { policy?: PolicySnapshot; maxAttempts?: number } = {},
) {
  const selectedPolicy = options.policy ?? policy;
  const authorizeWrite = vi.fn(({ event, identity }) =>
    authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'write_memory',
      event,
      identity,
      policy: selectedPolicy,
    }),
  );
  return {
    authorizeWrite,
    service: new AmbientPersistenceService({
      memory: resources.memory,
      storage: resources.storage,
      resolveIdentity: (event) => resolveIdentity({
        ...event,
        contract_version: IDENTITY_CONTRACT_VERSION,
      }),
      authorizeWrite,
      now: () => new Date('2025-02-01T00:00:00.000Z'),
      ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
    }),
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

describe('AmbientPersistenceService', () => {
  it('authorizes before storage and persists the exact resource/thread mapping', async () => {
    const resources = await makeResources();
    const getStore = vi.spyOn(resources.storage, 'getStore');
    const { service, authorizeWrite } = makeService(resources);

    const result = await service.persist({
      event: ambient(),
      sender_name: 'Synthetic Member Two',
    });

    expect(result).toEqual({ outcome: 'inserted' });
    expect(authorizeWrite).toHaveBeenCalledOnce();
    expect(authorizeWrite.mock.invocationCallOrder[0]).toBeLessThan(
      getStore.mock.invocationCallOrder[0]!,
    );
    expect(resources.embed).toHaveBeenCalledOnce();

    const store = await resources.storage.getStore('memory');
    const key = 'T0SYNTH01/C0APPROVED1/1735689800.000100';
    const saved = (await store!.listMessagesById({ messageIds: [key] })).messages[0]!;
    expect(saved).toMatchObject({
      id: key,
      resourceId: 'ch:T0SYNTH01:C0APPROVED1',
      threadId: 'ch:T0SYNTH01:C0APPROVED1#1735689800.000100',
    });
    expect(saved.content.metadata).toMatchObject({
      sender_name: 'Synthetic Member Two',
      channel_id: 'C0APPROVED1',
      message_ts: '1735689800.000100',
      source: 'live',
      ingested_at: '2025-02-01T00:00:00.000Z',
    });
    expect(await resources.vector.describeIndex({ indexName: 'memory_messages' }))
      .toMatchObject({ dimension: GIST_EMBEDDING_DIMENSIONS, count: 1 });
  });

  it('converges duplicate content without another embedding', async () => {
    const resources = await makeResources();
    const { service } = makeService(resources);
    const input = { event: ambient(), sender_name: 'Synthetic Member Two' };

    expect(await service.persist(input)).toEqual({ outcome: 'inserted' });
    expect(await service.persist({
      ...input,
      event: ambient({ event_id: 'Ev0SYNTH0004' }),
    })).toEqual({ outcome: 'unchanged' });

    expect(resources.embed).toHaveBeenCalledTimes(1);
    expect((await resources.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(1);
    const store = await resources.storage.getStore('memory');
    expect((await store!.listMessagesById({
      messageIds: ['T0SYNTH01/C0APPROVED1/1735689800.000100'],
    })).messages).toHaveLength(1);
  });

  it('denies an unapproved channel before any storage or embedding call', async () => {
    const resources = await makeResources();
    const getStore = vi.spyOn(resources.storage, 'getStore');
    const getThread = vi.spyOn(resources.memory, 'getThreadById');
    const { service } = makeService(resources);

    const result = await service.persist({
      event: ambient({ channel_id: 'C0UNAPPROV9' }),
      sender_name: 'Synthetic Member Two',
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'unapproved_channel' });
    expect(getStore).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
    expect(resources.embed).not.toHaveBeenCalled();
  });

  it('retries a transient write without duplicating the message or embedding', async () => {
    const resources = await makeResources();
    vi.spyOn(resources.vector, 'upsert').mockRejectedValueOnce(
      new Error('synthetic transient vector failure'),
    );
    const { service } = makeService(resources, { maxAttempts: 2 });

    expect(await service.persist({
      event: ambient(),
      sender_name: 'Synthetic Member Two',
    })).toEqual({ outcome: 'inserted' });

    const store = await resources.storage.getStore('memory');
    expect((await store!.listMessagesById({
      messageIds: ['T0SYNTH01/C0APPROVED1/1735689800.000100'],
    })).messages).toHaveLength(1);
    expect((await resources.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(1);
  });

  it('returns content-free failure and reruns safely after retries are exhausted', async () => {
    const resources = await makeResources();
    vi.spyOn(resources.vector, 'upsert').mockRejectedValueOnce(
      new Error('synthetic vector failure'),
    );
    const { service } = makeService(resources, { maxAttempts: 1 });
    const input = { event: ambient(), sender_name: 'Synthetic Member Two' };

    const failed = await service.persist(input);
    expect(failed).toEqual({
      outcome: 'failed', reason: 'persistence_failed', retryable: true,
    });
    expect(JSON.stringify(failed)).not.toContain(input.event.text);
    expect(JSON.stringify(failed)).not.toContain(input.event.message_ts);

    const store = await resources.storage.getStore('memory');
    expect((await store!.listMessagesById({
      messageIds: ['T0SYNTH01/C0APPROVED1/1735689800.000100'],
    })).messages).toHaveLength(0);
    expect((await resources.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(0);

    expect(await service.persist(input)).toEqual({ outcome: 'inserted' });
    expect((await resources.vector.describeIndex({ indexName: 'memory_messages' })).count)
      .toBe(1);
  });

  it('contains no generation or Slack response call surface', async () => {
    const source = await readFile(
      new URL('../../../src/ingestion/persistence/ambient-persistence.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/\.(generate|stream|respond|post|postMessage)\s*\(/);
    expect(source).not.toMatch(/import (?!type)[^;]*(agent|channels|slack)/i);
  });
});
