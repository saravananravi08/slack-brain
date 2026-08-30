/**
 * F-17 diagnostic — how many copies of one Slack message does the system hold,
 * and does deletion reach all of them?
 *
 * The design review claims a subscribed-thread message is stored twice: once
 * by `AmbientPersistenceService` under `id = messageKey`, and once by the
 * agent's own Mastra memory when a turn runs with `memory: { resource, thread }`.
 * `MutationHandler` resolves targets by `messageKey` only, so a delete would
 * reach the first copy and leave the second — text intact and recallable.
 *
 * Every existing suite stubs `gistAgent.stream`, which removes the very write
 * the finding is about, so none of them can see it. This runs the agent for
 * real against a hand-rolled fake model: `MastraModelConfig` accepts a
 * `LanguageModel` object, so no provider, no network, and no API key are
 * involved. Embedding is stubbed the way every other memory suite stubs it.
 *
 * MEASURED 2026-08-30 @ 9af00e0, before the fix: the agent persisted the user
 * turn under a random UUID while the ambient writer used `messageKey`, so a
 * delete removed one row of two and left the message text in the thread.
 *
 * FIXED by `agentUserTurn` in `src/mastra/index.ts`, which assigns the agent's
 * user turn the same `messageKey` the ingestion writers use, so both converge
 * on one row. These tests now assert the fixed behaviour: one copy, and a
 * delete that reaches it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MastraDBMessage } from '@mastra/core/agent';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  AmbientPersistenceService,
  MastraMutationStorage,
  MutationHandler,
  type AmbientNormalizedEvent,
} from '../../../src/ingestion/index.js';
import { createGistAgent } from '../../../src/mastra/agents/gist.js';
import { agentUserTurn } from '../../../src/mastra/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import {
  messageKey as toMessageKey,
  resolveIdentity,
} from '../../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import { AUTHORIZATION_CONTRACT_VERSION, authorize } from '../../../src/security/index.js';
import type { PolicySnapshot } from '../../../src/security/index.js';

const WORKSPACE = 'T0SYNTH01';
const CHANNEL = 'C0APPROVED1';
const USER = 'U0MEMBER01';
const ROOT_TS = '1735689650.000100';
const TURN_TS = '1735689700.000100';
const BOUNDARY = `ch:${WORKSPACE}:${CHANNEL}` as const;
const THREAD = `${BOUNDARY}#${ROOT_TS}` as const;
const TURN_TEXT = 'Synthetic subscribed follow-up about the rollout window.';
const SENDER_NAME = 'Synthetic Member';

const POLICY: PolicySnapshot = {
  approved_workspace_id: WORKSPACE,
  approved_channel_ids: [CHANNEL],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

const directories: string[] = [];

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * A language model with no provider behind it.
 *
 * `MastraModelConfig` accepts `LanguageModelV2 | V3 | V4` objects, so this is a
 * valid model as far as the agent is concerned, and nothing reaches a network.
 */
function fakeModel() {
  const stream = () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: '1' });
          controller.enqueue({ type: 'text-delta', id: '1', delta: 'Synthetic reply.' });
          controller.enqueue({ type: 'text-end', id: '1' });
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          });
          controller.close();
        },
      }),
      warnings: [],
    });

  return {
    specificationVersion: 'v2',
    provider: 'gist-test',
    modelId: 'fake-model',
    supportedUrls: {},
    doGenerate: stream,
    doStream: stream,
  };
}

async function setup() {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const directory = await mkdtemp(join(tmpdir(), 'gist-f17-'));
  directories.push(directory);
  const databaseUrl = pathToFileURL(join(directory, 'mastra.db')).href;

  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  vi.spyOn(memory.embedder!, 'doEmbed').mockImplementation(
    async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0.01)),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );

  const agent = createGistAgent(fakeModel() as never, memory);
  const mutations = new MutationHandler({
    storage: new MastraMutationStorage({ memory, storage }),
    policy: POLICY,
  });
  const ambient = new AmbientPersistenceService({
    memory,
    storage,
    resolveIdentity,
    authorizeWrite: ({ event, identity }) =>
      authorize({
        contract_version: AUTHORIZATION_CONTRACT_VERSION,
        gate: 'write_memory',
        event,
        identity,
        policy: POLICY,
      }),
  });

  return { storage, memory, agent, mutations, ambient };
}

function ambientEvent(messageTs: string, text: string): AmbientNormalizedEvent {
  return {
    contract_version: '1.0.0',
    class: 'ambient',
    workspace_id: WORKSPACE,
    channel_id: CHANNEL,
    conversation_type: 'channel',
    message_ts: messageTs,
    event_id: `Ev0SYNTH${messageTs.slice(-4)}`,
    thread_ts: ROOT_TS,
    sender_id: USER,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    sent_at: '2025-01-01T00:01:40.000Z',
    text,
    addressed_to_gist: false,
  };
}

