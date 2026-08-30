/**
 * The authorization guard.
 *
 * Contract: docs/architecture/contracts/authorization.md.
 * Decisions: D001 (deny-by-default channel allowlist), D002 (DM shared
 * knowledge off), D006 (workspace membership sufficient; external, guest,
 * bot, and deactivated senders excluded).
 *
 * `authorize` is pure and total: same input, same output; no I/O, no clock,
 * no randomness, no ambient configuration. Every input that is not a valid,
 * approved request produces a deny — including inputs that are not valid
 * requests at all. Absence of a positive decision is a denial (INV-1).
 */

import { parseBoundaryId } from './boundary.js';
import type {
  AuthorizationDecision,
  AuthorizationEvent,
  AuthorizationRequest,
  BoundaryId,
  ConversationType,
  DenyReason,
  Gate,
  PolicySnapshot,
  ResourceIdentity,
  SenderType,
} from './types.js';

/** The contract this implementation speaks. Majors must match. */
export const AUTHORIZATION_CONTRACT_VERSION = '1.0.0';

const GATES: ReadonlySet<string> = new Set<Gate>([
  'accept_event',
  'write_memory',
  'read_memory',
]);

const CONVERSATION_TYPES: ReadonlySet<string> = new Set<ConversationType>(['channel', 'dm']);

const SENDER_TYPES: ReadonlySet<string> = new Set<SenderType>([
  'human',
  'bot',
  'app',
  'system',
]);

const NO_SCOPE: readonly BoundaryId[] = Object.freeze([]);

/**
 * Raised when a caller asks for retrieval scope it was not granted.
 *
 * Deliberately loud. Returning an empty array here would be read at the call
 * site as "no filter", which is the shape of a corpus-wide leak.
 */
export class AuthorizationScopeError extends Error {
  readonly reason: DenyReason | null;

  constructor(reason: DenyReason | null) {
    super('Retrieval scope requested for a decision that granted none');
    this.name = 'AuthorizationScopeError';
    this.reason = reason;
  }
}

function deny(gate: Gate, reason: DenyReason): AuthorizationDecision {
  return Object.freeze({ allowed: false, reason, scope: NO_SCOPE, gate });
}

