/**
 * T401 live probe — opt-in, never part of `npm test`.
 *
 * Connects the pinned Socket Mode adapter to the isolated development
 * workspace, posts one synthetic marker message as the bot, edits it, deletes
 * it, and records the *shape* of every Slack envelope that arrives. Its
 * purpose is to confirm that the synthetic fixtures used by the offline spike
 * match what Slack actually delivers for ordinary (non-mention) channel
 * traffic.
 *
 * It never posts anything a human would read as a Gist reply, and it deletes
 * what it posts. It prints structure only — no token, no message text, and no
 * raw identifier is written to stdout in full.
 *
 * Run:
 *   node --env-file=.env --experimental-strip-types \
 *     tests/spikes/slack-events/live-probe.ts
 *
 * Requires SLACK_BOT_TOKEN and SLACK_APP_TOKEN, plus a target:
 *
 *   GIST_DEV_CHANNEL_ID    channel mode — needs the app to be a member of
 *                          that channel, which is what exercises
 *                          `message.channels`.
 *   GIST_DEV_DM_USER_ID    DM mode — exercises `message.im` instead. Set it to
 *                          the Slack user ID of the operator or a dedicated
 *                          test account. The probe DMs **only** that user.
 *
 * Set both and DM mode wins, because it needs no channel membership. There is
 * deliberately no discovery of a DM counterparty: picking one from
 * `users.list` would mean messaging a person nobody nominated.
 */

import { createSlackAdapter } from '@chat-adapter/slack';
import { Chat, type Adapter, type StateAdapter } from 'chat';

/**
 * Minimal in-memory state, inlined rather than imported from `helpers.ts`:
 * this file runs under `node --experimental-strip-types`, which does not
 * rewrite a `.js` specifier onto a `.ts` source. Keeping the probe
 * self-contained is what makes it runnable at all.
 */
function makeMemoryState(): StateAdapter {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const subscriptions = new Set<string>();
  const locks = new Map<string, string>();
  const queues = new Map<string, unknown[]>();
  let lockCounter = 0;

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
  };

  return state as unknown as StateAdapter;
}

interface EnvelopeRecord {
  readonly eventType: string;
  readonly subtype: string | undefined;
  readonly hasEventId: boolean;
  readonly channelType: string | undefined;
  readonly hasTeam: boolean;
  readonly hasThreadTs: boolean;
  readonly tsShape: string;
  readonly hasBotId: boolean;
  readonly hasPreviousMessage: boolean;
  readonly hasDeletedTs: boolean;
  readonly isExtSharedChannel: boolean | undefined;
  readonly keys: readonly string[];
}

const HANDLER_CALLS: string[] = [];
const ENVELOPES: EnvelopeRecord[] = [];

function shapeOfTs(value: unknown): string {
  if (typeof value !== 'string') return `not-a-string(${typeof value})`;
  return /^\d{10}\.\d{6}$/.test(value) ? 'string:<10>.<6>' : `string:${value.length} chars`;
}

function record(payload: Record<string, unknown>): void {
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const inner = (event.message ?? {}) as Record<string, unknown>;
  ENVELOPES.push({
    eventType: String(event.type ?? 'unknown'),
    subtype: typeof event.subtype === 'string' ? event.subtype : undefined,
    hasEventId: typeof payload.event_id === 'string',
    channelType: typeof event.channel_type === 'string' ? event.channel_type : undefined,
    hasTeam: typeof event.team === 'string' || typeof payload.team_id === 'string',
    hasThreadTs: typeof event.thread_ts === 'string' || typeof inner.thread_ts === 'string',
    tsShape: shapeOfTs(event.ts ?? inner.ts),
    hasBotId: typeof event.bot_id === 'string' || typeof inner.bot_id === 'string',
    hasPreviousMessage: typeof event.previous_message === 'object' && event.previous_message !== null,
    hasDeletedTs: typeof event.deleted_ts === 'string',
    isExtSharedChannel:
      typeof payload.is_ext_shared_channel === 'boolean'
        ? payload.is_ext_shared_channel
        : undefined,
    keys: Object.keys(event).sort(),
  });
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function slackGet(
  token: string,
  method: string,
  query: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(query).toString()}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Report what the installed token can actually do, before trying to use it.
 *
 * A probe that only says "post failed" costs the next operator three more runs
 * to find out why. Scope *names* are printed; no token value ever is.
 */
async function preflight(
  botToken: string,
  target: ProbeTarget,
): Promise<{ canPost: boolean; canReadUsers: boolean; reachable: boolean }> {
  const response = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: '{}',
  });
  const granted = (response.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
  const auth = (await response.json()) as { ok?: boolean; user_id?: string };

  const required =
    target.kind === 'dm'
      ? ['chat:write', 'users:read', 'im:write', 'im:history']
      : ['chat:write', 'users:read', 'channels:history', 'app_mentions:read'];
  const missing = required.filter((scope) => !granted.includes(scope));

  // A read method must be sent as GET with query parameters; a JSON POST
  // returns `invalid_arguments`, which would read as "not a member" rather
  // than "malformed call".
  const users = (await slackGet(botToken, 'users.info', {
    user: auth.user_id ?? '',
  })) as { ok?: boolean; error?: string };

  console.log('auth.test ok:', auth.ok === true);
  console.log('probe mode:', target.kind);
  console.log('granted scopes:', granted.join(', ') || '(none reported)');
  console.log('missing required scopes:', missing.join(', ') || '(none)');
  console.log('users.info (T203 sender resolver):', {
    ok: users.ok === true,
    error: users.error,
  });

  let reachable = false;
  if (target.kind === 'channel') {
    const info = (await slackGet(botToken, 'conversations.info', {
      channel: target.channelId,
    })) as { ok?: boolean; error?: string; channel?: { is_member?: boolean } };
    reachable = info.channel?.is_member === true;
    console.log('probe channel is_member:', reachable, { error: info.error });
  } else {
    // `conversations.open` returns the DM channel without sending anything.
    const opened = (await slackApi(botToken, 'conversations.open', {
      users: target.userId,
    })) as { ok?: boolean; error?: string; channel?: { id?: string } };
    reachable = opened.ok === true && typeof opened.channel?.id === 'string';
    if (reachable) target.channelId = opened.channel?.id;
    console.log('DM channel opened:', reachable, { error: opened.error });
  }

  return {
    canPost: granted.includes('chat:write'),
    canReadUsers: users.ok === true,
    reachable,
  };
}

