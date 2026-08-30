/**
 * Gist Slack channel composition.
 *
 * T104 builds and returns the channel; it does not start it and does not
 * register itself with the Mastra runtime. Mounting belongs to T106
 * (`src/mastra/index.ts`), which is outside this task's write scope.
 */

import { Chat, type Adapter } from 'chat';
import type { SlackAdapter } from '@chat-adapter/slack';

import { createGistHandlers, type GistHandlers } from './handlers.js';
import { createGistSlackAdapter } from './slack-adapter.js';
import type { SlackChannelOptions } from './types.js';

/** Slack display name (FR-SLK-001, FR-RSP-001). */
export const GIST_USER_NAME = 'Gist';

export interface GistSlackChannel {
  readonly bot: Chat;
  readonly adapter: SlackAdapter;
  readonly handlers: GistHandlers;
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

  const bot = new Chat({
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
    start: async () => {
      // Socket Mode connects during adapter initialization (FR-SLK-011).
      await bot.initialize();
    },
    stop: async () => {
      await bot.shutdown();
    },
  };
}

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