function allow(gate: Gate, scope: readonly BoundaryId[]): AuthorizationDecision {
  return Object.freeze({
    allowed: true,
    reason: null,
    scope: Object.freeze([...scope]),
    gate,
  });
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function majorOf(version: string): string | null {
  const major = version.split('.')[0];
  return major === undefined || major === '' ? null : major;
}

/**
 * Structural validation of the request envelope.
 *
 * Runs before the ordered rules because rules 1–7 cannot be evaluated against
 * a request whose fields are missing or of the wrong type. Blank-but-typed
 * values (an empty `sender_id`, say) are *not* checked here — they are left to
 * step 8 so the contract's stated rule order is preserved exactly.
 */
function envelopeIsMalformed(request: AuthorizationRequest): boolean {
  if (typeof request !== 'object' || request === null) return true;

  const { contract_version: version, gate, event, identity, policy } = request;

  if (!isNonBlankString(version)) return true;
  if (majorOf(version) !== majorOf(AUTHORIZATION_CONTRACT_VERSION)) return true;
  if (typeof gate !== 'string' || !GATES.has(gate)) return true;

  if (typeof event !== 'object' || event === null) return true;
  if (typeof event.workspace_id !== 'string') return true;
  if (typeof event.channel_id !== 'string') return true;
  if (!CONVERSATION_TYPES.has(event.conversation_type)) return true;
  if (typeof event.sender_id !== 'string') return true;
  if (!SENDER_TYPES.has(event.sender_type)) return true;
  if (typeof event.sender_is_external !== 'boolean') return true;
  if (typeof event.sender_is_guest !== 'boolean') return true;
  if (typeof event.sender_is_deactivated !== 'boolean') return true;

  if (typeof identity !== 'object' || identity === null) return true;

  if (typeof policy !== 'object' || policy === null) return true;
  if (!isNonBlankString(policy.approved_workspace_id)) return true;
  if (!isStringArray(policy.approved_channel_ids)) return true;
  // D001: an empty allowlist is "no channels approved", never "all channels
  // approved". T102 fails startup on this; the guard denies as well, so a
  // policy that reaches the guard degraded cannot open the door.
  if (policy.approved_channel_ids.length === 0) return true;
  if (!isStringArray(policy.user_allowlist)) return true;
  if (typeof policy.dm_shared_knowledge !== 'boolean') return true;

  return false;
}

/**
 * The ordered rules of authorization.md §4. First deny wins and evaluation
 * stops — a later check must never run against an already-denied request.
 *
 * The order is load-bearing: external and guest denials (D006, FR-PRV-006)
 * precede the channel-approval check, so an external user in an approved
 * channel is denied as `external_user`, not silently accepted.
 */
const ORDERED_RULES: ReadonlyArray<{
  readonly reason: DenyReason;
  readonly denies: (event: AuthorizationEvent, policy: PolicySnapshot) => boolean;
}> = Object.freeze([
  {
    reason: 'unapproved_workspace',
    denies: (event, policy) => event.workspace_id !== policy.approved_workspace_id,
  },
  { reason: 'external_user', denies: (event) => event.sender_is_external },
  { reason: 'guest_user', denies: (event) => event.sender_is_guest },
  { reason: 'bot_or_app_sender', denies: (event) => event.sender_type !== 'human' },
  { reason: 'deactivated_user', denies: (event) => event.sender_is_deactivated },
  {
    reason: 'not_in_allowlist',
    denies: (event, policy) =>
      policy.user_allowlist.length > 0 && !policy.user_allowlist.includes(event.sender_id),
  },
  {
    reason: 'unapproved_channel',
    denies: (event, policy) =>
      event.conversation_type === 'channel' &&
      !policy.approved_channel_ids.includes(event.channel_id),
  },
]);

/**
 * Step 8 — the identity must resolve, and must describe the event in front of
 * us.
 *
 * This is the structural half of INV-3 and FR-PRV-004: a DM event carrying a
 * `ch:` boundary is rejected here rather than writing private DM content into
 * shared channel knowledge. The check is on agreement, not on format alone.
 */
function identityIsUnresolved(identity: ResourceIdentity, event: AuthorizationEvent): boolean {
  if (!isNonBlankString(identity.contract_version)) return true;
  if (majorOf(identity.contract_version) !== majorOf(AUTHORIZATION_CONTRACT_VERSION)) {
    return true;
  }
  if (!CONVERSATION_TYPES.has(identity.conversation_type)) return true;
  if (identity.conversation_type !== event.conversation_type) return true;

  const boundary = parseBoundaryId(identity.boundary_id);
  if (boundary === null) return true;
  if (boundary.kind !== event.conversation_type) return true;
  if (boundary.workspaceId !== event.workspace_id) return true;

  // identity.md §2: a channel boundary keys on the channel; a DM boundary keys
  // on the human user, never on Slack's D... conversation ID.
  const expectedKey =
    event.conversation_type === 'channel' ? event.channel_id : event.sender_id;
  if (boundary.resourceKey !== expectedKey) return true;

  // identity.md §2 rule 3 — resource_id === boundary_id in v1.
  if (identity.resource_id !== identity.boundary_id) return true;

  if (typeof identity.thread_id !== 'string') return true;
  const separator = `${identity.boundary_id}#`;
  if (!identity.thread_id.startsWith(separator)) return true;
  if (identity.thread_id.length <= separator.length) return true;

  return false;
}

/**
 * Retrieval scope (authorization.md §5, D002).
 *
 * The list is exhaustive, not a hint: retrieval must query these boundaries
 * and no others.
 *
 *  - A channel request receives its own channel boundary and nothing else —
 *    never another channel (FR-PRV-002, AC-11), never any `dm:` boundary
 *    (FR-PRV-004, AC-10).
 *  - A DM request under the accepted default receives that user's private
 *    boundary only (INV-5, FR-PRV-005). This is the whole of D002.
 *  - The `dm_shared_knowledge: true` branch is the shape D002 specifies for a
 *    future re-approval. It is unreachable in this build: T102 types
 *    `GIST_DM_SHARED_KNOWLEDGE` as the literal `false`, so no configuration
 *    can turn it on. It is implemented and tested so that enabling it later is
 *    a configuration change against a known shape rather than a redesign.
 *  - Membership that is unavailable or absent narrows scope to the DM
 *    boundary. A failed lookup must never widen scope (authorization.md §5.5).
 */
function retrievalScopeFor(
  event: AuthorizationEvent,
  identity: ResourceIdentity,
  policy: PolicySnapshot,
): readonly BoundaryId[] {
  const own = identity.boundary_id;

  if (event.conversation_type === 'channel') return [own];
  if (!policy.dm_shared_knowledge) return [own];

  const membership = policy.membership;
  if (membership === undefined || membership.status !== 'resolved') return [own];

  // Ordered by the approved list so the result is deterministic, and filtered
  // through it so membership can only ever narrow the approved set — a
  // boundary the user belongs to but that is not approved never appears.
  const shared: BoundaryId[] = [];
  for (const channelId of policy.approved_channel_ids) {
    for (const candidate of membership.boundaries) {
      const parsed = parseBoundaryId(candidate);
      if (parsed === null || parsed.kind !== 'channel') continue;
      if (parsed.workspaceId !== policy.approved_workspace_id) continue;
      if (parsed.resourceKey !== channelId) continue;
      if (!shared.includes(candidate)) shared.push(candidate);
    }
  }

  return [own, ...shared];
}

/**
 * Decide one gate for one event.
 *
 * Call this before the first storage read or write on every path, including
 * mutations (INV-2, D005): a mutation for an unapproved channel is denied
 * before lookup, so a mutation event cannot probe what Gist holds.
 */
export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  if (envelopeIsMalformed(request)) {
    // The gate may itself be the malformed part; report the request's gate
    // only when it is one we recognise.
    const requested = (request as { gate?: unknown } | null | undefined)?.gate;
    const gate: Gate =
      typeof requested === 'string' && GATES.has(requested)
        ? (requested as Gate)
        : 'accept_event';
    return deny(gate, 'malformed_request');
  }

  const { gate, event, identity, policy } = request;

  for (const rule of ORDERED_RULES) {
    if (rule.denies(event, policy)) return deny(gate, rule.reason);
  }

  // Step 8 — malformed identifiers, then identity agreement.
  if (!isNonBlankString(event.workspace_id)) return deny(gate, 'malformed_request');
  if (!isNonBlankString(event.channel_id)) return deny(gate, 'malformed_request');
  if (!isNonBlankString(event.sender_id)) return deny(gate, 'malformed_request');
  if (identityIsUnresolved(identity, event)) return deny(gate, 'identity_unresolved');

  if (gate !== 'read_memory') return allow(gate, NO_SCOPE);

  const scope = retrievalScopeFor(event, identity, policy);
  // authorization.md §5.6 — an allowed decision with an empty scope is a
  // contract violation, not an empty search. Deny rather than emit one.
  if (scope.length === 0) return deny(gate, 'identity_unresolved');

  return allow(gate, scope);
}

/**
 * The boundaries this decision may read.
 *
 * Throws for a denied decision, or for one that granted no scope. Retrieval
 * callers must pass this list as a filter; an empty filter would mean "search
 * everything", so this function never hands one back.
 */
export function retrievalScope(decision: AuthorizationDecision): readonly BoundaryId[] {
  if (!decision.allowed || decision.scope.length === 0) {
    throw new AuthorizationScopeError(decision.reason);
  }
  return decision.scope;
}
