import type { MastraDBMessage } from '@mastra/core/agent';

import type {
  AuthorizationEvent,
  DenyReason,
  PolicySnapshot,
  ResourceIdentity,
} from '../../security/index.js';
import type { BoundaryId, MessageKey } from '../../mastra/memory/resource-policy.js';

export interface FileRef {
  readonly file_id: string;
  readonly name: string;
  readonly mimetype: string;
  readonly size_bytes: number;
}

export interface LinkRef {
  readonly url: string;
  readonly domain: string;
}

export interface MutationDetail {
  readonly kind: 'edit' | 'delete';
  readonly target_ts: string;
  readonly edited_at: string;
  readonly new_text?: string;
  /** D018: omitted preserves stored metadata; present replaces it wholesale. */
  readonly new_files?: readonly FileRef[];
  /** D018: omitted preserves stored metadata; present replaces it wholesale. */
  readonly new_links?: readonly LinkRef[];
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

export interface DerivedInvalidation {
  readonly channelResource: BoundaryId;
  readonly messageKey: MessageKey;
  readonly reason: 'message_edited';
}

export interface DerivedInvalidationSink {
  emit(invalidations: readonly DerivedInvalidation[]): void;
}

export interface ChannelEnrollmentProbe {
  isEnrolled(workspaceId: string, channelId: string): Promise<boolean> | boolean;
  captureFloorTs(workspaceId: string, channelId: string): Promise<string | null> | string | null;
}

export type MutationOutcome =
  | { readonly status: 'denied'; readonly reason: DenyReason }
  | {
      readonly status:
        | 'updated'
        | 'deleted'
        | 'unchanged'
        | 'ignored'
        | 'edit_orphan_ignored';
      readonly message_key: MessageKey;
      /** Runtime channel results always populate this; optional for v1 caller compatibility. */
      readonly derivedInvalidation?: readonly DerivedInvalidation[];
    }
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

export interface EditMessageInput {
  readonly messageKey: MessageKey;
  readonly newText: string;
  readonly editedAt: string;
  readonly newFiles?: readonly FileRef[];
  readonly newLinks?: readonly LinkRef[];
}

export interface MutationStorage {
  editMessage(input: EditMessageInput): Promise<'updated' | 'unchanged' | 'edit_orphan_ignored'>;
  deleteMessages(keys: readonly MessageKey[], deletedAt: string): Promise<DeleteResult>;
  isTombstoned(boundaryId: BoundaryId, messageKey: MessageKey): Promise<boolean>;
  /** Stream one thread's messages at a time so retention never loads the corpus at once. */
  listMessageBatches(): AsyncIterable<readonly MastraDBMessage[]>;
  /**
   * Finish deletions and edits interrupted between their vector and row
   * writes. Idempotent; returns the number of repairs (design review F-02).
   */
  reconcileTombstones(): Promise<number>;
}

export interface MutationHandlerOptions {
  readonly storage: MutationStorage;
  readonly policy: PolicySnapshot;
  /** Fail-closed by default until T606 injects the T602 registry adapter. */
  readonly enrollment?: ChannelEnrollmentProbe;
  /** Synchronous, content-free P07 handoff; default is a P06 no-op. */
  readonly derivedInvalidationSink?: DerivedInvalidationSink;
}

export interface HandleMutationInput {
  readonly event: MutationEvent;
  readonly identity: ResourceIdentity;
}

export interface CheckOriginalInput {
  readonly event: OriginalMessageEvent;
  readonly identity: ResourceIdentity;
}
