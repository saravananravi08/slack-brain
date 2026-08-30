# Contract — archive import

- **Contract version:** 1.0.0
- **Owner:** T301 (frozen); consumers T302, T303, T304, T305, T306, T307
- **Status:** Immutable for PG-03B implementation; measured inventory is pending B-03
- **Conforms to:** [`identity.md`](./identity.md), [`storage.md`](./storage.md), [`slack-event.md`](./slack-event.md) §3, [`retrieval.md`](./retrieval.md) §3
- **Implements:** D001, D003, D004, D005, D009; FR-MEM-005–007

This contract converts the legacy SQLite archive into imported `StoredMessage` records without exposing Slack content in Git or reports. Shape or semantic changes require coordinator approval and a contract-version bump. Filling the B-03 inventory table is data completion, not permission to change these rules.

## 1. Scope and source safety

Import only rows whose `channel_id` is in the explicit D001 allowlist supplied to the run. No default channel, workspace, bot ID, or date floor exists. The accepted D003 default is the full archive for approved channels.

The source database:

1. is opened in SQLite read-only/immutable mode;
2. is backed up before any sample or full import;
3. is never migrated, vacuumed, checkpointed, or opened by legacy `getDb()`;
4. remains available through the rollback window; and
5. is never copied into Git, tests, traces, or application logs.

T302 owns source reads, T303 owns pure mapping, T304 owns writes, and T305 owns orchestration/report assembly. Migration code must not import an agent or generation provider. Embedding calls are permitted; generation calls are not.

`messages_fts`, `documents`, `documents_fts`, `metadata`, and `proactive_log` are out of scope. File-only/document rows are excluded from migration MVP.

## 2. Run input

```ts
interface ArchiveImportContext {
  contract_version: '1.0.0';
  import_run_id: string;                // unique for one attempt; contains no slash
  source_snapshot_id: string;           // operator label or digest; no path
  workspace_id: string;                 // required; source rows do not contain it
  approved_channel_ids: readonly string[]; // non-empty D001 allowlist
  channel_aliases: Readonly<Record<string, string>>; // safe report labels
  known_bot_sender_ids: readonly string[];
  started_at: string;                   // RFC 3339 UTC, fixed for the run
}
```

Reject the run before reading rows when the context is malformed, the allowlist is empty, an approved channel lacks a unique alias, or the source is not demonstrably read-only. Real IDs and source paths stay in operator configuration, never fixtures or committed reports.

## 3. Legacy source schema

The authoritative legacy schema is the `messages` and `users` DDL in `db.ts`:

```ts
interface ArchiveSourceUser {
  id: string;
  name: string;
  real_name: string | null;
  display_name: string | null;
}

interface ArchiveSourceMessage {
  source_ref: string;              // opaque, content-free row reference
  ts: string;
  channel_id: string;
  user_id: string | null;
  user_name: string | null;
  text: string;
  thread_ts: string | null;
  reply_count: number;
  date: string;                    // legacy derived date; never authoritative
  is_thread_reply: number;
  raw_json: string | null;
  user: ArchiveSourceUser | null;  // LEFT JOIN users ON users.id = messages.user_id
}

type ArchiveSourceResult =
  | { ok: true; value: ArchiveSourceMessage }
  | { ok: false; source_ref: string; reason: 'invalid_source_type' };
```

SQLite is dynamically typed. T302 validates every selected value before returning `ok: true`; malformed values become content-free failures. It streams in stable `(ts, channel_id)` pages and does not load the archive into memory.

`raw_json` is optional evidence only. The legacy `upsertMessage()` did not write it, so mapping must work when it is null and must never assume it is complete.

## 4. Normalized and writer schemas

```ts
type ImportDeliveryKey = `import:${string}:${MessageKey}`;

interface NormalizedArchiveMessage {
  contract_version: '1.0.0';
  delivery_key: ImportDeliveryKey;
  message_key: MessageKey;
  boundary_id: BoundaryId;
  thread_id: ThreadId;
  conversation_type: 'channel';
  sender_id: string;
  sender_name: string;
  sent_at: string;                 // RFC 3339 UTC
  message_ts: string;              // verbatim source ts
  text: string;
  edited_at: string | null;
  source: 'import';
}

interface ArchiveWriterRecord {
  delivery_key: ImportDeliveryKey;
  message: StoredMessage;          // storage.md §1
}
```

T304 creates `StoredMessage` by copying the normalized fields and setting `ingested_at = context.started_at`. Import is channel-only: any `dm:` boundary or `conversation_type: 'dm'` is rejected.

