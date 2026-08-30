/**
 * Types for the Gist authorization and privacy guard.
 *
 * Contracts:
 *   docs/architecture/contracts/authorization.md (gates, deny reasons, scope)
 *   docs/architecture/contracts/identity.md      (boundary shape)
 *   docs/architecture/contracts/slack-event.md   (event fields)
 *
 * Decisions: D001 (deny-by-default channel allowlist), D002 (DMs are
 * private-memory-only behind an off flag), D006 (workspace membership is
 * sufficient; external, guest, bot, and deactivated senders are excluded).
 *
 * This module deliberately imports nothing at runtime. The guard is pure and
 * total: no I/O, no clock, no ambient configuration (authorization.md §7).
 */

/** identity.md §1. The `ch:` / `dm:` prefix is what makes INV-3 structural. */
export type BoundaryId = `ch:${string}:${string}` | `dm:${string}:${string}`;
export type ResourceId = BoundaryId;
export type ThreadId = `${BoundaryId}#${string}`;

export type ConversationType = 'channel' | 'dm';

/** slack-event.md §2. */
export type SenderType = 'human' | 'bot' | 'app' | 'system';

/** authorization.md §1. */
export type Gate = 'accept_event' | 'write_memory' | 'read_memory';

/** authorization.md §3. Every value is safe to log and names no channel. */
export type DenyReason =
  | 'unapproved_workspace'
  | 'unapproved_channel'
  | 'external_user'
  | 'guest_user'
  | 'deactivated_user'
  | 'not_in_allowlist'
  | 'bot_or_app_sender'
  | 'dm_shared_knowledge_disabled'
  | 'identity_unresolved'
  | 'malformed_request';

/** identity.md §1. Produced by T202's resolver, never built here. */
export interface ResourceIdentity {
  readonly contract_version: string;
  readonly boundary_id: BoundaryId;
  readonly resource_id: ResourceId;
  readonly thread_id: ThreadId;
  readonly conversation_type: ConversationType;
}

/**
 * The subset of `NormalizedEvent` (slack-event.md §2) the guard reads.
 *
 * Declared structurally rather than importing the full event type, which
 * T402 owns. Field names match the contract so a `NormalizedEvent` satisfies
 * this interface without adaptation.
 *
 * `sender_is_deactivated` is the one field not present in slack-event.md §2.
 * D006 and `fixtures/authorization.v1.json` both require the deactivated-user
 * denial, so the attribute has to reach the guard somehow. It is **required**,
 * not optional: an absent value would otherwise default to "not deactivated",
 * which is the fail-open direction. Callers resolve it with the rest of the
 * sender attributes and fail closed when that lookup fails.
 */
export interface AuthorizationEvent {
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly conversation_type: ConversationType;
  readonly sender_id: string;
  readonly sender_type: SenderType;
  readonly sender_is_external: boolean;
  readonly sender_is_guest: boolean;
  readonly sender_is_deactivated: boolean;
}

/**
 * Channel membership for the D002-enabled shape only.
 *
 * Boundaries are supplied already composed, by the resolver that owns the
 * network call (authorization.md §7). The guard filters them; it never builds
 * a `BoundaryId`, because identity.md §4 forbids composing one outside
 * T202's `resource-policy.ts`.
 *
 * `unavailable` is the fail-closed signal: an errored, timed-out, or stale
 * lookup narrows scope (authorization.md §5.5). There is no third state — a
 * caller that cannot describe membership must say `unavailable`.
 */
export type MembershipResolution =
  | { readonly status: 'resolved'; readonly boundaries: readonly BoundaryId[] }
  | { readonly status: 'unavailable' };

/**
 * authorization.md §2. Passed in, never read from ambient globals (D001), so
 * two components can never be looking at different policy.
 */
export interface PolicySnapshot {
  readonly approved_workspace_id: string;
  /** GIST_APPROVED_CHANNEL_IDS. Never empty — an empty list denies (D001). */
  readonly approved_channel_ids: readonly string[];
  /** GIST_USER_ALLOWLIST. Empty means all full members (D006). */
  readonly user_allowlist: readonly string[];
  /** GIST_DM_SHARED_KNOWLEDGE. Accepted default false and must stay false. */
  readonly dm_shared_knowledge: boolean;
  /** Only consulted when `dm_shared_knowledge` is true (authorization.md §5). */
  readonly membership?: MembershipResolution;
}

export interface AuthorizationRequest {
  readonly contract_version: string;
  readonly gate: Gate;
  readonly event: AuthorizationEvent;
  readonly identity: ResourceIdentity;
  readonly policy: PolicySnapshot;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  /** Null iff allowed. */
  readonly reason: DenyReason | null;
  /** Non-empty iff allowed and gate is `read_memory` (authorization.md §2). */
  readonly scope: readonly BoundaryId[];
  /** Echoed for logs and for callers that branch on the gate. */
  readonly gate: Gate;
}
