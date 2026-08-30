import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MastraDBMessage } from '@mastra/core/agent';
import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MutationHandler,
  MastraMutationStorage,
  classifyMutation,
  type MutationEvent,
  type MutationStorage,
  type OriginalMessageEvent,
} from '../../../src/ingestion/mutations/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import {
  resolveIdentity,
  type BoundaryId,
  type MessageKey,
} from '../../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import type { PolicySnapshot } from '../../../src/security/index.js';

const WORKSPACE = 'T0SYNTH01';
const APPROVED_CHANNEL = 'C0APPROVED1';
const USER = 'U0MEMBER01';
const MESSAGE_TS = '1735689800.000100';
const MESSAGE_KEY = `${WORKSPACE}/${APPROVED_CHANNEL}/${MESSAGE_TS}` as MessageKey;
const BOUNDARY = `ch:${WORKSPACE}:${APPROVED_CHANNEL}` as BoundaryId;
const THREAD = `${BOUNDARY}#${MESSAGE_TS}` as const;
const OLD_TEXT = 'Synthetic original text.';
const NEW_TEXT = 'Synthetic edited text.';

const policy: PolicySnapshot = {
  approved_workspace_id: WORKSPACE,
  approved_channel_ids: [APPROVED_CHANNEL],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

const directories: string[] = [];
const resources: Array<{
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

function vectorFor(text: string): number[] {
  const vector = Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0);
  vector[text.includes('edited') ? 1 : 0] = 1;
  return vector;
}

async function setup() {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 'gist-mutation-test-'));
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
      embeddings: values.map(vectorFor),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );
  resources.push({ memory, storage, vector });
  return {
    memory,
    storage,
    vector,
    embed,
    mutations: new MastraMutationStorage({ memory, storage }),
  };
}

function storedMessage(overrides: Partial<MastraDBMessage> = {}): MastraDBMessage {
  return {
    id: MESSAGE_KEY,
    role: 'user',
    createdAt: new Date('2025-01-01T00:03:20.000Z'),
    threadId: THREAD,
    resourceId: BOUNDARY,
    content: {
      format: 2,
      parts: [{ type: 'text', text: OLD_TEXT }],
      metadata: {
        contract_version: '1.0.0',
        message_key: MESSAGE_KEY,
        boundary_id: BOUNDARY,
        thread_id: THREAD,
        conversation_type: 'channel',
        sender_id: USER,
        sender_name: 'Synthetic Member',
        sent_at: '2025-01-01T00:03:20.000Z',
        message_ts: MESSAGE_TS,
        channel_id: APPROVED_CHANNEL,
        edited_at: null,
      },
    },
    ...overrides,
  };
}

async function seed(
  setupResult: Awaited<ReturnType<typeof setup>>,
  message = storedMessage(),
): Promise<void> {
  const store = await setupResult.storage.getStore('memory');
  await store!.saveThread({
    thread: {
      id: message.threadId!,
      resourceId: message.resourceId!,
      title: 'Synthetic thread',
      metadata: {},
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    },
  });
  await store!.saveMessages({ messages: [message] });
  await setupResult.vector.createIndex({
    indexName: 'memory_messages',
    dimension: GIST_EMBEDDING_DIMENSIONS,
  });
  await setupResult.vector.upsert({
    indexName: 'memory_messages',
    ids: [message.id],
    vectors: [vectorFor(message.content.parts[0]!.type === 'text' ? message.content.parts[0]!.text : '')],
    metadata: [{
      message_id: message.id,
      resource_id: message.resourceId,
      boundary_id: message.resourceId,
      thread_id: message.threadId,
      content: OLD_TEXT,
    }],
  });
}

function mutationEvent(
  kind: 'edit' | 'delete',
  overrides: Partial<MutationEvent> = {},
): MutationEvent {
  return {
    contract_version: '1.0.0',
    class: 'mutation',
    workspace_id: WORKSPACE,
    channel_id: APPROVED_CHANNEL,
    conversation_type: 'channel',
    sender_id: USER,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    message_ts: MESSAGE_TS,
    mutation: kind === 'edit'
      ? {
          kind,
          target_ts: MESSAGE_TS,
          edited_at: '2025-01-01T00:10:00.000Z',
          new_text: NEW_TEXT,
        }
      : {
          kind,
          target_ts: MESSAGE_TS,
          edited_at: '2025-01-01T00:12:00.000Z',
        },
    ...overrides,
  };
}

