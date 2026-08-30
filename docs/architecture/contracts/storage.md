# Contract — storage, retention, and the delete primitive

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers T103, T201, T304, T403, T404
- **Enforces:** INV-9, INV-10, INV-4
- **Implements:** D004 (retention), D005 (mutations), D008 (embedding dimension), D010 (residency)

## 1. Stored message record

```ts
interface StoredMessage {
  contract_version: string;

  message_key: MessageKey;      // workspace_id/channel_id/message_ts — primary key (INV-10)
  boundary_id: BoundaryId;
  thread_id: ThreadId;
  conversation_type: 'channel' | 'dm';

  sender_id: string;
  sender_name: string;          // display name resolved at write time
  sent_at: string;              // RFC 3339 UTC
  message_ts: string;           // verbatim Slack ts

  text: string;
  edited_at: string | null;
  source: 'live' | 'import';
  ingested_at: string;
}
```

- **`sender_name` is resolved and stored at write time**, not looked up at read time. D009 requires attribution on every historical claim; a read-time lookup fails for deactivated or renamed users and would make old messages progressively uncitable. Storing it also removes a Slack API call from the retrieval path.
- **`source`** distinguishes live from imported records for reconciliation (T307) without affecting identity — the same message from either path has the same `message_key` and converges (INV-10, AC-14).
- `text` is never written to application logs (INV-12).

## 2. Embedding record

```ts
interface StoredEmbedding {
  message_key: MessageKey;      // FK to StoredMessage, 1:1
  boundary_id: BoundaryId;      // denormalized — see below
  vector: number[];             // length exactly 1536
  model: string;                // e.g. "openai/text-embedding-3-small"
  embedded_at: string;
}
```

- **Dimension is exactly 1536** (D008). Stated here so a mismatch fails at startup rather than at first query. Changing it requires re-embedding the entire corpus and is locked before T307.
- **`model` is stored per row.** A future model change must be detectable per record; a corpus silently mixing two embedding models retrieves incoherently and is very hard to diagnose after the fact.
- **`boundary_id` is denormalized onto the embedding.** Vector search must be able to filter by boundary **inside** the query rather than by post-filtering results. Post-filtering means the vector store has already scored across boundaries, and a scope bug then leaks content that a `LIMIT` happened to include. This is the storage-level expression of INV-5.

## 3. Delete primitive (INV-9)

```ts
function deleteMessages(keys: readonly MessageKey[]): DeleteResult;

interface DeleteResult {
  deleted: number;
  embeddings_deleted: number;
  tombstoned: readonly MessageKey[];
  missing: readonly MessageKey[];   // not an error
}
```

**One primitive, used by both D005 deletion and D004 retention.** A retention purge cannot leave rows that a user deletion would have removed, and vice versa.

Guarantees:

1. Message and embedding are removed **together**. A partial delete is a failure, not a partial success — an embedding that outlives its message is recallable content that no longer exists.
2. A content-free tombstone (`message_key` + deletion timestamp) remains, so late redelivery of the original is suppressed. Tombstones hold no text.
3. Idempotent. Deleting an absent key is success with `missing` populated.
4. **If the pinned Mastra storage/vector API exposes no supported delete for vector rows, T404 must stop and record a blocker** (D004, and T404's own step 5). Do not ship orphaned embeddings and do not improvise a raw-SQL deletion against Mastra-managed tables.

## 4. Retention classes (D004)

| Class | Applies to | Retention |
|---|---|---|
| `channel_message` | `ch:` boundary records + embeddings | Indefinite while channel is approved; purge within 30 days of removal from the allowlist |
| `dm_message` | `dm:` boundary records + embeddings | 90 days rolling |
| `trace` | Mastra traces | 30 days, operator-restricted |
| `app_log` | Application logs | 14 days, no bodies or tokens |
| `backup` | Storage backups | 35 days rotating |

The sweep resolves records to a class by `boundary_id` prefix and executes through `deleteMessages`. Restoring a backup older than a purge reintroduces purged records and requires re-running the sweep — T504 documents this.

## 5. Idempotent write

```ts
function upsertMessage(m: StoredMessage): 'inserted' | 'updated' | 'unchanged';
```

Keyed on `message_key`. Re-running the archive importer must not change counts (FR-MEM-007, AC-14). A live message arriving after its imported twin resolves to `unchanged` or `updated`, never a second row.

**Writing a `dm:` record into a `ch:` boundary must be rejected at this layer** (INV-4), not only at authorization. Defense in depth: the storage layer is the last place the invariant can be enforced, and it is the one place every write path passes through.

## 6. Topology and residency (D010)

- Store: file-backed libSQL, database file **outside** the repository, never committed (FR-PRV-007).
- Vector store: libSQL vector store, dimension 1536.
- Multi-instance deployment substitutes a managed database with restricted network access; it must not be publicly reachable (NFR-SEC-002).
- Traces carry message content and are residency-relevant: operator-restricted access (FR-PRV-009), 30-day retention, correlated to Slack events by run ID without logging bodies (NFR-OBS-003).

## 7. Fixtures

[`fixtures/storage.v1.json`](./fixtures/storage.v1.json) — a valid channel record and DM record, an upsert-convergence pair (live + import of one message), a delete case showing message and embedding removed together with a tombstone left behind, and the rejected cross-boundary write.
