export const IDENTITY_CONTRACT_VERSION = '1.0.0' as const;

export type ConversationType = 'channel' | 'dm';
export type ChannelBoundaryId = `ch:${string}:${string}`;
export type DmBoundaryId = `dm:${string}:${string}`;
export type BoundaryId = ChannelBoundaryId | DmBoundaryId;
export type ResourceId = BoundaryId;
export type ThreadId = `${BoundaryId}#${string}`;
export type MessageKey = `${string}/${string}/${string}`;
export type DeliveryKey = string;

/** Identity fields shared by normalized live events and archive-import records. */
export interface IdentityEvent {
  readonly contract_version: string;
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly conversation_type: ConversationType;
  readonly message_ts: string;
  readonly thread_ts: string | null;
  readonly sender_id: string;
}

export interface ResourceIdentity {
  readonly contract_version: typeof IDENTITY_CONTRACT_VERSION;
  readonly boundary_id: BoundaryId;
  readonly resource_id: ResourceId;
  readonly thread_id: ThreadId;
  readonly conversation_type: ConversationType;
}

interface MessageKeyInput {
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly message_ts: string;
}

interface DeliveryKeyInput {
  readonly event_id: string;
}

const WORKSPACE_ID = /^T[A-Z0-9]{8,}$/;
const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;
const DM_CONVERSATION_ID = /^D[A-Z0-9]{8,}$/;
const CONVERSATION_ID = /^[CDG][A-Z0-9]{8,}$/;
const USER_ID = /^[UW][A-Z0-9]{8,}$/;
const MESSAGE_TS = /^\d+\.\d+$/;
const DELIVERY_ID = /^\S+$/;

function invalid(field: string): never {
  throw new TypeError(`Invalid resource identity input: ${field}`);
}

function requireMatch(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(field);
  return value;
}

function requireContractVersion(value: unknown): void {
  if (value !== IDENTITY_CONTRACT_VERSION) invalid('contract_version');
}

function requireTimestamp(value: unknown, field: string): string {
  return requireMatch(value, MESSAGE_TS, field);
}

function boundaryFor(event: IdentityEvent): BoundaryId {
  const workspaceId = requireMatch(event.workspace_id, WORKSPACE_ID, 'workspace_id');
  requireMatch(event.sender_id, USER_ID, 'sender_id');

  if (event.conversation_type === 'channel') {
    const channelId = requireMatch(event.channel_id, CHANNEL_ID, 'channel_id');
    return `ch:${workspaceId}:${channelId}`;
  }

  if (event.conversation_type === 'dm') {
    requireMatch(event.channel_id, DM_CONVERSATION_ID, 'channel_id');
    const userId = requireMatch(event.sender_id, USER_ID, 'sender_id');
    return `dm:${workspaceId}:${userId}`;
  }

  return invalid('conversation_type');
}

/**
 * Resolve the stable Mastra resource and thread for a normalized Slack event.
 * Changing this mapping requires a persisted-data migration.
 */
export function resolveIdentity(event: IdentityEvent): ResourceIdentity {
  requireContractVersion(event.contract_version);
  const messageTs = requireTimestamp(event.message_ts, 'message_ts');
  const threadRootTs =
    event.thread_ts === null
      ? messageTs
      : requireTimestamp(event.thread_ts, 'thread_ts');
  const boundaryId = boundaryFor(event);

  return {
    contract_version: IDENTITY_CONTRACT_VERSION,
    boundary_id: boundaryId,
    resource_id: boundaryId,
    thread_id: `${boundaryId}#${threadRootTs}`,
    conversation_type: event.conversation_type,
  };
}

/** Validate and return a resolved boundary without permitting bare or cross-scope IDs. */
export function boundaryIdFor(identity: ResourceIdentity): BoundaryId {
  requireContractVersion(identity.contract_version);

  const expectedBoundaryPattern =
    identity.conversation_type === 'channel'
      ? /^ch:T[A-Z0-9]{8,}:[CG][A-Z0-9]{8,}$/
      : identity.conversation_type === 'dm'
        ? /^dm:T[A-Z0-9]{8,}:[UW][A-Z0-9]{8,}$/
        : invalid('conversation_type');

  requireMatch(identity.boundary_id, expectedBoundaryPattern, 'boundary_id');
  if (identity.resource_id !== identity.boundary_id) invalid('resource_id');

  const threadPrefix = `${identity.boundary_id}#`;
  if (!identity.thread_id.startsWith(threadPrefix)) invalid('thread_id');
  requireTimestamp(identity.thread_id.slice(threadPrefix.length), 'thread_id');

  return identity.boundary_id;
}

/** Content identity: stable across live delivery, retries, and archive import. */
export function messageKey(input: MessageKeyInput): MessageKey {
  const workspaceId = requireMatch(input.workspace_id, WORKSPACE_ID, 'workspace_id');
  const conversationId = requireMatch(input.channel_id, CONVERSATION_ID, 'channel_id');
  const messageTs = requireTimestamp(input.message_ts, 'message_ts');
  return `${workspaceId}/${conversationId}/${messageTs}`;
}

/** Delivery identity: the Slack envelope ID, kept separate from content identity. */
export function deliveryKey(input: DeliveryKeyInput): DeliveryKey {
  return requireMatch(input.event_id, DELIVERY_ID, 'event_id');
}
