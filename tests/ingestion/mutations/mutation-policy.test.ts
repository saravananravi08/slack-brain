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
      listMessageBatches: async function* () {},
      reconcileTombstones: vi.fn(),
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

  it('preserves unrelated resource metadata when adding a tombstone', async () => {
    const context = await setup();
    await seed(context);
    const store = await context.storage.getStore('memory');
    await store!.updateResource({
      resourceId: BOUNDARY,
      metadata: { synthetic_setting: 'preserved' },
    });

    await context.mutations.deleteMessages(
      [MESSAGE_KEY],
      '2025-01-01T00:12:00.000Z',
    );

    const resource = await store!.getResourceById({ resourceId: BOUNDARY });
    expect(resource?.metadata?.synthetic_setting).toBe('preserved');
    expect(JSON.stringify(resource?.metadata?.gist_message_tombstones)).toContain(
      MESSAGE_KEY,
    );
  });

  it('restores the message but keeps the tombstone when vector deletion fails', async () => {
    // Behaviour changed by design review F-02. The tombstone is no longer
    // rolled back: it is the durable record that a delete was requested, it
    // keeps the message from being re-ingested meanwhile, and reconciliation
    // uses it to finish the job. Rolling it back lost the only trace of the
    // request and left the partial state unrepairable.
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
    expect(JSON.stringify(resource?.metadata)).toContain(MESSAGE_KEY);
    await expect(context.mutations.isTombstoned(BOUNDARY, MESSAGE_KEY)).resolves.toBe(true);
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

  it('deletes each retention batch before loading the next thread', async () => {
    const expiredDm = storedMessage({
      id: `${WORKSPACE}/D0DMCONV01/1735689600.000100`,
      resourceId: `dm:${WORKSPACE}:${USER}`,
      threadId: `dm:${WORKSPACE}:${USER}#1735689600.000100`,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      content: {
        ...storedMessage().content,
        metadata: {
          ...storedMessage().content.metadata,
          sent_at: '2025-01-01T00:00:00.000Z',
        },
      },
    });
    const deleteMessages = vi.fn(async (keys: readonly MessageKey[]) => ({
      deleted: keys.length,
      embeddings_deleted: keys.length,
      tombstoned: keys,
      missing: [],
    }));
    let firstBatchDeletedBeforeSecond = false;
    const storage: MutationStorage = {
      editMessage: vi.fn(),
      deleteMessages,
      isTombstoned: vi.fn(),
      listMessageBatches: async function* () {
        yield [expiredDm];
        firstBatchDeletedBeforeSecond = deleteMessages.mock.calls.length === 1;
        yield [storedMessage()];
      },
      reconcileTombstones: async () => 0,
    };
    const handler = new MutationHandler({ storage, policy });

    const result = await handler.sweepRetention({
      now: '2025-04-02T00:00:00.000Z',
      approved_channel_ids: [APPROVED_CHANNEL],
      channel_removed_at: {},
    });

    expect(firstBatchDeletedBeforeSecond).toBe(true);
    expect(deleteMessages).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ examined: 2, deleted: 1, embeddings_deleted: 1 });
  });
});

/**
 * Design review F-02 — the crash windows between a mutation's vector write and
 * its row write. Each test injects a failure at the point the review named and
 * asserts the surviving state is the safe one, then that reconciliation
 * finishes the job.
 */
