import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { describe, expect, it } from 'vitest';

import {
  AmbientPersistenceService,
  MastraMutationStorage,
  MutationHandler,
  type AmbientNormalizedEvent,
  type MutationEvent,
  type OriginalMessageEvent,
} from '../../../src/ingestion/index.js';
import {
  createGistAgent,
  createGistModel,
} from '../../../src/mastra/agents/gist.js';
import {
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import {
  messageKey,
  resolveIdentity,
} from '../../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
  type PolicySnapshot,
} from '../../../src/security/index.js';
import { SYNTHETIC } from './fixtures.js';

const LIVE_PROVIDER = process.env.T406_LIVE_PROVIDER === '1';
const MESSAGE_TS = '1735689800.000100';
const SENT_AT = '2025-01-01T00:03:20.000Z';
const ORIGINAL_TEXT = 'Synthetic T406 fact: Project Marigold uses cobalt release tags.';
const EDITED_TEXT = 'Synthetic T406 fact: Project Marigold now uses amber release tags.';
const SECOND_CHANNEL = 'C0APPROVED2';

const POLICY: PolicySnapshot = {
  approved_workspace_id: SYNTHETIC.workspace,
  approved_channel_ids: [SYNTHETIC.channel, SECOND_CHANNEL],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

function ambientEvent(
  overrides: Partial<AmbientNormalizedEvent> = {},
): AmbientNormalizedEvent {
  return {
    contract_version: '1.0.0',
    class: 'ambient',
    workspace_id: SYNTHETIC.workspace,
    channel_id: SYNTHETIC.channel,
    conversation_type: 'channel',
    sender_id: SYNTHETIC.user,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    message_ts: MESSAGE_TS,
    event_id: 'Ev0T406PROVIDER1',
    thread_ts: null,
    sent_at: SENT_AT,
    text: ORIGINAL_TEXT,
    addressed_to_gist: false,
    ...overrides,
  };
}

function mutationEvent(kind: 'edit' | 'delete'): MutationEvent {
  return {
    ...ambientEvent(),
    class: 'mutation',
    message_ts: MESSAGE_TS,
    mutation: kind === 'edit'
      ? {
          kind,
          target_ts: MESSAGE_TS,
          edited_at: '2025-01-01T00:10:00.000Z',
          new_text: EDITED_TEXT,
        }
      : {
          kind,
          target_ts: MESSAGE_TS,
          edited_at: '2025-01-01T00:12:00.000Z',
        },
  };
}

async function setupProviderRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 't406-provider-'));
  const databaseUrl = pathToFileURL(join(directory, 'mastra.db')).href;
  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  const vector = memory.vector as LibSQLVector;
  const mutationStorage = new MastraMutationStorage({ memory, storage });
  const mutations = new MutationHandler({ storage: mutationStorage, policy: POLICY });
  const persistence = new AmbientPersistenceService({
    memory,
    storage,
    resolveIdentity,
    authorizeWrite: ({ event, identity }) => authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'write_memory',
      event,
      identity,
      policy: POLICY,
    }),
  });

  return {
    memory,
    mutations,
    persistence,
    storage,
    vector,
    close: async () => {
      await memory.settled();
      await vector.close();
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function seedAmbient(
  runtime: Awaited<ReturnType<typeof setupProviderRuntime>>,
  event = ambientEvent(),
) {
  await expect(runtime.persistence.persist({
    event,
    sender_name: 'Synthetic Validator',
  })).resolves.toEqual({ outcome: 'inserted' });
  return { event, identity: resolveIdentity(event), key: messageKey(event) };
}

describe.runIf(LIVE_PROVIDER)('T406 real OpenAI provider validation', () => {
  it('recalls a paraphrased ambient fact and generates a cited grounded answer', async () => {
    const runtime = await setupProviderRuntime();
    try {
      const { identity, key } = await seedAmbient(runtime);
      const reply = await seedAmbient(runtime, ambientEvent({
        message_ts: '1735689805.000100',
        event_id: 'Ev0T406PROVIDER2',
        thread_ts: MESSAGE_TS,
        sent_at: '2025-01-01T00:03:25.000Z',
        text: 'Synthetic T406 reply: Project Marigold release tags are reviewed monthly.',
      }));
      expect(reply.identity.resource_id).toBe(identity.resource_id);
      expect(reply.identity.thread_id).toBe(identity.thread_id);

      const otherChannel = await seedAmbient(runtime, ambientEvent({
        channel_id: SECOND_CHANNEL,
        message_ts: '1735689810.000100',
        event_id: 'Ev0T406PROVIDER3',
        sent_at: '2025-01-01T00:03:30.000Z',
        text: 'Synthetic boundary decoy: Project Marigold uses vermilion release tags.',
      }));
      expect(otherChannel.identity.boundary_id).not.toBe(identity.boundary_id);

      const store = await runtime.storage.getStore('memory');
      const storedReply = (await store!.listMessagesById({
        messageIds: [reply.key],
      })).messages[0];
      expect(storedReply).toMatchObject({
        resourceId: identity.resource_id,
        threadId: identity.thread_id,
      });

      const queryThread = `${identity.boundary_id}#1735690800.000200` as const;
      await runtime.memory.createThread({
        threadId: queryThread,
        resourceId: identity.resource_id,
        saveThread: true,
      });

      const query = 'Which color identifies Project Marigold release tags?';
      const recalled = await runtime.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: identity.resource_id,
        vectorSearchString: query,
        perPage: 0,
      });
      expect(recalled.map(({ message_key }) => message_key)).toContain(key);
      expect(recalled.map(({ message_key }) => message_key)).not.toContain(otherChannel.key);
      expect(recalled.every(({ boundary_id }) => boundary_id === identity.boundary_id)).toBe(true);

      const agent = createGistAgent(createGistModel('gpt-4.1'), runtime.memory);
      const response = await agent.generate(query, {
        memory: {
          resource: identity.resource_id,
          thread: queryThread,
        },
      });
      const answer = response.text.toLowerCase();
      expect(answer).toContain('cobalt');
      expect(answer).not.toContain('vermilion');
      expect(answer).toContain('synthetic validator');
      expect(answer).toMatch(/2025|jan/);
    } finally {
      await runtime.close();
    }
  }, 120_000);

  it('re-embeds an edit, makes retries idempotent, and hard-deletes with a tombstone', async () => {
    const runtime = await setupProviderRuntime();
    try {
      const { event, identity, key } = await seedAmbient(runtime);
      const edit = mutationEvent('edit');

      await expect(runtime.mutations.handle({ event: edit, identity })).resolves.toMatchObject({
        status: 'updated',
        message_key: key,
      });
      await expect(runtime.mutations.handle({ event: edit, identity })).resolves.toMatchObject({
        status: 'unchanged',
        message_key: key,
      });

      const store = await runtime.storage.getStore('memory');
      const edited = (await store!.listMessagesById({ messageIds: [key] })).messages[0];
      expect(edited?.content.parts).toEqual([{ type: 'text', text: EDITED_TEXT }]);
      expect((await runtime.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
      const editedVector = await runtime.memory.embedder!.doEmbed({ values: [EDITED_TEXT] });
      const matches = await runtime.vector.query({
        indexName: 'memory_messages',
        queryVector: editedVector.embeddings[0]!,
        topK: 5,
      });
      expect(matches.find(({ id }) => id === key)?.metadata?.content).toBe(EDITED_TEXT);

      const deletion = mutationEvent('delete');
      await expect(runtime.mutations.handle({ event: deletion, identity })).resolves.toMatchObject({
        status: 'deleted',
        message_key: key,
      });
      await expect(runtime.mutations.handle({ event: deletion, identity })).resolves.toMatchObject({
        status: 'unchanged',
        message_key: key,
      });
      expect((await store!.listMessagesById({ messageIds: [key] })).messages).toEqual([]);
      expect((await runtime.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(0);

      const original: OriginalMessageEvent = event;
      await expect(runtime.mutations.shouldSuppressOriginal({
        event: original,
        identity,
      })).resolves.toEqual({ status: 'allowed', suppressed: true });
      const resource = await store!.getResourceById({ resourceId: identity.boundary_id });
      expect(JSON.stringify(resource?.metadata)).toContain(key);
      expect(JSON.stringify(resource?.metadata)).not.toContain(ORIGINAL_TEXT);
      expect(JSON.stringify(resource?.metadata)).not.toContain(EDITED_TEXT);
    } finally {
      await runtime.close();
    }
  }, 120_000);
});
