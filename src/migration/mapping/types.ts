import type {
  ChannelBoundaryId,
  MessageKey,
  ThreadId,
} from '../../mastra/memory/resource-policy.js';

export const ARCHIVE_IMPORT_CONTRACT_VERSION = '1.0.0' as const;

export interface ArchiveImportContext {
  readonly contract_version: typeof ARCHIVE_IMPORT_CONTRACT_VERSION;
  readonly import_run_id: string;
  readonly source_snapshot_id: string;
  readonly workspace_id: string;
  readonly approved_channel_ids: readonly string[];
  readonly channel_aliases: Readonly<Record<string, string>>;
  readonly known_bot_sender_ids: readonly string[];
  readonly started_at: string;
}

export interface ArchiveSourceUser {
  readonly id: string;
  readonly name: string;
  readonly real_name: string | null;
  readonly display_name: string | null;
}

export interface ArchiveSourceMessage {
  readonly source_ref: string;
  readonly ts: string;
  readonly channel_id: string;
  readonly user_id: string | null;
  readonly user_name: string | null;
  readonly text: string;
  readonly thread_ts: string | null;
  readonly reply_count: number;
  readonly date: string;
  readonly is_thread_reply: number;
  readonly raw_json: string | null;
  readonly user: ArchiveSourceUser | null;
}

export type ImportDeliveryKey = `import:${string}:${MessageKey}`;

export interface NormalizedArchiveMessage {
  readonly contract_version: typeof ARCHIVE_IMPORT_CONTRACT_VERSION;
  readonly delivery_key: ImportDeliveryKey;
  readonly message_key: MessageKey;
  readonly boundary_id: ChannelBoundaryId;
  readonly thread_id: ThreadId;
  readonly conversation_type: 'channel';
  readonly sender_id: string;
  readonly sender_name: string;
  readonly sent_at: string;
  readonly message_ts: string;
  readonly text: string;
  readonly edited_at: string | null;
  readonly source: 'import';
}

export type ImportSkipReason =
  | 'unapproved_channel'
  | 'bot_message'
  | 'system_subtype'
  | 'empty_text'
  | 'file_only'
  | 'missing_sender'
  | 'duplicate_exact';

export type ImportFailureReason =
  | 'invalid_source_type'
  | 'malformed_raw_json'
  | 'invalid_timestamp'
  | 'invalid_thread_timestamp'
  | 'invalid_edit_timestamp'
  /** `resource-policy.ts` refused to build an identity for the row (F-06). */
  | 'invalid_identity'
  | 'duplicate_conflict'
  | 'writer_failed';

export type ImportWarning =
  | 'legacy_date_mismatch'
  | 'user_cache_miss_fallback';

export type ArchiveMessageMapResult =
  | {
      readonly outcome: 'write';
      readonly source_ref: string;
      readonly record: NormalizedArchiveMessage;
      readonly warnings: readonly ImportWarning[];
    }
  | {
      readonly outcome: 'skip';
      readonly source_ref: string;
      readonly reason: Exclude<ImportSkipReason, 'duplicate_exact'>;
    }
  | {
      readonly outcome: 'failure';
      readonly source_ref: string;
      readonly reason: Exclude<
        ImportFailureReason,
        'invalid_source_type' | 'duplicate_conflict' | 'writer_failed'
      >;
    };

export interface ArchiveMappingSkip {
  readonly source_ref: string;
  readonly reason: ImportSkipReason;
}

export interface ArchiveMappingFailure {
  readonly source_ref: string;
  readonly reason: ImportFailureReason;
}

export interface ArchiveMappingWarning {
  readonly source_ref: string;
  readonly reason: ImportWarning;
}

export interface ArchiveMessageMapping {
  readonly records: readonly NormalizedArchiveMessage[];
  readonly skipped: readonly ArchiveMappingSkip[];
  readonly failures: readonly ArchiveMappingFailure[];
  readonly warnings: readonly ArchiveMappingWarning[];
}
