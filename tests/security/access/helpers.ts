/**
 * Synthetic builders for the authorization suite.
 *
 * Every identifier is invented and comes from
 * docs/architecture/contracts/fixtures/manifest.json. No real workspace,
 * channel, user, or message content appears here (FR-PRV-007, D001), and no
 * test in this directory performs I/O beyond reading the frozen contract
 * fixtures.
 */

import type {
  AuthorizationEvent,
  AuthorizationRequest,
  BoundaryId,
  Gate,
  PolicySnapshot,
  ResourceIdentity,
} from '../../../src/security/types.js';

export const SYNTHETIC = {
  workspaceApproved: 'T0SYNTH01',
  workspaceOther: 'T0SYNTH99',
  channelApproved: 'C0APPROVED1',
  channelApprovedSecond: 'C0APPROVED2',
  channelUnapproved: 'C0UNAPPROV9',
  dmConversation: 'D0DMCONV01',
  userMember: 'U0MEMBER01',
  userMemberSecond: 'U0MEMBER02',
  userGuest: 'U0GUEST001',
  userExternal: 'U0EXTERN01',
  userDeactivated: 'U0DEACTIV1',
  bot: 'B0GISTBOT1',
} as const;

export const CONTRACT_VERSION = '1.0.0';

export function makePolicy(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    approved_workspace_id: SYNTHETIC.workspaceApproved,
    approved_channel_ids: [SYNTHETIC.channelApproved, SYNTHETIC.channelApprovedSecond],
    user_allowlist: [],
    dm_shared_knowledge: false,
    ...overrides,
  };
}

export function makeChannelEvent(
  overrides: Partial<AuthorizationEvent> = {},
): AuthorizationEvent {
  return {
    workspace_id: SYNTHETIC.workspaceApproved,
    channel_id: SYNTHETIC.channelApproved,
    conversation_type: 'channel',
    sender_id: SYNTHETIC.userMember,
    sender_type: 'human',
    sender_is_external: false,
    sender_is_guest: false,
    sender_is_deactivated: false,
    ...overrides,
  };
}

export function makeDirectMessageEvent(
  overrides: Partial<AuthorizationEvent> = {},
): AuthorizationEvent {
  return makeChannelEvent({
    channel_id: SYNTHETIC.dmConversation,
    conversation_type: 'dm',
    ...overrides,
  });
}

/**
 * Test-only projection of an event into the identity shape of identity.md §2.
 *
 * Runtime construction of a `BoundaryId` belongs to T202's `resource-policy.ts`
 * and never to `src/security` (identity.md §4). Here the boundary is written
 * out as literal test data — the guard's job is to check that the identity it
 * was handed agrees with the event, and these builders are what hand it one.
 */
export function makeIdentity(
  event: AuthorizationEvent,
  overrides: Partial<ResourceIdentity> = {},
): ResourceIdentity {
  const boundary: BoundaryId =
    event.conversation_type === 'channel'
      ? `ch:${event.workspace_id}:${event.channel_id}`
      : `dm:${event.workspace_id}:${event.sender_id}`;

  return {
    contract_version: CONTRACT_VERSION,
    boundary_id: boundary,
    resource_id: boundary,
    thread_id: `${boundary}#1735689650.000100`,
    conversation_type: event.conversation_type,
    ...overrides,
  };
}

export function makeRequest(
  gate: Gate,
  parts: {
    event?: AuthorizationEvent;
    identity?: ResourceIdentity;
    policy?: PolicySnapshot;
    contractVersion?: string;
  } = {},
): AuthorizationRequest {
  const event = parts.event ?? makeChannelEvent();
  return {
    contract_version: parts.contractVersion ?? CONTRACT_VERSION,
    gate,
    event,
    identity: parts.identity ?? makeIdentity(event),
    policy: parts.policy ?? makePolicy(),
  };
}

/** Channel boundary literal, for asserting on expected scopes. */
export function channelBoundary(workspaceId: string, channelId: string): BoundaryId {
  return `ch:${workspaceId}:${channelId}`;
}

/** DM boundary literal, keyed on the human user (identity.md §2 rule 2). */
export function directMessageBoundary(workspaceId: string, userId: string): BoundaryId {
  return `dm:${workspaceId}:${userId}`;
}

export const ALL_GATES: readonly Gate[] = ['accept_event', 'write_memory', 'read_memory'];
