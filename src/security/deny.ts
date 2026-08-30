/**
 * What a denial is allowed to say, to a user and to a log.
 *
 * Contract: docs/architecture/contracts/errors.md §1, §3, §5.
 * Requirements: FR-RSP-007/008, FR-PRV-008, INV-11, INV-12.
 *
 * Two audiences, never mixed. The Slack user gets at most one fixed sentence
 * that never explains why. The application log gets reason codes and counts,
 * and never an identifier, a name, or a byte of message text.
 */

import type { AuthorizationDecision, DenyReason, Gate } from './types.js';

/** errors.md §3 — the exact `unauthorized` string. Not model-generated. */
export const UNAUTHORIZED_USER_MESSAGE = "I can't help with that here.";

/**
 * Denials that produce **no reply at all**.
 *
 * Mirrors the split T104 recorded and implemented in
 * `src/mastra/channels/errors.ts`, and is pinned against it by test. The
 * reasoning is T104's: workspace- and channel-scoped denials must be silent
 * because replying would mean Gist speaking in a channel it is not approved
 * for, and would confirm to an outsider that the bot is present (FR-SLK-010,
 * INV-11). Non-human senders are ignored under FR-SLK-009, and answering an
 * unresolvable or malformed identity would tell an unidentified caller that
 * something is listening.
 *
 * Every other reason is user-scoped — a person Gist can identify is not
 * entitled — and gets the single generic line.
 */
export const SILENT_DENY_REASONS: ReadonlySet<DenyReason> = Object.freeze(
  new Set<DenyReason>([
    'unapproved_workspace',
    'unapproved_channel',
    'bot_or_app_sender',
    'identity_unresolved',
    'malformed_request',
  ]),
);

export const SPOKEN_DENY_REASONS: ReadonlySet<DenyReason> = Object.freeze(
  new Set<DenyReason>([
    'external_user',
    'guest_user',
    'deactivated_user',
    'not_in_allowlist',
    'dm_shared_knowledge_disabled',
  ]),
);

/** True when the denial warrants the one generic line. */
export function shouldNotifyUser(reason: DenyReason | null): boolean {
  if (reason === null) return false;
  return !SILENT_DENY_REASONS.has(reason);
}

/**
 * The user-facing text for a denial, or null when the denial is silent.
 *
 * There is exactly one string. Distinguishing "channel not approved" from
 * "you are a guest" would tell an unauthorized asker about the policy and
 * about the channel's existence (errors.md §3 rule 1).
 */
export function userMessageForDeny(reason: DenyReason | null): string | null {
  return shouldNotifyUser(reason) ? UNAUTHORIZED_USER_MESSAGE : null;
}

/**
 * Fields safe for the unrestricted 14-day application log.
 *
 * Deliberately carries no workspace, channel, user, boundary, or thread
 * identifier and no message text. errors.md §5 permits `boundary_id` in logs
 * generally but forbids "deny reasons naming a channel"; the safe reading for
 * a denial record is to emit the reason code and the conversation kind and
 * nothing that identifies where or who. Callers add their own `run_id`.
 */
export interface DenyLogFields {
  readonly class: 'unauthorized';
  readonly gate: Gate;
  readonly reason: DenyReason;
}

export function denyLogFields(decision: AuthorizationDecision): DenyLogFields | null {
  if (decision.allowed || decision.reason === null) return null;
  return Object.freeze({
    class: 'unauthorized' as const,
    gate: decision.gate,
    reason: decision.reason,
  });
}
