/**
 * T401 spike fixtures.
 *
 * Everything here is synthetic and offline. The identifiers follow
 * docs/architecture/contracts/fixtures/manifest.json; no real workspace,
 * channel, user, or message content appears in this directory.
 *
 * The spike drives the *real* pinned `SlackAdapter` and `Chat` classes with
 * synthetic Slack event payloads rather than a hand-written fake, because the
 * question the spike has to answer is what the pinned SDK does — a fake would
 * only restate what this task assumed.
 */

import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';
import { Chat, type Adapter, type StateAdapter } from 'chat';

export const SYNTHETIC = {
  workspace: 'T0SYNTH01',
  channel: 'C0APPROVED1',
  dmConversation: 'D0DMCONV01',
  user: 'U0MEMBER01',
  otherUser: 'U0MEMBER02',
  botUserId: 'U0GISTBOT1',
  otherBotId: 'B0OTHERBOT',
  botToken: 'xoxb-synthetic-not-a-real-token',
  appToken: 'xapp-synthetic-not-a-real-token',
  rootTs: '1735689650.000100',
  replyTs: '1735689700.000100',
  /** slack-event.md §2 — the precision pair that must not converge. */
  precisionTsLong: '1735689600.000200',
  precisionTsShort: '1735689600.0002',
} as const;

interface Expiring {
  value: unknown;
  expiresAt: number | null;
}

/**
 * In-memory `StateAdapter` with real TTL semantics.
 *
 * TTL is honoured rather than ignored because the dedup behaviour the spike is
 * measuring is expressed entirely through `setIfNotExists(key, value, ttl)`.
 */
