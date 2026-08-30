/**
 * Test doubles for the Slack channel.
 *
 * Everything here is synthetic and offline. No Slack API call, no socket, and
 * no network access occurs in these tests (T104 acceptance: "No production
 * Slack call occurs in unit tests").
 *
 * Synthetic identifiers follow
 * docs/architecture/contracts/fixtures/manifest.json.
 */

import type { Message, StateAdapter, Thread } from 'chat';

import type {
  ChannelAuthorizationDecision,
  ChannelRequest,
  SlackChannelOptions,
} from '../../src/mastra/channels/types.js';

export const SYNTHETIC = {
  workspaceApproved: 'T0SYNTH01',
  channelApproved: 'C0APPROVED1',
  channelUnapproved: 'C0UNAPPROV9',
  dmConversation: 'D0DMCONV01',
  userMember: 'U0MEMBER01',
  userGuest: 'U0GUEST001',
  userExternal: 'U0EXTERN01',
  bot: 'B0GISTBOT1',
  botToken: 'xoxb-synthetic-not-a-real-token',
  appToken: 'xapp-synthetic-not-a-real-token',
} as const;

/** Records every call so tests can assert reply counts (FR-SLK-007). */
export interface FakeThread {
  thread: Thread;
  posts: unknown[];
  typingCalls: number;
  subscribeCalls: number;
}

export function makeThread(options?: {
  channelId?: string;
  threadId?: string;
  isDM?: boolean;
  typingThrows?: boolean;
}): FakeThread {
  const record: FakeThread = {
    posts: [],
    typingCalls: 0,
    subscribeCalls: 0,
    thread: undefined as unknown as Thread,
  };

  const thread = {
    id: options?.threadId ?? 'slack:C0APPROVED1:1735689650.000100',
    channelId: options?.channelId ?? SYNTHETIC.channelApproved,
    isDM: options?.isDM ?? false,
    post: async (message: unknown) => {
      record.posts.push(message);
      return undefined as never;
    },
    startTyping: async () => {
      record.typingCalls += 1;
      if (options?.typingThrows) throw new Error('typing unavailable');
    },
    subscribe: async () => {
      record.subscribeCalls += 1;
    },
  };

  record.thread = thread as unknown as Thread;
  return record;
}

export function makeMessage(options?: {
  text?: string;
  ts?: string;
  userId?: string;
  fullName?: string;
  isBot?: boolean | 'unknown';
  isMe?: boolean;
  isSystem?: boolean;
  team?: string;
  raw?: Record<string, unknown>;
}): Message {
  const ts = options?.ts ?? '1735689700.000100';
  return {
    id: ts,
    threadId: 'slack:C0APPROVED1:1735689650.000100',
    text: options?.text ?? 'remind us what the rollout window was',
    author: {
      userId: options?.userId ?? SYNTHETIC.userMember,
      userName: 'synthetic.member',
      fullName: options?.fullName ?? 'Synthetic Member One',
      isBot: options?.isBot ?? false,
      isMe: options?.isMe ?? false,
      ...(options?.isSystem === undefined ? {} : { isSystem: options.isSystem }),
    },
    raw: options?.raw ?? { ts, team: options?.team ?? SYNTHETIC.workspaceApproved },
  } as unknown as Message;
}

/** In-memory StateAdapter. Sufficient for construction; no persistence claims. */
export function makeMemoryState(): StateAdapter {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const subscriptions = new Set<string>();
  const locks = new Map<string, string>();
  const queues = new Map<string, unknown[]>();
  let lockCounter = 0;

  return {
    acquireLock: async (threadId: string, ttlMs: number) => {
      if (locks.has(threadId)) return null;
      const token = `lock-${(lockCounter += 1)}`;
      locks.set(threadId, token);
      return { threadId, token, expiresAt: ttlMs };
    },
    appendToList: async (key: string, value: unknown) => {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
    },
    connect: async () => undefined,
    delete: async (key: string) => {
      values.delete(key);
    },
    dequeue: async (threadId: string) => {
      const queue = queues.get(threadId) ?? [];
      return (queue.shift() ?? null) as never;
    },
    disconnect: async () => undefined,
    enqueue: async (threadId: string, entry: unknown) => {
      const queue = queues.get(threadId) ?? [];
      queue.push(entry);
      queues.set(threadId, queue);
      return queue.length;
    },
    extendLock: async (lock: { threadId: string; token: string }) =>
      locks.get(lock.threadId) === lock.token,
    forceReleaseLock: async (threadId: string) => {
      locks.delete(threadId);
    },
    get: async (key: string) => (values.get(key) ?? null) as never,
    getList: async (key: string) => (lists.get(key) ?? []) as never,
    isSubscribed: async (threadId: string) => subscriptions.has(threadId),
    queueDepth: async (threadId: string) => (queues.get(threadId) ?? []).length,
    releaseLock: async (lock: { threadId: string; token: string }) => {
      if (locks.get(lock.threadId) === lock.token) locks.delete(lock.threadId);
    },
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    setIfNotExists: async (key: string, value: unknown) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    subscribe: async (threadId: string) => {
      subscriptions.add(threadId);
    },
    unsubscribe: async (threadId: string) => {
      subscriptions.delete(threadId);
    },
  } as unknown as StateAdapter;
}

export const ALLOW: ChannelAuthorizationDecision = { allowed: true, reason: null };

export interface OptionsRecord {
  options: SlackChannelOptions;
  authorizeCalls: ChannelRequest[];
  respondCalls: ChannelRequest[];
}

export function makeOptions(overrides?: {
  decision?: ChannelAuthorizationDecision;
  reply?: string;
  respondThrows?: unknown;
}): OptionsRecord {
  const authorizeCalls: ChannelRequest[] = [];
  const respondCalls: ChannelRequest[] = [];

  const options: SlackChannelOptions = {
    credentials: { botToken: SYNTHETIC.botToken, appToken: SYNTHETIC.appToken },
    state: makeMemoryState(),
    authorize: (request) => {
      authorizeCalls.push(request);
      return overrides?.decision ?? ALLOW;
    },
    respond: async (request) => {
      respondCalls.push(request);
      if (overrides?.respondThrows !== undefined) throw overrides.respondThrows;
      return overrides?.reply ?? 'The rollout window was Tuesday 09:00-11:00 UTC.';
    },
  };

  return { options, authorizeCalls, respondCalls };
}
