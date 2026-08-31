import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MastraDBMessage } from '@mastra/core/agent';
import { MastraStateAdapter } from '@mastra/core/channels';
import {
  LibSQLFactoryStorage,
  LibSQLVector,
  type LibSQLStore,
} from '@mastra/libsql';
import type { Chat, WebhookOptions } from 'chat';
import { vi } from 'vitest';

import {
  JoinedChannelRegistry,
  type ChannelBoundaryId,
} from '../../../src/channel-memory/registry/index.js';
import {
  ChannelMessagePersistenceService,
  MastraMutationStorage,
  MutationHandler,
} from '../../../src/ingestion/index.js';
import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { DurableChannelDedupLedger } from '../../../src/mastra/channels/durable-dedup.js';
import {
  createLiveSlackChannel,
  type ChannelMemoryMetrics,
} from '../../../src/mastra/channels/slack.js';
import type { ChannelRequest } from '../../../src/mastra/channels/types.js';
import type { PolicySnapshot, SenderAttributes } from '../../../src/security/index.js';

export const IDS = {
  workspace: 'T0CHANTEST',
  channelA: 'C0CHANTESTA',
  channelB: 'C0CHANTESTB',
  human: 'U0TESTUSER1',
  gistUser: 'U0GISTBOT01',
  gistBot: 'B0GISTBOT01',
  kiloBot: 'B0KILOBOT01',
  kiloApp: 'A0KILOAPP01',
  otherApp: 'A0TESTAPP01',
  botToken: 'xoxb-synthetic-channel-memory',
  appToken: 'xapp-synthetic-channel-memory',
} as const;

export const TS = {
  joinA: '1767603600.000100',
  joinB: '1767603600.000200',
  root: '1767603601.000100',
  reply: '1767603602.000100',
  outgoing: '1767603610.000100',
} as const;

const POLICY: PolicySnapshot = {
  approved_workspace_id: IDS.workspace,
  approved_channel_ids: [],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
  displayName: 'Synthetic Member',
};

interface AdapterInternals {
  _botUserId: string;
  chat: Chat;
  lookupUser(userId: string): Promise<unknown>;
  postMessage(threadId: string, body: unknown): Promise<unknown>;
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
  startTyping(threadId: string): Promise<void>;
}

export interface TemporaryDatabase {
  readonly databaseUrl: string;
  remove(): Promise<void>;
}

export interface CaptureHarness {
  readonly adapter: AdapterInternals;
  readonly captureMetrics: ReturnType<typeof vi.fn>;
  readonly databaseUrl: string;
  readonly editMetrics: ReturnType<typeof vi.fn>;
  readonly enrollment: JoinedChannelRegistry;
  readonly memory: ReturnType<typeof createGistMemory>;
  readonly posts: unknown[];
  readonly respond: ReturnType<typeof vi.fn<(request: ChannelRequest) => Promise<string>>>;
  readonly storage: LibSQLStore;
  readonly typing: ReturnType<typeof vi.fn>;
  readonly vector: LibSQLVector;
  close(): Promise<void>;
  deliver(...payloads: Record<string, unknown>[]): Promise<void>;
  messages(): Promise<readonly MastraDBMessage[]>;
}

