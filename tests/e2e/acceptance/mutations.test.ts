import { describe, expect, it } from 'vitest';

import {
  AmbientPersistenceService,
  MastraMutationStorage,
  MutationHandler,
  type AmbientNormalizedEvent,
  type MutationEvent,
} from '../../../src/ingestion/index.js';
import { messageKey, resolveIdentity } from '../../../src/mastra/memory/resource-policy.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
  type PolicySnapshot,
} from '../../../src/security/index.js';
import {
  closeValidationMemory,
  openValidationMemory,
  temporaryDatabase,
} from '../../integration/memory-validation/helpers.js';

const WORKSPACE = 'T0SYNTH01';
const CHANNEL = 'C0APPROVED1';
const USER = 'U0MEMBER01';
const MESSAGE_TS = '1735689800.000100';
const ORIGINAL_TEXT = 'Synthetic T501 decision: Project Marigold uses cobalt release tags.';
const EDITED_TEXT = 'Synthetic T501 decision: Project Marigold uses amber release tags.';

const POLICY: PolicySnapshot = {
  approved_workspace_id: WORKSPACE,
  approved_channel_ids: [CHANNEL],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

const ENROLLMENT = {
  isEnrolled: (workspaceId: string, channelId: string) =>
    workspaceId === WORKSPACE && channelId === CHANNEL,
  captureFloorTs: () => '1735689700.000100',
};

function ambient(): AmbientNormalizedEvent {
  return {
    contract_version: '1.0.0',
    class: 'ambient',
    workspace_id: WORKSPACE,
    channel_id: CHANNEL,
    conversation_type: 'channel',
    sender_id: USER,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    message_ts: MESSAGE_TS,
    event_id: 'Ev0T501MUTATION1',
    thread_ts: null,
    sent_at: '2025-01-01T00:03:20.000Z',
    text: ORIGINAL_TEXT,
    addressed_to_gist: false,
  };
}

function mutation(kind: 'edit' | 'delete'): MutationEvent {
  return {
    ...ambient(),
    class: 'mutation',
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

describe('T501 edit/delete mutation acceptance', () => {
  it('propagates an edit into message storage and its retrieval vector', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const event = ambient();
      const identity = resolveIdentity(event);
      const persistence = new AmbientPersistenceService({
        memory: runtime.memory,
        storage: runtime.storage,
        resolveIdentity,
        authorizeWrite: ({ event: candidate, identity: candidateIdentity }) => authorize({
          contract_version: AUTHORIZATION_CONTRACT_VERSION,
          gate: 'write_memory',
          event: candidate,
          identity: candidateIdentity,
          policy: POLICY,
        }),
      });
      const mutations = new MutationHandler({
        storage: new MastraMutationStorage({
          memory: runtime.memory,
          storage: runtime.storage,
        }),
        policy: POLICY,
        enrollment: ENROLLMENT,
      });
      const key = messageKey(event);

      await expect(persistence.persist({
        event,
        sender_name: 'Synthetic Member One',
      })).resolves.toEqual({ outcome: 'inserted' });
      await expect(mutations.handle({ event: mutation('edit'), identity }))
        .resolves.toMatchObject({ status: 'updated', message_key: key });

      const store = await runtime.storage.getStore('memory');
      const edited = (await store!.listMessagesById({ messageIds: [key] })).messages[0];
      expect(edited?.content.parts).toEqual([{ type: 'text', text: EDITED_TEXT }]);

      const queryVector = await runtime.memory.embedder!.doEmbed({ values: [EDITED_TEXT] });
      const matches = await runtime.vector.query({
        indexName: 'memory_messages',
        queryVector: queryVector.embeddings[0]!,
        topK: 5,
      });
      expect(matches.find(({ id }) => id === key)?.metadata?.content).toBe(EDITED_TEXT);
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });

  it('ignores a channel delete and retains message/vector storage without a tombstone', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const event = ambient();
      const identity = resolveIdentity(event);
      const persistence = new AmbientPersistenceService({
        memory: runtime.memory,
        storage: runtime.storage,
        resolveIdentity,
        authorizeWrite: ({ event: candidate, identity: candidateIdentity }) => authorize({
          contract_version: AUTHORIZATION_CONTRACT_VERSION,
          gate: 'write_memory',
          event: candidate,
          identity: candidateIdentity,
          policy: POLICY,
        }),
      });
      const mutations = new MutationHandler({
        storage: new MastraMutationStorage({
          memory: runtime.memory,
          storage: runtime.storage,
        }),
        policy: POLICY,
        enrollment: ENROLLMENT,
      });
      const key = messageKey(event);

      await persistence.persist({ event, sender_name: 'Synthetic Member One' });
      const store = await runtime.storage.getStore('memory');
      const resourceBefore = await store!.getResourceById({ resourceId: identity.boundary_id });
      const vectorCountBefore = (
        await runtime.vector.describeIndex({ indexName: 'memory_messages' })
      ).count;

      await expect(mutations.handle({ event: mutation('delete'), identity }))
        .resolves.toMatchObject({
          status: 'ignored',
          message_key: key,
          derivedInvalidation: [],
        });

      const retained = (await store!.listMessagesById({ messageIds: [key] })).messages[0];
      expect(retained?.content.parts).toEqual([{ type: 'text', text: ORIGINAL_TEXT }]);
      expect((await runtime.vector.describeIndex({ indexName: 'memory_messages' })).count)
        .toBe(vectorCountBefore);
      const queryVector = await runtime.memory.embedder!.doEmbed({ values: [ORIGINAL_TEXT] });
      const matches = await runtime.vector.query({
        indexName: 'memory_messages',
        queryVector: queryVector.embeddings[0]!,
        topK: 5,
      });
      expect(matches.find(({ id }) => id === key)?.metadata?.content).toBe(ORIGINAL_TEXT);

      const resourceAfter = await store!.getResourceById({ resourceId: identity.boundary_id });
      expect(resourceAfter?.metadata).toEqual(resourceBefore?.metadata);
      expect(JSON.stringify(resourceAfter?.metadata ?? {})).not.toContain(key);
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });
});