/** Where the probe will post. Exactly one target is used per run. */
type ProbeTarget =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm'; userId: string; channelId?: string | undefined };

function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is not set. Load it with node --env-file=.env`);
  }
  return value;
}

async function main(): Promise<void> {
  const botToken = required('SLACK_BOT_TOKEN');
  const appToken = required('SLACK_APP_TOKEN');

  // DM mode wins when both are set: it needs no channel membership, so it is
  // the one that can run while the app is still outside the probe channel.
  const dmUserId = process.env.GIST_DEV_DM_USER_ID;
  const target: ProbeTarget =
    typeof dmUserId === 'string' && dmUserId.trim() !== ''
      ? { kind: 'dm', userId: dmUserId.trim() }
      : { kind: 'channel', channelId: required('GIST_DEV_CHANNEL_ID') };

  const checks = await preflight(botToken, target);
  if (!(checks.canPost && checks.reachable)) {
    console.log(
      target.kind === 'channel'
        ? [
            '\nPreflight failed: the app cannot post to the probe channel.',
            'Add the Gist Dev app to that channel (Slack → the channel →',
            'Integrations → Add apps), or set GIST_DEV_DM_USER_ID to run the',
            'DM path instead, which needs no channel membership.',
          ].join(' ')
        : [
            '\nPreflight failed: the app cannot open a DM with GIST_DEV_DM_USER_ID.',
            'Check that the ID is a real, active, non-bot user in this workspace.',
          ].join(' '),
      '\nStopping before any write — a probe does not post into a workspace it',
      'cannot first confirm it belongs in.',
    );
    process.exit(2);
  }

  const channelId = target.kind === 'dm' ? (target.channelId ?? '') : target.channelId;

  const adapter = createSlackAdapter({ mode: 'socket', botToken, appToken });

  // Tap the adapter's shared dispatch (socket and webhook both funnel here) so
  // the probe sees every envelope, including the ones the Chat class filters
  // out as self-authored.
  const tapped = adapter as unknown as {
    processEventPayload: (payload: Record<string, unknown>, options?: unknown) => void;
  };
  const original = tapped.processEventPayload.bind(tapped);
  tapped.processEventPayload = (payload, options) => {
    record(payload);
    return original(payload, options);
  };

  const state: StateAdapter = makeMemoryState();
  const bot = new Chat({
    userName: 'Gist Probe',
    adapters: { slack: adapter as unknown as Adapter },
    state,
  });

  // Handlers only record. Nothing here posts, so a probe run can never look
  // like a Gist reply in the development channel.
  bot.onNewMessage(/[\s\S]*/, async () => {
    HANDLER_CALLS.push('onNewMessage');
  });
  bot.onNewMention(async () => {
    HANDLER_CALLS.push('onNewMention');
  });
  bot.onSubscribedMessage(async () => {
    HANDLER_CALLS.push('onSubscribedMessage');
  });
  bot.onDirectMessage(async () => {
    HANDLER_CALLS.push('onDirectMessage');
  });
  bot.onMessageUpdated(async () => {
    HANDLER_CALLS.push('onMessageUpdated');
  });
  bot.onMessageDeleted(async () => {
    HANDLER_CALLS.push('onMessageDeleted');
  });

  await bot.initialize();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const marker = `T401 spike probe — synthetic, no production data (${Date.now()})`;
  const posted = await slackApi(botToken, 'chat.postMessage', {
    channel: channelId,
    text: marker,
  });
  const ts = posted.ts;
  console.log('post ok:', posted.ok === true, 'ts shape:', shapeOfTs(ts));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  if (typeof ts === 'string') {
    const replied = await slackApi(botToken, 'chat.postMessage', {
      channel: channelId,
      thread_ts: ts,
      text: 'T401 spike probe — threaded reply, synthetic',
    });
    const replyTs = replied.ts;
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const edited = await slackApi(botToken, 'chat.update', {
      channel: channelId,
      ts,
      text: `${marker} [edited]`,
    });
    console.log('edit ok:', edited.ok === true);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (typeof replyTs === 'string') {
      await slackApi(botToken, 'chat.delete', { channel: channelId, ts: replyTs });
    }
    const deleted = await slackApi(botToken, 'chat.delete', { channel: channelId, ts });
    console.log('delete ok:', deleted.ok === true);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  await bot.shutdown();

  console.log('\n--- envelopes observed ---');
  console.log(JSON.stringify(ENVELOPES, null, 2));
  console.log('\n--- chat handlers invoked ---');
  console.log(JSON.stringify(HANDLER_CALLS));
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('probe failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
