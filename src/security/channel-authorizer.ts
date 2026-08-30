/**
 * Adapter from the Slack channel surface to the guard.
 *
 * T104 declared `ChannelAuthorizer` as a required injected port with no
 * default — a missing authorizer is a construction error rather than an open
 * door. This module supplies that port without importing anything from
 * `src/mastra/channels`: the shape is declared structurally here and pinned
 * against T104's published type by test, so the security module keeps a
 * dependency-free import graph in both directions.
 *
 * Two lookups are needed that the guard itself must not perform, because
 * `authorize` is pure: resolving the sender's workspace attributes, and
 * resolving the event's resource identity (identity.md §5, owned by T202).
 * Both are injected, and **both fail closed** — a lookup that errors, times
 * out, or returns nothing denies. D006 and T502 require exactly this: no path
 * grants access on a failed identity lookup.
 */

import { AUTHORIZATION_CONTRACT_VERSION, authorize } from './authorize.js';
import { denyLogFields } from './deny.js';
import type {
  AuthorizationEvent,
  ConversationType,
  DenyReason,
  PolicySnapshot,
  ResourceIdentity,
  SenderType,
} from './types.js';

/** The fields of T104's `ChannelRequest` this adapter reads. */
export interface ChannelAuthorizationInput {
  /** Slack team ID. Absent means the workspace cannot be verified. */
  readonly workspaceId: string | undefined;
  readonly channelId: string;
  readonly senderId: string;
  readonly isDirectMessage: boolean;
}

/** Deny reasons T104's channel layer can act on. */
export type ChannelDenyReason = Exclude<DenyReason, 'dm_shared_knowledge_disabled'>;

export interface ChannelAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: ChannelDenyReason | null;
}

/** Workspace attributes of the sender, resolved outside the pure guard. */
export interface SenderAttributes {
  readonly senderType: SenderType;
  readonly isExternal: boolean;
  readonly isGuest: boolean;
  readonly isDeactivated: boolean;
}

/**
 * Resolves sender attributes. Returning `null`, rejecting, or throwing all
 * deny — there is no "unknown, therefore fine" answer.
 */
export type SenderResolver = (input: {
  readonly workspaceId: string;
  readonly senderId: string;
}) => Promise<SenderAttributes | null> | SenderAttributes | null;

/**
 * Resolves the resource identity for an event (T202's `resolveIdentity`).
 * Throws on malformed input, per identity.md §5 — a guessed identity writes
 * data into the wrong boundary, which is worse than a failed request.
 */
export type IdentityResolver = (event: AuthorizationEvent) => ResourceIdentity;

/** Never receives message text or a display name (INV-12, FR-PRV-008). */
export interface SecurityLogger {
  info(message: string, fields?: Record<string, unknown>): void;
}

export interface ChannelAuthorizerOptions {
  /** Passed in, never read from ambient globals (D001, authorization.md §2). */
  readonly policy: PolicySnapshot;
  readonly resolveIdentity: IdentityResolver;
  readonly resolveSender: SenderResolver;
  readonly logger?: SecurityLogger;
}

function denied(reason: ChannelDenyReason): ChannelAuthorizationDecision {
  return Object.freeze({ allowed: false, reason });
}

const ALLOWED: ChannelAuthorizationDecision = Object.freeze({ allowed: true, reason: null });

/**
 * `dm_shared_knowledge_disabled` cannot arise at the `accept_event` gate — it
 * is a retrieval-scope reason. If one ever reaches here the mapping is a
 * programming error, and the safe outcome is a silent denial rather than a
 * reply that implies the request was understood.
 */
function toChannelReason(reason: DenyReason): ChannelDenyReason {
  return reason === 'dm_shared_knowledge_disabled' ? 'malformed_request' : reason;
}

/**
 * Build the `accept_event` authorizer for the Slack channel surface.
 *
 * Order is fixed and every step fails closed:
 *  1. No verifiable workspace ID → `malformed_request`.
 *  2. Sender attributes cannot be resolved → `identity_unresolved`.
 *  3. Identity cannot be resolved → `identity_unresolved`.
 *  4. The pure guard decides.
 */
export function createChannelAuthorizer(
  options: ChannelAuthorizerOptions,
): (request: ChannelAuthorizationInput) => Promise<ChannelAuthorizationDecision> {
  const { policy, resolveIdentity, resolveSender, logger } = options;

  return async (request) => {
    const decision = await decide(request);
    if (!decision.allowed && decision.reason !== null && logger !== undefined) {
      // Reason code and gate only — no channel, user, workspace, or text.
      logger.info('security.authorize.denied', {
        class: 'unauthorized',
        gate: 'accept_event',
        reason: decision.reason,
      });
    }
    return decision;
  };

  async function decide(
    request: ChannelAuthorizationInput,
  ): Promise<ChannelAuthorizationDecision> {
    const workspaceId = request.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
      // Without a team ID the workspace gate cannot be evaluated, and D001
      // does not permit assuming the approved one.
      return denied('malformed_request');
    }

    let attributes: SenderAttributes | null;
    try {
      attributes = await resolveSender({ workspaceId, senderId: request.senderId });
    } catch {
      return denied('identity_unresolved');
    }
    if (attributes === null || attributes === undefined) return denied('identity_unresolved');

    const conversationType: ConversationType = request.isDirectMessage ? 'dm' : 'channel';
    const event: AuthorizationEvent = {
      workspace_id: workspaceId,
      channel_id: request.channelId,
      conversation_type: conversationType,
      sender_id: request.senderId,
      sender_type: attributes.senderType,
      sender_is_external: attributes.isExternal,
      sender_is_guest: attributes.isGuest,
      sender_is_deactivated: attributes.isDeactivated,
    };

    let identity: ResourceIdentity;
    try {
      identity = resolveIdentity(event);
    } catch {
      return denied('identity_unresolved');
    }

    const result = authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'accept_event',
      event,
      identity,
      policy,
    });

    if (result.allowed) return ALLOWED;
    // `reason` is non-null on every denial; the fallback keeps the mapping
    // total without inventing an allow.
    const fields = denyLogFields(result);
    return denied(toChannelReason(fields?.reason ?? 'malformed_request'));
  }
}