export async function temporaryDatabase(): Promise<TemporaryDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'gist-channel-memory-capture-e2e-'));
  return {
    databaseUrl: pathToFileURL(join(directory, 'mastra.db')).href,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

function vectorFor(text: string): number[] {
  const vector = Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase();
  const index = normalized.includes('edited')
    ? 1
    : normalized.includes('original')
      ? 0
      : normalized.includes('channel b')
        ? 2
        : normalized.includes('kilo')
          ? 3
          : normalized.includes('app')
            ? 4
            : 5;
  vector[index] = 1;
  return vector;
}

export async function createCaptureHarness(databaseUrl: string): Promise<CaptureHarness> {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const factoryStorage = new LibSQLFactoryStorage({
    id: 't607-channel-memory-capture',
    url: databaseUrl,
  });
  const enrollment = factoryStorage.registerDomain(new JoinedChannelRegistry());
  const idempotencyLedger = factoryStorage.registerDomain(new DurableChannelDedupLedger());
  await factoryStorage.init();
  const storage = factoryStorage.getMastraStorage() as unknown as LibSQLStore;
  await storage.init();
  const memoryStore = await storage.getStore('memory');
  if (!memoryStore) throw new Error('Synthetic memory store unavailable.');

  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  const vector = memory.vector as LibSQLVector;
  vi.spyOn(memory.embedder!, 'doEmbed').mockImplementation(
    async ({ values }: { values: string[] }) => ({
      embeddings: values.map(vectorFor),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );

  const boundaryFor = (workspaceId: string, channelId: string) =>
    `ch:${workspaceId}:${channelId}` as ChannelBoundaryId;
  const mutationStorage = new MastraMutationStorage({ memory, storage });
  const mutations = new MutationHandler({
    storage: mutationStorage,
    policy: POLICY,
    enrollment: {
      isEnrolled: async (workspaceId, channelId) =>
        (await enrollment.enrollmentFor(boundaryFor(workspaceId, channelId)))?.state === 'enrolled',
      captureFloorTs: async (workspaceId, channelId) =>
        (await enrollment.enrollmentFor(boundaryFor(workspaceId, channelId)))?.capture_floor_ts
          ?? null,
    },
  });
  const persistence = new ChannelMessagePersistenceService({ memory, storage });
  const state = new MastraStateAdapter(memoryStore, () => 't607-gist-agent');
  const captureMetrics = vi.fn();
  const editMetrics = vi.fn();
  const metrics: ChannelMemoryMetrics = {
    capture: captureMetrics,
    edit: editMetrics,
  };
  const respond = vi.fn(async (_request: ChannelRequest) => 'Synthetic Gist response.');

  const runtime = createLiveSlackChannel({
    credentials: { botToken: IDS.botToken, appToken: IDS.appToken },
    state,
    policy: POLICY,
    enrollment,
    idempotencyLedger,
    channelPersistence: persistence,
    mutations,
    metrics,
    kiloBotId: IDS.kiloBot,
    kiloAppId: IDS.kiloApp,
    resolveSender: async ({ senderId }) => senderId === IDS.human ? FULL_MEMBER : null,
    authorize: async () => ({ allowed: false, reason: 'unapproved_channel' }),
    authorizeCaptured: async () => ({ allowed: true, reason: null }),
    respond,
    now: () => new Date('2026-01-05T09:00:02.000Z'),
  });

  const posts: unknown[] = [];
  const typing = vi.fn(async () => undefined);
  const adapter = runtime.adapter as unknown as AdapterInternals;
  adapter._botUserId = IDS.gistUser;
  adapter.lookupUser = async (userId) => ({
    displayName: `synthetic.${userId}`,
    realName: `Synthetic ${userId}`,
    isBot: userId !== IDS.human,
  });
  adapter.postMessage = async (threadId, body) => {
    posts.push(body);
    return {
      id: TS.outgoing,
      threadId,
      raw: {
        ok: true,
        ts: TS.outgoing,
        message: {
          ts: TS.outgoing,
          thread_ts: TS.root,
          text: 'Synthetic Gist response.',
          user: IDS.gistUser,
          bot_id: IDS.gistBot,
        },
      },
    };
  };
  adapter.startTyping = typing;
  adapter.chat = runtime.bot;

  const pending: Promise<unknown>[] = [];
  const chatInternals = runtime.bot as unknown as Record<string, (...args: never[]) => unknown>;
  for (const method of ['processMessage', 'processMessageUpdated', 'processMessageDeleted']) {
    const original = chatInternals[method];
    if (typeof original !== 'function') throw new Error(`Missing Chat.${method}`);
    const bound = original.bind(runtime.bot);
    chatInternals[method] = (...args: never[]) => {
      const result = Promise.resolve(bound(...args));
      pending.push(result);
      return result;
    };
  }

  async function deliver(...payloads: Record<string, unknown>[]): Promise<void> {
    for (const payload of payloads) {
      adapter.processEventPayload(payload, { waitUntil: (task) => pending.push(task) });
      let settled = false;
      for (let round = 0; round < 12; round += 1) {
        const batch = pending.splice(0);
        if (batch.length > 0) await Promise.all(batch);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (pending.length === 0 && round > 0) {
          settled = true;
          break;
        }
      }
      if (!settled) throw new Error('Synthetic T607 delivery did not settle.');
    }
  }

  async function messages(): Promise<readonly MastraDBMessage[]> {
    const store = await storage.getStore('memory');
    if (!store) throw new Error('Synthetic memory store unavailable.');
    const threads = await store.listThreads({ perPage: false });
    const records: MastraDBMessage[] = [];
    for (const thread of threads.threads) {
      records.push(...(await store.listMessages({ threadId: thread.id, perPage: false })).messages);
    }
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  return {
    adapter,
    captureMetrics,
    databaseUrl,
    editMetrics,
    enrollment,
    memory,
    posts,
    respond,
    storage,
    typing,
    vector,
    close: async () => {
      await memory.settled();
      await vector.close();
      await factoryStorage.close();
    },
    deliver,
    messages,
  };
}

export function envelope(eventId: string, event: Record<string, unknown>) {
  return {
    type: 'event_callback',
    team_id: IDS.workspace,
    event_id: eventId,
    event,
  };
}

export function joinChannel(channel: string, ts: string, eventId: string) {
  return envelope(eventId, {
    type: 'member_joined_channel',
    team: IDS.workspace,
    channel,
    channel_type: 'C',
    user: IDS.gistUser,
    event_ts: ts,
  });
}

export function leaveChannel(channel: string, ts: string, eventId: string) {
  return envelope(eventId, {
    type: 'member_left_channel',
    team: IDS.workspace,
    channel,
    user: IDS.gistUser,
    event_ts: ts,
  });
}

export function message(overrides: Record<string, unknown> = {}) {
  const ts = typeof overrides.ts === 'string' ? overrides.ts : TS.root;
  return {
    type: 'message',
    team: IDS.workspace,
    channel: IDS.channelA,
    channel_type: 'channel',
    user: IDS.human,
    text: 'Synthetic original channel A message.',
    ts,
    event_ts: ts,
    ...overrides,
  };
}

export function vectorForText(text: string): number[] {
  return vectorFor(text);
}
