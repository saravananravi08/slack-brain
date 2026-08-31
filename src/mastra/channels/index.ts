/**
 * Gist Slack channel composition.
 *
 * T104 builds and returns the channel; it does not start it and does not
 * register itself with the Mastra runtime. Mounting belongs to T106
 * (`src/mastra/index.ts`), which is outside this task's write scope.
 */

import { Chat, type Adapter, type Message } from 'chat';
import type { SlackAdapter } from '@chat-adapter/slack';

import { createGistHandlers, type GistHandlers } from './handlers.js';
import { createGistSlackAdapter } from './slack-adapter.js';
import type { ChannelLogger, SlackChannelOptions } from './types.js';

const NOOP_LOGGER: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Best-effort guess at whether a dropped message was addressed to Gist.
 *
 * The drop happens before the SDK classifies the message, so nothing
 * authoritative is available. Text-based mention detection is what the SDK
 * itself uses, so it is the closest available signal — but it is a *hint*, and
 * the field name says so.
 *
 * It matters because the two cases have very different weight: a dropped
 * addressed message means a user asked and got no answer, while a dropped
 * ambient message is the silent corpus gap F-19 describes. Only a boolean is
 * derived; no message text is retained or logged.
 */
function looksAddressed(message: Message, botUserId: string | undefined): boolean {
  if (botUserId === undefined) return false;
  const text = typeof message.text === 'string' ? message.text : '';
  return text.includes(`<@${botUserId}>`);
}

/** Slack display name (FR-SLK-001, FR-RSP-001). */
export const GIST_USER_NAME = 'Gist';

/**
 * Minimum gap between concurrency-drop warnings.
 *
 * Matches the F-18 missing-delivery-context warning: contention arrives in
 * bursts, and a line per drop would bury the signal it exists to provide. The
 * counter is exact regardless; only the logging is rate limited.
 */
const CONCURRENCY_DROP_WARN_INTERVAL_MS = 60_000;

/**
 * Running count of messages the Chat SDK dropped for thread-lock contention.
 *
 * The SDK's `concurrency: 'drop'` default discards a message that arrives while
 * a turn is already in flight **for the same thread**. That is deliberate for
 * the reply path — FR-SLK-007 permits at most one response per accepted
 * message — but ambient ingestion shares it, so a dropped ambient message is
 * never stored and FR-MEM-001 quietly does not hold for it.
 *
 * Design review F-19 accepted that behaviour and deferred the fix, because the
 * choice — move ingestion off the shared concurrency control, or accept and
 * count the loss — turns on how often it actually happens. Nobody knows that
 * number yet. This counter is how the beta produces it.
 */
export interface ConcurrencyDropCounter {
  /** Total drops since the channel was created. */
  readonly total: number;
  /** Drops seen since the last warning was emitted. */
  readonly sinceLastWarning: number;
  /** Epoch ms of the most recent drop, or null if none. */
  readonly lastDropAt: number | null;
}

export interface GistSlackChannel {
  readonly bot: Chat;
  readonly adapter: SlackAdapter;
  readonly handlers: GistHandlers;
  /** Snapshot of the F-19 drop counter. Cheap; safe to poll. */
  concurrencyDrops(): ConcurrencyDropCounter;
  /** Open the Socket Mode connection and begin routing. */
  start(): Promise<void>;
  /** Close the socket and the state connection. */
  stop(): Promise<void>;
}

/**
 * Compose adapter, Chat instance, and handler registration.
 *
 * `concurrency: 'drop'` is the Chat SDK default and is kept deliberately:
 * FR-SLK-007 allows at most one final response per accepted user message, so
 * a second message arriving mid-turn must not open a second generation for
 * the same thread.
 */
export function createSlackChannel(options: SlackChannelOptions): GistSlackChannel {
  const adapter = createGistSlackAdapter(options.credentials);
  const logger = options.logger ?? NOOP_LOGGER;

  let dropTotal = 0;
  let dropsSinceWarning = 0;
  let lastDropAt: number | null = null;
  let lastDropWarnAt: number | null = null;

  /**
   * Called by the Chat SDK when a thread lock cannot be acquired.
   *
   * `onLockConflict` is a supported configuration hook, so this observes the
   * drop rather than patching the SDK to detect it. **It must keep returning
   * `'drop'`**: returning `'force'` would break the lock and let a second turn
   * run concurrently on one thread, which is the behaviour FR-SLK-007 exists to
   * prevent. This changes nothing about what happens — it only makes it
   * countable.
   */
  const onLockConflict = (_threadId: string, message: Message): 'drop' => {
    const now = Date.now();
    dropTotal += 1;
    dropsSinceWarning += 1;
    lastDropAt = now;

    const rateLimited =
      lastDropWarnAt !== null && now - lastDropWarnAt < CONCURRENCY_DROP_WARN_INTERVAL_MS;
    if (!rateLimited) {
      lastDropWarnAt = now;
      // Reason code, counts, and a best-effort class only. No message text, no
      // channel, no user (INV-12, FR-PRV-008).
      logger.warn('ingestion.concurrency.dropped', {
        reason: 'thread_lock_contention',
        total: dropTotal,
        sinceLastWarning: dropsSinceWarning,
        likelyAddressed: looksAddressed(message, adapter.botUserId),
      });
      dropsSinceWarning = 0;
    }

    return 'drop';
  };

  const bot = new Chat({
    onLockConflict,
    userName: options.userName ?? GIST_USER_NAME,
    // `SlackAdapter` declares `botUserId: string | undefined` where the
    // `Adapter` interface declares it required. Under this project's
    // `exactOptionalPropertyTypes: true` that is a structural mismatch in the
    // published types, not a behavioral one — the adapter resolves its bot
    // user ID at initialize(). Narrowed here rather than by relaxing the
    // compiler options, which belong to T101.
    adapters: { slack: adapter as unknown as Adapter },
    state: options.state,
    ...(options.dedupeTtlMs === undefined ? {} : { dedupeTtlMs: options.dedupeTtlMs }),
  });

  const handlers = createGistHandlers(options);

  bot.onDirectMessage(handlers.onDirectMessage);
  bot.onNewMention(handlers.onNewMention);
  bot.onSubscribedMessage(handlers.onSubscribedMessage);

  return {
    bot,
    adapter,
    handlers,
    concurrencyDrops: () => ({
      total: dropTotal,
      sinceLastWarning: dropsSinceWarning,
      lastDropAt,
    }),
    start: async () => {
      // Socket Mode connects during adapter initialization (FR-SLK-011).
      await bot.initialize();
    },
    stop: async () => {
      await bot.shutdown();
    },
  };
}

export { DurableChannelDedupLedger } from './durable-dedup.js';
export { createGistSlackAdapter, SlackCredentialsError } from './slack-adapter.js';
export { createGistHandlers, handleTurn, toChannelRequest } from './handlers.js';
export type { GistHandlers } from './handlers.js';
export {
  ChannelError,
  classifyError,
  shouldReplyOnDeny,
  USER_FACING_MESSAGE,
  userFacingMessage,
} from './errors.js';
export type { ChannelErrorClass } from './errors.js';
export type {
  ChannelAuthorizationDecision,
  ChannelAuthorizer,
  ChannelDenyReason,
  ChannelLogger,
  ChannelRequest,
  ChannelResponder,
  ChannelSurface,
  SlackChannelCredentials,
  SlackChannelOptions,
} from './types.js';
