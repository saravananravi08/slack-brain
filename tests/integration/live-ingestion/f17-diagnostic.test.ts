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
 * This is a measurement, not a fix. It reports what it finds and asserts only
 * the facts it establishes.
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
  const response = await context.agent.stream(TURN_TEXT, {
    memory: { resource: BOUNDARY, thread: THREAD },
  });
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

describe('F-17 diagnostic: what the agent stores, and what a delete reaches', () => {
  /**
   * RESULT (measured 2026-08-30, integration/mastra-rewrite @ 9af00e0):
   * **F-17 is confirmed.** The agent persists the user turn under a random
   * UUID; the ambient writer persists the same Slack message under its
   * `messageKey`. A delete resolves by `messageKey` only, so the UUID row
   * survives with the message text intact.
   *
   * The assertions below pin that **defective** behaviour deliberately, so the
   * suite stays green and the defect stays visible. When F-17 is fixed these
   * tests must fail — each one names the assertion to invert.
   */

  it('persists the agent user turn under a UUID, not the message key', async () => {
    const context = await setup();
    await runAgentTurn(context);

    const rows = await rowsInThread(context);
    const userRows = rows.filter((row) => row.role === 'user');
    const turnRow = userRows.find((row) => textOf(row).includes('rollout window'));
    const expectedKey = toMessageKey({
      workspace_id: WORKSPACE,
      channel_id: CHANNEL,
      message_ts: TURN_TS,
    });

    expect(turnRow).toBeDefined();
    // The agent does persist the user turn — so a second copy genuinely exists.
    expect(textOf(turnRow!)).toContain('rollout window');

    // The measurement F-17 turns on. When fixed, the agent copy should carry
    // the messageKey (or be reachable by it) and these two invert.
    expect(turnRow!.id).not.toBe(expectedKey);
    expect(turnRow!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('leaves the agent copy behind when a subscribed-thread message is deleted', async () => {
    const context = await setup();

    // Both writers, one Slack message: the subscribed-thread case, where the
    // addressed path generates a reply *and* ambient persistence stores it.
    await runAgentTurn(context);
    const persisted = await context.ambient.persist({
      event: ambientEvent(TURN_TS, TURN_TEXT),
      sender_name: 'Synthetic Member',
    });
    expect(persisted.outcome).toBe('inserted');

    const before = await rowsInThread(context);
    const copiesBefore = before.filter((row) => textOf(row).includes('rollout window'));
    expect(copiesBefore).toHaveLength(2);

    const outcome = await context.mutations.handle({
      event: deleteEventFor(TURN_TS),
      identity: identityFor(TURN_TS),
    });
    expect(outcome.status).toBe('deleted');

    const after = await rowsInThread(context);
    const survivors = after.filter((row) => textOf(row).includes('rollout window'));

    // THE DEFECT. A user deleted their Slack message; its text is still here.
    // When F-17 is fixed this expectation becomes `toHaveLength(0)`.
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).not.toBe(
      toMessageKey({ workspace_id: WORKSPACE, channel_id: CHANNEL, message_ts: TURN_TS }),
    );
    expect(survivors[0]?.role).toBe('user');
  });

  it('deletes nothing at all for an addressed turn the agent alone stored', async () => {
    // The broader half of the finding: a mention or DM has no ambient copy, so
    // the mutation handler has nothing keyed by messageKey to resolve, and the
    // only stored copy is untouched.
    const context = await setup();
    await runAgentTurn(context);

    const outcome = await context.mutations.handle({
      event: deleteEventFor(TURN_TS),
      identity: identityFor(TURN_TS),
    });

    // Not an error, not a deletion: a no-op success against a message the
    // system is in fact holding.
    expect(outcome.status).toBe('unchanged');

    const survivors = (await rowsInThread(context)).filter((row) =>
      textOf(row).includes('rollout window'),
    );
    expect(survivors).toHaveLength(1);
  });
});