export function makeMemoryState(): StateAdapter {
  const values = new Map<string, Expiring>();
  const lists = new Map<string, unknown[]>();
  const subscriptions = new Set<string>();
  const locks = new Map<string, string>();
  const queues = new Map<string, unknown[]>();
  let lockCounter = 0;

  const live = (key: string): Expiring | undefined => {
    const entry = values.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };

  const state = {
    acquireLock: async (threadId: string, ttlMs: number) => {
      if (locks.has(threadId)) return null;
      const token = `lock-${(lockCounter += 1)}`;
      locks.set(threadId, token);
      return { threadId, token, expiresAt: Date.now() + ttlMs };
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
    dequeue: async (threadId: string) => (queues.get(threadId)?.shift() ?? null) as never,
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
    get: async (key: string) => (live(key)?.value ?? null) as never,
    getList: async (key: string) => (lists.get(key) ?? []) as never,
    isSubscribed: async (threadId: string) => subscriptions.has(threadId),
    queueDepth: async (threadId: string) => (queues.get(threadId) ?? []).length,
    releaseLock: async (lock: { threadId: string; token: string }) => {
      if (locks.get(lock.threadId) === lock.token) locks.delete(lock.threadId);
    },
    set: async (key: string, value: unknown, ttlMs?: number) => {
      values.set(key, { value, expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs });
    },
    setIfNotExists: async (key: string, value: unknown, ttlMs?: number) => {
      if (live(key) !== undefined) return false;
      values.set(key, { value, expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs });
      return true;
    },
    subscribe: async (threadId: string) => {
      subscriptions.add(threadId);
    },
    unsubscribe: async (threadId: string) => {
      subscriptions.delete(threadId);
    },
  };

  return state as unknown as StateAdapter;
}

/** Which Chat handler a dispatched event reached. */
export interface HandlerLog {
  readonly calls: Array<{
    handler: string;
    threadId: string;
    messageId?: string;
    text?: string;
    isMention?: boolean;
    previousText?: string;
  }>;
  readonly posts: Array<{ threadId: string; body: unknown }>;
}

export interface SpikeHarness {
  readonly bot: Chat;
  readonly adapter: SlackAdapter;
  readonly state: StateAdapter;
  readonly log: HandlerLog;
  /** Feed a raw Slack envelope through the adapter's shared dispatch. */
  deliver(payload: Record<string, unknown>): Promise<void>;
}

/**
 * Build a Chat + real SlackAdapter pair with no network and no socket.
 *
 * Three seams are used, each recorded in the spike document:
 *  1. `adapter.chat` is assigned directly instead of calling `chat.initialize()`,
 *     which would open a Socket Mode connection.
 *  2. `botUserId` is supplied in the adapter config, so the adapter never calls
 *     `auth.test`.
 *  3. `lookupUser` is stubbed, so author resolution never calls `users.info`.
 */
export function makeHarness(options?: {
  ambientPattern?: RegExp;
  registerDirectMessage?: boolean;
  registerAmbient?: boolean;
}): SpikeHarness {
  const log: HandlerLog = { calls: [], posts: [] };

  const adapter = createSlackAdapter({
    mode: 'socket',
    botToken: SYNTHETIC.botToken,
    appToken: SYNTHETIC.appToken,
    botUserId: SYNTHETIC.botUserId,
  });

  const stubbed = adapter as unknown as {
    lookupUser: (userId: string) => Promise<unknown>;
    postMessage: (threadId: string, body: unknown) => Promise<unknown>;
  };
  stubbed.lookupUser = async (userId: string) => ({
    displayName: `synthetic.${userId}`,
    realName: `Synthetic ${userId}`,
    isBot: false,
  });
  // Any reply attempt is recorded instead of reaching Slack, so a test can
  // assert that the ambient path posts nothing at all.
  stubbed.postMessage = async (threadId: string, body: unknown) => {
    log.posts.push({ threadId, body });
    return { id: 'synthetic-post', raw: {} };
  };

  const state = makeMemoryState();
  const bot = new Chat({
    userName: 'Gist',
    adapters: { slack: adapter as unknown as Adapter },
    state,
  });

  if (options?.registerDirectMessage !== false) {
    bot.onDirectMessage(async (thread, message) => {
      log.calls.push({
        handler: 'onDirectMessage',
        threadId: thread.id,
        messageId: message.id,
        text: message.text,
      });
    });
  }

  bot.onNewMention(async (thread, message) => {
    log.calls.push({
      handler: 'onNewMention',
      threadId: thread.id,
      messageId: message.id,
      text: message.text,
      isMention: message.isMention === true,
    });
  });

  bot.onSubscribedMessage(async (thread, message) => {
    log.calls.push({
      handler: 'onSubscribedMessage',
      threadId: thread.id,
      messageId: message.id,
      text: message.text,
      isMention: message.isMention === true,
    });
  });

  if (options?.registerAmbient !== false) {
    bot.onNewMessage(options?.ambientPattern ?? /[\s\S]*/, async (thread, message) => {
      log.calls.push({
        handler: 'onNewMessage',
        threadId: thread.id,
        messageId: message.id,
        text: message.text,
        isMention: message.isMention === true,
      });
    });
  }

  bot.onMessageUpdated(async (thread, message, previousMessage) => {
    log.calls.push({
      handler: 'onMessageUpdated',
      threadId: thread.id,
      messageId: message.id,
      text: message.text,
      ...(previousMessage === undefined ? {} : { previousText: previousMessage.text }),
    });
  });

  bot.onMessageDeleted(async (event) => {
    log.calls.push({
      handler: 'onMessageDeleted',
      threadId: event.threadId,
      messageId: event.messageId,
      ...(event.previousMessage === undefined
        ? {}
        : { previousText: event.previousMessage.text }),
    });
  });

  // The adapter normally receives its Chat reference from `initialize()`,
  // which also opens the socket. Assigning it directly keeps the whole spike
  // offline while exercising the real dispatch path.
  (adapter as unknown as { chat: Chat }).chat = bot;

  const dispatch = adapter as unknown as {
    processEventPayload: (payload: Record<string, unknown>, options?: unknown) => void;
  };

  // The adapter starts `chat.processMessage(...)` and does not await it, so a
  // test that only drained the microtask queue could assert "no handler fired"
  // against work that had not started yet — every negative assertion in the
  // spike would pass for the wrong reason. Wrapping the three Chat entry
  // points captures the floating promises so `deliver` can await the real
  // completion instead of a timeout.
  const pending: Array<Promise<unknown>> = [];
  const chatInternals = bot as unknown as Record<string, (...args: never[]) => unknown>;
  for (const method of ['processMessage', 'processMessageUpdated', 'processMessageDeleted']) {
    const original = chatInternals[method];
    if (typeof original !== 'function') {
      throw new Error(`Chat.${method} is not a function on chat@4.39.0`);
    }
    const bound = original.bind(bot);
    chatInternals[method] = (...args: never[]) => {
      const result = bound(...args);
      pending.push(Promise.resolve(result));
      return result;
    };
  }

  return {
    bot,
    adapter,
    state,
    log,
    deliver: async (payload) => {
      dispatch.processEventPayload(payload, {
        waitUntil: (task: Promise<unknown>) => pending.push(task),
      });
      // Settle repeatedly: a handler can enqueue further work, and the queue
      // grows while it is being awaited.
      for (let round = 0; round < 5; round += 1) {
        const inFlight = pending.splice(0);
        if (inFlight.length > 0) await Promise.all(inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (pending.length === 0 && round > 0) break;
      }
    },
  };
}

let eventCounter = 0;

/** Wrap a Slack inner event in the `event_callback` envelope Slack sends. */
export function envelope(
  event: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  eventCounter += 1;
  return {
    type: 'event_callback',
    event,
    team_id: SYNTHETIC.workspace,
    event_id: `Ev0SYNTH${String(eventCounter).padStart(4, '0')}`,
    event_time: 1735689650,
    ...overrides,
  };
}

/** An ordinary human message in a public channel (`message.channels`). */
export function channelMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    user: SYNTHETIC.user,
    username: `synthetic.${SYNTHETIC.user}`,
    text: 'the rollout window moved to Tuesday',
    ts: SYNTHETIC.rootTs,
    team: SYNTHETIC.workspace,
    event_ts: SYNTHETIC.rootTs,
    ...overrides,
  };
}

