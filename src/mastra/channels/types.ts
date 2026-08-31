/**
 * Port types for the Gist Slack channel.
 *
 * T104 owns transport only. Authorization (T203), memory (T201/T202), and
 * generation (T105) are injected as ports so this layer can be built and
 * tested before any of them exist, and so none of them can be reached by
 * accident from here.
 *
 * Contracts: docs/architecture/contracts/slack-event.md, authorization.md,
 * errors.md.
 */

import type { SentMessage, StateAdapter } from 'chat';

/** Which Slack surface produced this turn. All three permit generation. */
export type ChannelSurface = 'dm' | 'channel_mention' | 'subscribed_thread';

/**
 * A normalized, addressed turn handed to the responder port.
 *
 * This is deliberately a subset of the `NormalizedEvent` contract: T104 sees
 * only addressed traffic. Ambient messages and mutations are T402/T403/T404's
 * ingestion path and never reach this type.
 */
export interface ChannelRequest {
  readonly surface: ChannelSurface;
  /** Slack team ID when the adapter exposes it on the raw payload. */
  readonly workspaceId: string | undefined;
  readonly channelId: string;
  /** Chat SDK thread ID; stable for the life of the Slack thread. */
  readonly threadId: string;
  /** Slack message ts, verbatim string (slack-event.md §2 — never a float). */
  readonly messageTs: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly text: string;
  readonly isDirectMessage: boolean;
}

/**
 * Deny reasons this layer can act on. Subset of the authorization contract's
 * `DenyReason` union — T203 owns the full set and the decision logic.
 */
export type ChannelDenyReason =
  | 'unapproved_workspace'
  | 'unapproved_channel'
  | 'external_user'
  | 'guest_user'
  | 'deactivated_user'
  | 'not_in_allowlist'
  | 'bot_or_app_sender'
  | 'identity_unresolved'
  | 'malformed_request';

export interface ChannelAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: ChannelDenyReason | null;
}

/**
 * Authorization port — implemented by T203.
 *
 * Required, with no default. A missing authorizer is a construction error
 * rather than an open door (INV-1: absence of a decision denies).
 */
export type ChannelAuthorizer = (
  request: ChannelRequest,
) => Promise<ChannelAuthorizationDecision> | ChannelAuthorizationDecision;

/**
 * Generation port — implemented by T105 and wired by T106.
 *
 * Returns either a complete string or an async iterable of chunks; the Chat
 * SDK streams the latter natively (FR-SLK-006).
 */
export type ChannelResponder = (
  request: ChannelRequest,
) => Promise<string | AsyncIterable<string>>;

/** Minimal logger seam. Never receives message text (INV-12, FR-PRV-008). */
export interface ChannelLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Socket Mode credentials. Both are required and have no defaults
 * (FR-OPS-002, D001). T102 owns reading and validating the environment;
 * this layer only refuses to construct without them.
 */
export interface SlackChannelCredentials {
  /** Bot token, `xoxb-...`. */
  readonly botToken: string;
  /** App-level token, `xapp-...`. Required for Socket Mode (FR-SLK-011). */
  readonly appToken: string;
}

export interface SlackChannelOptions {
  readonly credentials: SlackChannelCredentials;
  /** Durable state: subscriptions, locks, and retry dedup (FR-SLK-008). */
  readonly state: StateAdapter;
  readonly authorize: ChannelAuthorizer;
  readonly respond: ChannelResponder;
  /** Live ingestion barrier. False silently suppresses response eligibility. */
  readonly beforeResponse?: (request: ChannelRequest) => Promise<boolean> | boolean;
  /** Called after Slack returns the canonical outgoing message identity. */
  readonly onOutgoingMessage?: (
    request: ChannelRequest,
    message: SentMessage,
  ) => Promise<void> | void;
  /** Slack display name. Defaults to "Gist" (FR-SLK-001, FR-RSP-001). */
  readonly userName?: string;
  readonly logger?: ChannelLogger;
  /** Retry-dedup TTL. Chat SDK default is 600_000 ms. */
  readonly dedupeTtlMs?: number;
}