## 5. Deterministic mapping

For source row `r` and context `c`:

```text
message_key = <workspace_id>/<channel_id>/<ts>
boundary_id = ch:<workspace_id>:<channel_id>
root_ts     = (thread_ts is null or thread_ts == ts) ? ts : thread_ts
thread_id   = <boundary_id>#<root_ts>
delivery_key = import:<import_run_id>:<message_key>
```

Rules:

1. IDs use verbatim Slack timestamp strings. Never parse timestamps as `number`/float.
2. A timestamp is `^[0-9]{10}\.[0-9]{1,6}$`. Convert to UTC with integer seconds plus the fractional digits; emit millisecond RFC 3339 for `sent_at`. Fractional precision discarded from `sent_at` remains preserved in `message_ts` and `message_key`.
3. Numeric ordering compares integer seconds, then the fraction right-padded to six digits, then the verbatim timestamp as a tie-breaker. Thus `.0002` and `.000200` remain distinct identities even though they denote the same instant.
4. `date` is checked against the UTC date derived from `ts`. A mismatch emits `legacy_date_mismatch` but does not alter or reject the message. No IST conversion is performed.
5. A self-referential `thread_ts` normalizes as a root. `is_thread_reply` and `reply_count` are audit hints, never identity inputs.
6. Sender name precedence is `user.display_name`, `user.real_name`, `user.name`, then row `user_name`, taking the first trimmed non-empty value. A non-empty `user_id` and sender name are both required for D009 citations. A missing joined user may therefore use the archived row-name fallback and emits `user_cache_miss_fallback`.
7. Valid `raw_json.edited.ts` maps to `edited_at`; `text` is already the current snapshot text. Only current text is embedded. No pre-edit text is retained.
8. Mapping is pure: no storage, clock, Slack API, model, or embedding call.

## 6. Eligibility and exclusions

Classification order is fixed; first outcome wins:

1. Channel absent from `approved_channel_ids` → skip `unapproved_channel`.
2. `raw_json` is non-null but invalid JSON → fail `malformed_raw_json`.
3. Bot/app indicators in `raw_json`, or `user_id` in `known_bot_sender_ids` → skip `bot_message`.
4. Slack system subtype, including join/leave or deleted placeholders → skip `system_subtype`.
5. Empty/whitespace text → skip `empty_text` (`file_only` when source metadata proves files exist).
6. Missing human `user_id` or resolvable sender name → skip `missing_sender`.
7. Invalid `ts`, `thread_ts`, or edit timestamp → fail the corresponding timestamp reason.
8. Otherwise normalize and write.

Stable reason sets:

```ts
type ImportSkipReason =
  | 'unapproved_channel' | 'bot_message' | 'system_subtype'
  | 'empty_text' | 'file_only' | 'missing_sender' | 'duplicate_exact';

type ImportFailureReason =
  | 'invalid_source_type' | 'malformed_raw_json'
  | 'invalid_timestamp' | 'invalid_thread_timestamp' | 'invalid_edit_timestamp'
  | 'duplicate_conflict' | 'writer_failed';

type ImportWarning = 'legacy_date_mismatch' | 'user_cache_miss_fallback';
```

Application logs contain reason codes and counts only. They never contain source text, `raw_json`, sender names, source paths, or real Slack IDs.

## 7. Content and delivery idempotency

Two identities are mandatory and have different jobs:

- **Content identity:** `message_key`, exactly as defined by `slack-event.md` §3. Live and imported copies converge through `upsertMessage`.
- **Delivery identity:** `delivery_key = import:<import_run_id>:<message_key>`. A repeated page/batch in one run is processed once. A new run gets a new delivery identity and reaches the writer again, where content idempotency returns `unchanged`.

Deduplication groups normalized candidates by `message_key` before writes:

1. One canonical payload → write once.
2. Repeated identical canonical payload in one run → write once; each extra row is `duplicate_exact`.
3. Same key with different normalized payloads → write none for that key; every conflicting row is `duplicate_conflict`. Never choose first/last silently.
4. Rerunning an unchanged archive → all eligible records resolve to `unchanged`; message and embedding counts do not grow.
5. A changed source snapshot with the same key → `updated`; replace text and embedding atomically per D005.
6. A destination tombstone suppresses an imported late copy. Import never removes a tombstone.

Canonical payload equality covers every normalized field except `delivery_key`. Ordering, batch size, retry count, and `source_ref` cannot change the result.

## 8. D005 edit/delete behavior and retention