describe('F-02: interrupted mutations leave no recallable content', () => {
  it('never leaves deleted text in the vector index when the row delete fails', async () => {
    const context = await setup();
    await seed(context);
    const store = await context.storage.getStore('memory');
    vi.spyOn(store!, 'deleteMessages').mockRejectedValueOnce(
      new Error('synthetic row delete failure'),
    );
    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('delete');

    await expect(handler.handle({ event, identity: identityFor(event) })).rejects.toThrow(
      'synthetic row delete failure',
    );

    // The embedding is gone first, so the deleted text cannot be reached by
    // semantic recall even though the row survived the interruption.
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(0);
    await expect(context.mutations.isTombstoned(BOUNDARY, MESSAGE_KEY)).resolves.toBe(true);
  });

  it('finishes an interrupted delete on the next reconciliation', async () => {
    const context = await setup();
    await seed(context);
    const store = await context.storage.getStore('memory');
    vi.spyOn(store!, 'deleteMessages').mockRejectedValueOnce(
      new Error('synthetic row delete failure'),
    );
    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('delete');
    await expect(handler.handle({ event, identity: identityFor(event) })).rejects.toThrow();

    expect(await context.mutations.reconcileTombstones()).toBe(1);

    expect((await store!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages).toEqual([]);
    expect((await context.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(0);
    // Idempotent: a second pass finds nothing left to repair.
    expect(await context.mutations.reconcileTombstones()).toBe(0);
  });

  it('leaves the row and the embedding agreeing after a failed edit', async () => {
    const context = await setup();
    await seed(context);
    const store = await context.storage.getStore('memory');
    const saveMessages = vi.spyOn(store!, 'saveMessages');
    // Fail the final, pending-clearing write: the row has been marked, the
    // vector has been replaced, and the mutation is interrupted at the end.
    saveMessages.mockImplementationOnce(saveMessages.getMockImplementation()!);
    saveMessages.mockRejectedValueOnce(new Error('synthetic settle failure'));

    const handler = new MutationHandler({ storage: context.mutations, policy });
    const event = mutationEvent('edit');

    await expect(handler.handle({ event, identity: identityFor(event) })).rejects.toThrow();
    saveMessages.mockRestore();

    // Compensation ran, so this is a clean revert to the pre-edit state rather
    // than a half-applied edit. What slack-event.md §4 forbids is the pre-edit
    // embedding surviving *alongside* post-edit text; the invariant to hold
    // here is that the row and the vector describe the same message. The crash
    // case, where compensation never runs, is covered by the pending-marker
    // test below.
    const store2 = await context.storage.getStore('memory');
    const row = (await store2!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages[0];
    const rowText = row?.content.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n');

    const results = await context.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorFor(rowText ?? ''),
      topK: 5,
    });
    const stored = results.find((match) => match.metadata?.message_id === MESSAGE_KEY);
    expect(stored?.metadata?.content).toBe(rowText);
    expect(row?.content.metadata?.gist_mutation_pending).toBeUndefined();
  });

  it('repairs a row left marked mid-edit', async () => {
    const context = await setup();
    await seed(context);
    const store = await context.storage.getStore('memory');

    // The exact state a crash between the marker write and the settle write
    // leaves behind: new text on the row, pending marker set, old embedding.
    const pending = storedMessage({
      content: {
        format: 2,
        parts: [{ type: 'text', text: NEW_TEXT }],
        metadata: {
          ...storedMessage().content.metadata,
          edited_at: '2025-01-01T00:12:00.000Z',
          gist_mutation_pending: true,
        },
      },
    });
    await store!.saveMessages({ messages: [pending] });

    expect(await context.mutations.reconcileTombstones()).toBe(1);

    const repaired = (await store!.listMessagesById({ messageIds: [MESSAGE_KEY] })).messages[0];
    expect(repaired?.content.metadata?.gist_mutation_pending).toBeUndefined();
    const results = await context.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorFor(NEW_TEXT),
      topK: 5,
    });
    expect(results[0]?.metadata?.content).toBe(NEW_TEXT);
    expect(await context.mutations.reconcileTombstones()).toBe(0);
  });
});

/** Design review F-07 — a de-approved channel with no recorded removal time. */
describe('F-07: retention starts the clock instead of never purging', () => {
  it('reports a de-approved channel that has no recorded removal time', async () => {
    const context = await setup();
    const removed = storedMessage({
      id: `${WORKSPACE}/C0REMOVED01/1735689800.000100`,
      resourceId: `ch:${WORKSPACE}:C0REMOVED01`,
      threadId: `ch:${WORKSPACE}:C0REMOVED01#1735689800.000100`,
    });
    await seed(context, removed);

    const handler = new MutationHandler({ storage: context.mutations, policy });
    const result = await handler.sweepRetention({
      now: '2025-04-02T00:00:00.000Z',
      approved_channel_ids: [APPROVED_CHANNEL],
      channel_removed_at: {},
    });

    expect(result.unrecorded_channel_removals).toEqual(['C0REMOVED01']);
    expect(result.channel_removal_starts).toEqual({
      C0REMOVED01: '2025-04-02T00:00:00.000Z',
    });
    // Nothing is purged yet — no elapsed grace period can be proven
    // retroactively — but the channel is now visible in the report.
    expect(result.deleted).toBe(0);
  });

  it('purges once the reported removal time has been persisted and aged out', async () => {
    const context = await setup();
    const removed = storedMessage({
      id: `${WORKSPACE}/C0REMOVED01/1735689800.000100`,
      resourceId: `ch:${WORKSPACE}:C0REMOVED01`,
      threadId: `ch:${WORKSPACE}:C0REMOVED01#1735689800.000100`,
    });
    await seed(context, removed);
    const handler = new MutationHandler({ storage: context.mutations, policy });

    const first = await handler.sweepRetention({
      now: '2025-03-01T00:00:00.000Z',
      approved_channel_ids: [APPROVED_CHANNEL],
      channel_removed_at: {},
    });
    expect(first.deleted).toBe(0);

    // The caller persists what the sweep reported, and the clock now runs.
    const second = await handler.sweepRetention({
      now: '2025-04-02T00:00:00.000Z',
      approved_channel_ids: [APPROVED_CHANNEL],
      channel_removed_at: first.channel_removal_starts,
    });

    expect(second.unrecorded_channel_removals).toEqual([]);
    expect(second.deleted).toBe(1);
  });

  it('keeps reporting the channel until the removal time is recorded', async () => {
    const context = await setup();
    const removed = storedMessage({
      id: `${WORKSPACE}/C0REMOVED01/1735689800.000100`,
      resourceId: `ch:${WORKSPACE}:C0REMOVED01`,
      threadId: `ch:${WORKSPACE}:C0REMOVED01#1735689800.000100`,
    });
    await seed(context, removed);
    const handler = new MutationHandler({ storage: context.mutations, policy });

    for (const now of ['2025-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z']) {
      const result = await handler.sweepRetention({
        now,
        approved_channel_ids: [APPROVED_CHANNEL],
        channel_removed_at: {},
      });
      expect(result.unrecorded_channel_removals).toEqual(['C0REMOVED01']);
    }
  });
});
