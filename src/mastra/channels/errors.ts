/**
 * User-facing error strings for the Slack surface.
 *
 * Contract: docs/architecture/contracts/errors.md §3 — these strings are fixed
 * and must not be model-generated, because the error path must not depend on
 * the component that may be failing.
 *
 * Nothing here may name a provider, model, framework, storage path, boundary
 * or thread ID, or a deny reason (INV-11, FR-RSP-007/008).
 */

import type { ChannelDenyReason } from './types.js';

export type ChannelErrorClass =
  | 'unauthorized'
  | 'retrieval_failed'
  | 'storage_unavailable'
  | 'model_unavailable'
  | 'model_refused'
  | 'event_malformed'
  | 'internal';

/** Exact strings from errors.md §3. Pinned by tests/channels/errors.test.ts. */
export const USER_FACING_MESSAGE: Readonly<Record<ChannelErrorClass, string>> = {
  unauthorized: "I can't help with that here.",
  retrieval_failed: "I couldn't get to my notes just now — try again in a moment.",
  storage_unavailable: "I couldn't get to my notes just now — try again in a moment.",
  model_unavailable: "I couldn't finish that one. Try again in a moment.",
  model_refused: "I couldn't finish that one. Try again in a moment.",
  event_malformed: 'Something went wrong on my end.',
  internal: 'Something went wrong on my end.',
};

/**
 * Deny reasons that must produce **no reply at all**.
 *
 * FR-SLK-010 requires events from unapproved workspaces and channels to be
 * ignored — posting there would mean Gist speaking in a channel it is not
 * approved for, and would confirm to an outsider that the bot is present.
 * Bot/app senders are ignored under FR-SLK-009.
 *
 * Every other deny reason is user-scoped (the asker is not entitled), and gets
 * the single generic `unauthorized` line, which never explains why.
 */
const SILENT_DENY_REASONS: ReadonlySet<ChannelDenyReason> = new Set([
  'unapproved_workspace',
  'unapproved_channel',
  'bot_or_app_sender',
  'identity_unresolved',
  'malformed_request',
]);

export function shouldReplyOnDeny(reason: ChannelDenyReason | null): boolean {
  if (reason === null) return false;
  return !SILENT_DENY_REASONS.has(reason);
}

/**
 * Error raised by a responder to select a specific user-facing class.
 * Anything else thrown maps to `internal`.
 */
export class ChannelError extends Error {
  readonly errorClass: ChannelErrorClass;

  constructor(errorClass: ChannelErrorClass, message?: string) {
    super(message ?? errorClass);
    this.name = 'ChannelError';
    this.errorClass = errorClass;
  }
}

/**
 * Map a thrown value to a user-facing class. Unknown failures degrade to
 * `internal` rather than surfacing their message, so a provider or storage
 * error string can never reach Slack.
 */
export function classifyError(error: unknown): ChannelErrorClass {
  if (error instanceof ChannelError) return error.errorClass;
  return 'internal';
}

export function userFacingMessage(error: unknown): string {
  return USER_FACING_MESSAGE[classifyError(error)];
}
