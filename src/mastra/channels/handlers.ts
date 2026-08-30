/**
 * Turn handlers for the Gist Slack surface.
 *
 * Exported as plain functions so they are testable without a socket, a Slack
 * workspace, or a running Chat instance (T104 acceptance: "No production Slack
 * call occurs in unit tests").
 *
 * This layer does not implement memory, retrieval, ingestion, or generation
 * (implementation step 3). It authorizes, shows activity, delegates to the
 * responder port, and posts exactly one reply.
 */

import type { Channel, Message, Thread } from 'chat';

import {
  ChannelError,
  classifyError,
  shouldReplyOnDeny,
  userFacingMessage,
} from './errors.js';
import type {
  ChannelLogger,
  ChannelRequest,
  ChannelSurface,
  SlackChannelOptions,
} from './types.js';

/** Slack `ts` for the message, read from the raw payload without parsing. */
function readMessageTs(message: Message): string {
  const raw = message.raw as { ts?: unknown; event_ts?: unknown } | undefined;
  const ts = raw?.ts ?? raw?.event_ts;
  // slack-event.md §2 — the verbatim string is the identity. Never Number().
  return typeof ts === 'string' ? ts : message.id;
}

/** Slack team ID when the payload carries it. */
function readWorkspaceId(message: Message): string | undefined {
  const raw = message.raw as { team?: unknown; team_id?: unknown } | undefined;
  const team = raw?.team ?? raw?.team_id;
  return typeof team === 'string' ? team : undefined;
}

export function toChannelRequest(
  surface: ChannelSurface,
  thread: Thread,
  message: Message,
  isDirectMessage: boolean,
): ChannelRequest {
  return {
    surface,
    workspaceId: readWorkspaceId(message),
    channelId: thread.channelId,
    threadId: thread.id,
    messageTs: readMessageTs(message),
    senderId: message.author.userId,
    senderName: message.author.fullName,
    text: message.text,
    isDirectMessage,
  };
}

/**
 * Ignore anything Gist itself or another bot produced (FR-SLK-009).
 *
 * The Chat SDK filters `isMe` centrally, but `isBot` is checked here too: a
 * second bot in an approved channel would otherwise be able to drive Gist,
 * and `isBot` can be the string `"unknown"`, which must not be treated as a
 * human.
 */
function isIgnorableSender(message: Message): boolean {
  const { isBot, isMe, isSystem } = message.author;
  return isMe || isSystem === true || isBot === true || isBot === 'unknown';
}

const NOOP_LOGGER: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface TurnOptions {
  /**
   * Subscribe to the thread after a positive authorization decision and
   * before responding. Used by the first-mention path so later replies need
   * no second mention (FR-SLK-005). Gist never subscribes to a thread it is
   * not authorized to answer in.
   */
  readonly subscribeOnAccept: boolean;
}

/**
 * Run one addressed turn.
 *
 * Guarantees, in order:
 *  1. Ignorable senders never reach authorization or generation.
 *  2. Authorization runs exactly once, before generation and before any
 *     responder call (INV-2). A denied turn costs no model call.
 *  3. Exactly one reply is posted per accepted turn, success or failure
 *     (FR-SLK-007). Errors post one mapped string, never a stack trace.
 */
export async function handleTurn(
  surface: ChannelSurface,
  thread: Thread,
  message: Message,
  isDirectMessage: boolean,
  options: SlackChannelOptions,
  turnOptions: TurnOptions = { subscribeOnAccept: false },
): Promise<void> {
  const logger = options.logger ?? NOOP_LOGGER;

  if (isIgnorableSender(message)) {
    logger.debug('channel.turn.ignored', { surface, reason: 'non_human_sender' });
    return;
  }

  const request = toChannelRequest(surface, thread, message, isDirectMessage);

  // INV-2 — authorization precedes retrieval, generation, and any storage read.
  const decision = await options.authorize(request);
  if (!decision.allowed) {
    logger.info('channel.turn.denied', { surface, reason: decision.reason });
    if (shouldReplyOnDeny(decision.reason)) {
      await thread.post(userFacingMessage(new ChannelError('unauthorized')));
    }
    return;
  }

  if (turnOptions.subscribeOnAccept) {
    await thread.subscribe();
  }

  // FR-SLK-006 — Slack-native activity before generation. A failure to show
  // typing must not fail the turn; the answer matters more than the indicator.
  try {
    await thread.startTyping();
  } catch (error) {
    logger.debug('channel.typing.failed', { surface, errorClass: classifyError(error) });
  }

  try {
    const reply = await options.respond(request);
    await thread.post(reply);
    logger.info('channel.turn.completed', { surface });
  } catch (error) {
    const errorClass = classifyError(error);
    logger.error('channel.turn.failed', { surface, errorClass });
    // The single reply for this turn (FR-SLK-007, FR-RSP-008).
    await thread.post(userFacingMessage(error));
  }
}

/**
 * Build the three handler boundaries without registering them, so tests can
 * invoke each directly.
 */
export interface GistHandlers {
  onDirectMessage: (thread: Thread, message: Message, channel?: Channel) => Promise<void>;
  onNewMention: (thread: Thread, message: Message) => Promise<void>;
  onSubscribedMessage: (thread: Thread, message: Message) => Promise<void>;
}

export function createGistHandlers(options: SlackChannelOptions): GistHandlers {
  return {
    /** UJ2 — a DM to Gist. */
    onDirectMessage: async (thread, message) => {
      await handleTurn('dm', thread, message, true, options);
    },

    /** UJ1 — first mention in a channel or thread; subscribes on accept. */
    onNewMention: async (thread, message) => {
      await handleTurn('channel_mention', thread, message, thread.isDM, options, {
        subscribeOnAccept: true,
      });
    },

    /** FR-SLK-005 — follow-up in a subscribed thread, no mention required. */
    onSubscribedMessage: async (thread, message) => {
      await handleTurn('subscribed_thread', thread, message, thread.isDM, options);
    },
  };
}