/** A direct message (`message.im`). */
export function directMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    channel: SYNTHETIC.dmConversation,
    channel_type: 'im',
    text: 'what did we decide about the rollout?',
    ...overrides,
  });
}

/** An `app_mention` event, as Slack delivers it alongside `message`. */
export function mentionEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    type: 'app_mention',
    text: `<@${SYNTHETIC.botUserId}> what was the rollout window?`,
    ...overrides,
  });
}

/** A `message_changed` mutation (D005 edit). */
export function editEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = (overrides.ts as string | undefined) ?? SYNTHETIC.rootTs;
  return {
    type: 'message',
    subtype: 'message_changed',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    ts: '1735689800.000100',
    event_ts: '1735689800.000100',
    team: SYNTHETIC.workspace,
    message: {
      type: 'message',
      user: SYNTHETIC.user,
      username: `synthetic.${SYNTHETIC.user}`,
      text: 'the rollout window moved to Wednesday',
      ts,
      edited: { user: SYNTHETIC.user, ts: '1735689800.000000' },
    },
    previous_message: {
      type: 'message',
      user: SYNTHETIC.user,
      username: `synthetic.${SYNTHETIC.user}`,
      text: 'the rollout window moved to Tuesday',
      ts,
    },
    ...overrides,
  };
}

/** A `message_deleted` mutation (D005 delete). */
export function deleteEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = (overrides.deleted_ts as string | undefined) ?? SYNTHETIC.rootTs;
  return {
    type: 'message',
    subtype: 'message_deleted',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    deleted_ts: ts,
    ts: '1735689900.000100',
    event_ts: '1735689900.000100',
    team: SYNTHETIC.workspace,
    previous_message: {
      type: 'message',
      user: SYNTHETIC.user,
      username: `synthetic.${SYNTHETIC.user}`,
      text: 'the rollout window moved to Tuesday',
      ts,
    },
    ...overrides,
  };
}
