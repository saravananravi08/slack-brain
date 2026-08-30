import type { MastraDBMessage } from '@mastra/core/agent';

import type {
  AuthorizationEvent,
  DenyReason,
  PolicySnapshot,
  ResourceIdentity,
} from '../../security/index.js';
import type { BoundaryId, MessageKey } from '../../mastra/memory/resource-policy.js';

export interface MutationDetail {
  readonly kind: 'edit' | 'delete';
  readonly target_ts: string;
  readonly edited_at: string;
  readonly new_text?: string;
}

export interface MutationEvent extends AuthorizationEvent {
  readonly contract_version: '1.0.0';
  readonly class: 'mutation';
  readonly message_ts: string;
  readonly mutation?: MutationDetail;
}

export interface OriginalMessageEvent extends AuthorizationEvent {
  readonly contract_version: '1.0.0';
  readonly message_ts: string;
}

export type MutationOutcome =
  | { readonly status: 'denied'; readonly reason: DenyReason }
  | { readonly status: 'updated' | 'deleted' | 'unchanged'; readonly message_key: MessageKey }
  | { readonly status: 'malformed' };

export type OriginalSuppressionOutcome =
  | { readonly status: 'denied'; readonly reason: DenyReason }
  | { readonly status: 'allowed'; readonly suppressed: boolean }
  | { readonly status: 'malformed' };

export interface DeleteResult {
  readonly deleted: number;
  readonly embeddings_deleted: number;
  readonly tombstoned: readonly MessageKey[];
  readonly missing: readonly MessageKey[];
}

export interface RetentionPolicy {
  readonly now: string;
  readonly approved_channel_ids: readonly string[];
  /** Removal time is required; absence cannot prove the 30-day deadline elapsed. */
  readonly channel_removed_at: Readonly<Record<string, string>>;
}

export interface RetentionResult extends DeleteResult {
  readonly examined: number;
}

export interface MutationStorage {
  editMessage(messageKey: MessageKey, newText: string, editedAt: string): Promise<'updated' | 'unchanged'>;
  deleteMessages(keys: readonly MessageKey[], deletedAt: string): Promise<DeleteResult>;
  isTombstoned(boundaryId: BoundaryId, messageKey: MessageKey): Promise<boolean>;
  listMessages(): Promise<readonly MastraDBMessage[]>;
}

export interface MutationHandlerOptions {
  readonly storage: MutationStorage;
  readonly policy: PolicySnapshot;
}

export interface HandleMutationInput {
  readonly event: MutationEvent;
  readonly identity: ResourceIdentity;
}

export interface CheckOriginalInput {
  readonly event: OriginalMessageEvent;
  readonly identity: ResourceIdentity;
}
