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
  /**
   * Recorded removal times. An absent entry no longer means "never purge":
   * the sweep starts the clock at `now` and reports the channel until the
   * caller persists the timestamp (design review F-07).
   */
  readonly channel_removed_at: Readonly<Record<string, string>>;
}

export interface RetentionResult extends DeleteResult {
  readonly examined: number;
  /**
   * De-approved channels still holding content with no recorded removal time.
   * Non-empty means D004's grace period has not started for them.
   */
  readonly unrecorded_channel_removals: readonly string[];
  /** Removal times the caller must persist so the grace period can elapse. */
  readonly channel_removal_starts: Readonly<Record<string, string>>;
  /** Partial deletions repaired before the sweep ran (design review F-02). */
  readonly reconciled: number;
}

export interface MutationStorage {
  editMessage(messageKey: MessageKey, newText: string, editedAt: string): Promise<'updated' | 'unchanged'>;
  deleteMessages(keys: readonly MessageKey[], deletedAt: string): Promise<DeleteResult>;
  isTombstoned(boundaryId: BoundaryId, messageKey: MessageKey): Promise<boolean>;
  listMessages(): Promise<readonly MastraDBMessage[]>;
  /**
   * Finish deletions and edits interrupted between their vector and row
   * writes. Idempotent; returns the number of repairs (design review F-02).
   */
  reconcileTombstones(): Promise<number>;
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