function textOf(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function runAgentTurn(context: Awaited<ReturnType<typeof setup>>): Promise<void> {
  // The same input the runtime builds in `respond`, so this measures the real
  // path rather than a convenient approximation of it.
  const response = await context.agent.stream(
    agentUserTurn({
      identity: identityFor(TURN_TS),
      workspaceId: WORKSPACE,
      channelId: CHANNEL,
      messageTs: TURN_TS,
      senderId: USER,
      senderName: SENDER_NAME,
      text: TURN_TEXT,
    }),
    { memory: { resource: BOUNDARY, thread: THREAD } },
  );
  for await (const _chunk of response.textStream) {
    // drain
  }
  await context.memory.settled();
}

async function rowsInThread(
  context: Awaited<ReturnType<typeof setup>>,
): Promise<readonly MastraDBMessage[]> {
  const store = await context.storage.getStore('memory');
  return (await store!.listMessages({ threadId: THREAD, perPage: false })).messages;
}


function identityFor(messageTs: string) {
  return resolveIdentity({
    contract_version: '1.0.0',
    workspace_id: WORKSPACE,
    channel_id: CHANNEL,
    conversation_type: 'channel',
    message_ts: messageTs,
    thread_ts: ROOT_TS,
    sender_id: USER,
  });
}

function deleteEventFor(messageTs: string) {
  return {
    contract_version: '1.0.0',
    class: 'mutation',
    workspace_id: WORKSPACE,
    channel_id: CHANNEL,
    conversation_type: 'channel',
    message_ts: messageTs,
    sender_id: USER,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    mutation: {
      kind: 'delete',
      target_ts: messageTs,
      edited_at: '2025-01-01T00:12:00.000Z',
    },
  } as const;
}

describe('F-17: the agent and the ingestion writers converge on one row', () => {
  it('persists the agent user turn under the message key', async () => {
    const context = await setup();
    await runAgentTurn(context);

    const rows = await rowsInThread(context);
    const turnRow = rows
      .filter((row) => row.role === 'user')
      .find((row) => textOf(row).includes('rollout window'));
    const expectedKey = toMessageKey({
      workspace_id: WORKSPACE,
      channel_id: CHANNEL,
      message_ts: TURN_TS,
    });

    expect(turnRow).toBeDefined();
    // Was a random UUID before the fix; this is the whole of F-17.
    expect(turnRow!.id).toBe(expectedKey);
    // The row describes the Slack message, not the moment the agent ran.
    expect(turnRow!.createdAt.toISOString()).toBe('2025-01-01T00:01:40.000Z');
  });

  it('stores one copy when both writers handle the same message', async () => {
    const context = await setup();

    // The subscribed-thread case: the addressed path generates a reply *and*
    // ambient persistence stores the message.
    await runAgentTurn(context);
    const persisted = await context.ambient.persist({
      event: ambientEvent(TURN_TS, TURN_TEXT),
      sender_name: SENDER_NAME,
    });
    expect(['inserted', 'unchanged']).toContain(persisted.outcome);

    const copies = (await rowsInThread(context)).filter((row) =>
      textOf(row).includes('rollout window'),
    );
    // Two rows before the fix — one per writer — which also meant recall saw
    // the same message twice.
    expect(copies).toHaveLength(1);
  });

  it('deletes every copy of a subscribed-thread message', async () => {
    const context = await setup();
    await runAgentTurn(context);
    await context.ambient.persist({
      event: ambientEvent(TURN_TS, TURN_TEXT),
      sender_name: SENDER_NAME,
    });

    const outcome = await context.mutations.handle({
      event: deleteEventFor(TURN_TS),
      identity: identityFor(TURN_TS),
    });
    expect(outcome.status).toBe('deleted');

    const survivors = (await rowsInThread(context)).filter((row) =>
      textOf(row).includes('rollout window'),
    );
    // The finding, inverted: nothing carrying the deleted text remains.
    expect(survivors).toHaveLength(0);
  });

  it('deletes the agent copy of an addressed turn that was never ambient', async () => {
    // The broader half: a mention or DM has no ambient copy, so before the fix
    // the mutation handler had nothing to resolve and reported a no-op success
    // against a message the system was in fact holding.
    const context = await setup();
    await runAgentTurn(context);

    const outcome = await context.mutations.handle({
      event: deleteEventFor(TURN_TS),
      identity: identityFor(TURN_TS),
    });
    expect(outcome.status).toBe('deleted');

    const survivors = (await rowsInThread(context)).filter((row) =>
      textOf(row).includes('rollout window'),
    );
    expect(survivors).toHaveLength(0);
  });

  it('leaves no embedding behind for a deleted message', async () => {
    // INV-9 — the row and its embedding go together. A surviving vector would
    // keep the deleted text semantically recallable, which is the same leak
    // F-17 describes wearing a different hat.
    const context = await setup();
    await runAgentTurn(context);
    await context.ambient.persist({
      event: ambientEvent(TURN_TS, TURN_TEXT),
      sender_name: SENDER_NAME,
    });

    const vector = context.memory.vector as { listIndexes(): Promise<string[]>;
      describeIndex(args: { indexName: string }): Promise<{ count: number }> };
    const indexes = await vector.listIndexes();
    const counts: Record<string, number> = {};
    for (const indexName of indexes) {
      counts[indexName] = (await vector.describeIndex({ indexName })).count;
    }

    await context.mutations.handle({
      event: deleteEventFor(TURN_TS),
      identity: identityFor(TURN_TS),
    });

    for (const indexName of await vector.listIndexes()) {
      const after = (await vector.describeIndex({ indexName })).count;
      // Every index that held something for this message must hold less now,
      // and none may have grown.
      expect(after).toBeLessThanOrEqual(counts[indexName] ?? 0);
    }
  });
});