An imported edited row keeps its original `message_key`, sender, channel, thread, and `sent_at`; it carries `edited_at`, writes current text, and replaces any stale embedding atomically.

The legacy snapshot does not reliably record deletions. Absence of a source row is **not** evidence of deletion and must never trigger destination removal. Explicit deletion/system placeholders are excluded. Existing destination tombstones win over import retries. This preserves D005's hard-delete behavior without fabricating deletion history; the accepted offline historical-deletion gap remains.

Imported approved-channel messages use D004 class `channel_message`: indefinite while approved, then purge message and embedding together within 30 days through `deleteMessages`.

## 9. Inventory TBD under B-03

**B-03 is the only unresolved T301 operational item.** No source database is available in the task worktree. Values below must be measured with aggregate-only queries once the operator supplies the backed-up read-only source path and approved-channel selection. Do not substitute fixture values or inspect message bodies.

| Approved channel alias | `MIN(ts)` | `MAX(ts)` | Source message count | Logical thread count |
|---|---:|---:|---:|---:|
| TBD under B-03 | TBD | TBD | TBD | TBD |

`logical thread count` means distinct `COALESCE(NULLIF(thread_ts, ts), ts)` among rows in that approved channel. Record malformed timestamp counts separately. Compare these values with the authoritative baseline before sample import; any material mismatch blocks the import. Real channel IDs and the source path are not written here.

Filling this table requires coordinator approval because this directory is frozen. It does not change contract version unless mapping or semantics also change.

## 10. Audit report contract

Reports are JSON held outside Git with operator-restricted access. Standard logs receive aggregate counts only.

```ts
interface ArchiveImportReport {
  contract_version: '1.0.0';
  report_version: 1;
  import_run_id: string;
  source_snapshot_id: string;
  started_at: string;
  completed_at: string;
  status: 'succeeded' | 'partial' | 'failed';
  inventory: readonly {
    channel_alias: string;
    channel_ref: string;            // "sha256:" + SHA-256(workspace/channel)
    min_message_ts: string | null;
    max_message_ts: string | null;
    source_message_count: number;
    logical_thread_count: number;
    malformed_timestamp_count: number;
  }[];
  counts: {
    source_rows_seen: number;
    normalized_records: number;
    skipped_by_reason: Partial<Record<ImportSkipReason, number>>;
    failed_by_reason: Partial<Record<ImportFailureReason, number>>;
    warnings_by_reason: Partial<Record<ImportWarning, number>>;
    writer: { inserted: number; updated: number; unchanged: number; failed: number };
    embeddings: { written: number; unchanged: number; failed: number };
  };
  failures: readonly {
    record_ref: string;             // "sha256:" + SHA-256(message_key/source_ref)
    stage: 'read' | 'map' | 'deduplicate' | 'write';
    reason: ImportFailureReason;
    retryable: boolean;
  }[];
  reconciliation: {
    source_rows_balanced: boolean;
    normalized_rows_balanced: boolean;
    destination_count_before: number;
    destination_count_after: number;
  };
}
```

Required equations:

```text
source_rows_seen
  = normalized_records
  + sum(skipped_by_reason)
  + sum(failed_by_reason excluding writer_failed)

normalized_records
  = writer.inserted + writer.updated + writer.unchanged + writer.failed

writer.failed = failed_by_reason.writer_failed

destination_count_after - destination_count_before = writer.inserted
```

`embeddings.written` covers successful inserts/updates only. Message and embedding writes are atomic; an embedding failure is a `writer_failed`, not partial success. `status = succeeded` only when both reconciliation booleans are true and all failure counts are zero. A bounded sample may be `partial` for review; full import cannot be approved with unexplained differences.

Failure entries and app logs must not include `text`, `raw_json`, sender ID/name, channel/workspace ID, source path, prompt, embedding, or trace content. Reports use aliases and SHA-256 references; fixtures use synthetic IDs only.

## 11. Fixtures

- [`../../../tests/fixtures/migration/source-records.v1.json`](../../../tests/fixtures/migration/source-records.v1.json) — exact legacy source shape and synthetic roots, replies, edits, bots, missing users, timestamp precision, and duplicate inputs.
- [`../../../tests/fixtures/migration/normalized-records.v1.json`](../../../tests/fixtures/migration/normalized-records.v1.json) — expected normalized/write or skip/failure outcome for each edge case.
- [`../../../tests/fixtures/migration/audit-reports.v1.json`](../../../tests/fixtures/migration/audit-reports.v1.json) — first-run and rerun reconciliation vectors.