function identityFor(event: MutationEvent | OriginalMessageEvent) {
  return resolveIdentity({
    ...event,
    thread_ts: null,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(resources.splice(0).map(async ({ memory, storage, vector }) => {
    await memory.settled();
    await vector.close();
    await storage.close();
  }));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('mutation classification and authorization', () => {
  it('classifies contract edits/deletes and rejects malformed edits', () => {
    expect(classifyMutation(mutationEvent('edit'))?.kind).toBe('edit');
    expect(classifyMutation(mutationEvent('delete'))?.kind).toBe('delete');
    expect(classifyMutation({
      ...mutationEvent('edit'),
      mutation: { ...mutationEvent('edit').mutation, new_text: '   ' },
    })).toBeNull();
  });

  it('denies before any storage lookup or write', async () => {
    const storage: MutationStorage = {
      editMessage: vi.fn(),
      deleteMessages: vi.fn(),
      isTombstoned: vi.fn(),
      listMessages: vi.fn(),
    };
    const handler = new MutationHandler({ storage, policy });
    const event = mutationEvent('delete', { channel_id: 'C0UNAPPROV9' });

    await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
      status: 'denied',
      reason: 'unapproved_channel',
    });
    expect(storage.deleteMessages).not.toHaveBeenCalled();
    expect(storage.editMessage).not.toHaveBeenCalled();
  });
});

describe('D005 edit/delete propagation', () => {
  it('re-embeds an edit under one identity and makes replay a no-op', async () => {
    const context = await setup();
    await seed(context);
    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('edit');

    await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
      status: 'updated',
      message_key: MESSAGE_KEY,
    });
    await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
      status: 'unchanged',
      message_key: MESSAGE_KEY,
    });
    const lateRetry = mutationEvent('edit', {
      mutation: {
        kind: 'edit',
        target_ts: MESSAGE_TS,
        edited_at: '2025-01-01T00:09:00.000Z',
        new_text: 'Synthetic stale retry text.',
      },
    });
    await expect(handler.handle({
      event: lateRetry,
      identity: identityFor(lateRetry),
    })).resolves.toMatchObject({ status: 'unchanged' });

    const store = await context.storage.getStore('memory');
    const saved = (await store!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages[0]!;
    expect(saved.content.parts).toEqual([{ type: 'text', text: NEW_TEXT }]);
    expect(saved.content.metadata?.edited_at).toBe('2025-01-01T00:10:00.000Z');
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
    const vectors = await context.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorFor(NEW_TEXT),
      topK: 5,
    });
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.metadata?.content).toBe(NEW_TEXT);
    expect(context.embed).toHaveBeenCalledTimes(2);
  });

  it('hard-deletes message/vector, leaves content-free tombstone, and suppresses late original', async () => {
    const context = await setup();
    await seed(context);
    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('delete');

    await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
      status: 'deleted',
      message_key: MESSAGE_KEY,
    });
    await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
      status: 'unchanged',
      message_key: MESSAGE_KEY,
    });

    const store = await context.storage.getStore('memory');
    expect((await store!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages).toEqual([]);
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(0);
    const resource = await store!.getResourceById({ resourceId: BOUNDARY });
    expect(JSON.stringify(resource?.metadata)).toContain(MESSAGE_KEY);
    expect(JSON.stringify(resource?.metadata)).not.toContain(OLD_TEXT);

    const original: OriginalMessageEvent = {
      ...event,
      class: undefined,
      mutation: undefined,
    } as unknown as OriginalMessageEvent;
    await expect(handler.shouldSuppressOriginal({
      event: original,
      identity: identityFor(original),
    })).resolves.toEqual({ status: 'allowed', suppressed: true });
  });

  it('restores message state when synchronous vector deletion fails', async () => {
    const context = await setup();
    await seed(context);
    vi.spyOn(context.vector, 'deleteVectors').mockRejectedValueOnce(
      new Error('synthetic vector delete failure'),
    );
    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('delete');

    await expect(handler.handle({ event, identity: identityFor(event) })).rejects.toThrow(
      'synthetic vector delete failure',
    );
    const store = await context.storage.getStore('memory');
    expect((await store!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages).toHaveLength(1);
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
    const resource = await store!.getResourceById({ resourceId: BOUNDARY });
    expect(JSON.stringify(resource?.metadata)).not.toContain(MESSAGE_KEY);
  });

  it('treats edits and deletes for missing originals as no-op success', async () => {
    const context = await setup();
    const handler = new MutationHandler({ storage: context.mutations, policy });
    for (const kind of ['edit', 'delete'] as const) {
      const event = mutationEvent(kind);
      await expect(handler.handle({ event, identity: identityFor(event) })).resolves.toEqual({
        status: 'unchanged',
        message_key: MESSAGE_KEY,
      });
    }
  });
});

describe('D004 retention sweep', () => {
  it('expires 90-day DMs and channels removed for 30 days through the delete primitive', async () => {
    const context = await setup();
    const oldDm = storedMessage({
      id: `${WORKSPACE}/D0DMCONV01/1735689600.000100`,
      resourceId: `dm:${WORKSPACE}:${USER}`,
      threadId: `dm:${WORKSPACE}:${USER}#1735689600.000100`,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      content: {
        ...storedMessage().content,
        metadata: { ...storedMessage().content.metadata, sent_at: '2025-01-01T00:00:00.000Z' },
      },
    });
    const removed = storedMessage({
      id: `${WORKSPACE}/C0REMOVED01/1735689800.000100`,
      resourceId: `ch:${WORKSPACE}:C0REMOVED01`,
      threadId: `ch:${WORKSPACE}:C0REMOVED01#1735689800.000100`,
    });
    const approved = storedMessage();
    await seed(context, oldDm);
    await seed(context, removed);
    await seed(context, approved);

    const handler = new MutationHandler({ storage: context.mutations, policy });
    const result = await handler.sweepRetention({
      now: '2025-04-02T00:00:00.000Z',
      approved_channel_ids: [APPROVED_CHANNEL],
      channel_removed_at: { C0REMOVED01: '2025-03-01T00:00:00.000Z' },
    });

    expect(result).toMatchObject({ examined: 3, deleted: 2, embeddings_deleted: 2 });
    expect(result.tombstoned).toEqual(expect.arrayContaining([oldDm.id, removed.id]));
    const store = await context.storage.getStore('memory');
    expect((await store!.listMessagesById({ messageIds: [oldDm.id, removed.id] })).messages).toEqual([]);
    expect((await store!.listMessagesById({ messageIds: [approved.id] })).messages).toHaveLength(1);
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
  });
});
