# Contract — edit replacement and accepted delete-ignore

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen); consumers T605, T606
- **Implements:** D015 (overrides D005 for `ch:` boundaries in P06/P07)
- **Satisfies:** CM-FR-015, CM-FR-016, CM-FR-017, CM-FR-018, CM-FR-019, CM-FR-026 (handoff)
- **Enforces:** CM-INV-07, CM-INV-10

## 1. Scope of the override

D015 changes delete handling **only** for channel (`ch:`) boundaries in P06/P07. Unchanged: DM mutation handling, archive import, the v1 `deleteMessages` primitive (`storage.md` §3), D004 retention classes and sweeps, and operator purge. Gist still has a working delete path; it is simply not driven by Slack `message_deleted` events in these phases.

## 2. Mutation events

```ts
type ChannelMutationKind = 'edit' | 'delete';

interface ChannelMutation {
  contract_version: string;
  kind: ChannelMutationKind;

  workspace_id: string;
  channel_id: string;
  target_ts: string;            // message_ts of the ORIGINAL message — identity, verbatim
  event_id: string;             // envelope ID, for delivery dedup

  edited_at: string;            // RFC 3339 UTC
  new_text?: string;            // present iff kind === 'edit'
  new_files?: readonly FileRef[];
  new_links?: readonly LinkRef[];
}
```

The mutation's own event `ts` is **not** identity. Identity is `messageKey(workspace_id, channel_id, target_ts)` — the original message's key (CM-FR-015). Slack's `message_changed` envelope carries its own timestamp, and keying on it creates a second record per edit, which reads downstream as the same person saying two things.

Authorization ordering is unchanged from v1 (`authorization.md` §6): enrollment and authorization are evaluated **before** any storage lookup, so a mutation for a channel Gist is not enrolled in cannot be used to probe what Gist has stored. Under this set the enrollment check (`enrollment.md` §2) is the channel gate.

## 3. Edit semantics

```ts
function applyEdit(m: ChannelMutation): 'updated' | 'inserted' | 'unchanged' | 'ignored';
```

| Case | Result | Rule |
|---|---|---|
| Target stored, `edited_at` newer than stored | `updated` | Replace text/files/links, set `edited_at`, re-embed (§3.2) |
| Target stored, `edited_at` equal or older | `unchanged` | Apply-if-newer (§3.3) — replay and reordering are both no-ops |
| Target not stored, `target_ts` at or after the capture floor | `inserted` | §3.4 |
| Target not stored, `target_ts` before the capture floor | `ignored` | No backfill (CM-FR-006) |
| Channel not enrolled | `ignored` | Denied before lookup (§2) |
| Duplicate envelope `event_id` | `unchanged` | CM-INV-05 |

Every row is **success**. A mutation for a message Gist never stored is not an error — it may legitimately predate enrollment.

### 3.1 Preserved fields (CM-FR-016)

An edit replaces `text`, `files`, `links`, and sets `edited_at`. It **must not** change:

`message_key` · `boundary_id` · `thread_id` · `thread_root_ts` · `is_thread_reply` · `sender` (all of it, including `sender_class` and `sender_display_name`) · `sent_at` · `message_ts` · `capture_source` · `enrollment_epoch`.

Slack's `message_changed` payload re-states the message and its `ts`; treating that payload as a fresh capture rewrites the sender and the sent time from the edit event, which is how an edited message drifts to the wrong author or the wrong place in the timeline.

### 3.2 Embedding replacement (CM-FR-017)

The stale embedding must not survive the update. Replacement is atomic with the text update in the same sense as v1 `storage.md` §3: an embedding that no longer matches its record is recallable content that was retracted.

If re-embedding fails, the record's text **is still updated** and the embedding is marked stale and queued for retry — never left silently matching pre-edit text. Capture and correctness of the exact record do not depend on model availability (CM-NFR-002); what must not happen is a vector that still answers to the old wording while the record shows the new one.

### 3.3 Idempotency and ordering (CM-FR-018)

```ts
apply-if-newer:  stored.edited_at === null || m.edited_at > stored.edited_at
```

Replaying an edit is `unchanged`. Two edits delivered out of order converge on the newer one, and the older one does not overwrite it on redelivery. Comparison is on RFC 3339 `edited_at`; when two edits carry the same `edited_at`, the stored record wins (`unchanged`) — a tie means the same edit.

### 3.4 Edit for an unstored target

When the target is unknown but at or after the capture floor, the edit **inserts** a record built from the mutation payload, with `edited_at` set and `capture_source: 'live_event'`.

The alternative — no-op — loses the message entirely when Slack delivers the edit but not the original (reconnect gaps, CM-FR-014). Inserting is safe because apply-if-newer prevents a late-arriving original from regressing the text: an original delivery is an upsert of the same `message_key`, and `unchanged`/`updated` resolution keeps the newest edit.

### 3.5 Derived context (CM-FR-026, handoff to P07)

An edit marks the channel's rolling summary and any observation referencing the edited message **stale**:

```ts
interface DerivedInvalidation {
  boundary_id: BoundaryId;
  message_key: MessageKey;
  invalidated_at: string;
  targets: readonly ('summary' | 'observations')[];
}
```

P06 must **emit** this signal; regeneration is P07's (T702/T705). This is the integration rule that keeps CM-FR-026 from falling between phases: without an emitted marker, P07 has no way to know which derived text quotes retracted wording.

## 4. Delete-ignore (CM-FR-019, D015)

```ts
function applyDelete(m: ChannelMutation): 'ignored';
```

`message_deleted` in an enrolled channel is **accepted and ignored**. Exactly one return value, on purpose.

| Concern | Behavior |
|---|---|
| Stored record | Unchanged |
| Embedding | Unchanged — still matches, still recallable |
| Rolling summary, observations | Unchanged |
| Tombstone | **Not written** (see below) |
| Result | Success; counted as `mutation_ignored{kind="delete"}`, no message text |
| `deleteMessages` calls | **Zero** |

**No tombstone.** V1 wrote a content-free tombstone so a late redelivery of a hard-deleted message was not re-ingested (`storage.md` §3). Under delete-ignore nothing is deleted, so there is nothing to suppress — and a tombstone would actively cause harm by suppressing legitimate redelivery of a message Gist still holds. This is the one place where copying the v1 delete path would be wrong in a way that looks correct.

### 4.1 Accepted risk — stated, not implied

> Content a user deleted in Slack **remains stored in Gist and remains recallable**, including in semantic search results, summaries, and observations. A user who retracts a message cannot assume Gist has forgotten it.

This is an explicit, temporary product decision for P06/P07 (PRD §9, D015), accepted by the product owner on 2026-08-31 — not an implementation omission, not a defect to be quietly "fixed" in a downstream task.

Reversing it requires a **new approved decision** plus regression across every derived surface: message records, embeddings, rolling summaries, observations, and backups. It is not a one-line handler change, which is precisely why it is written down here.

Mitigations that remain available today: operator purge through the v1 `deleteMessages` primitive, and D004 retention sweeps. `mutations.test.ts` asserts the risk case directly — delete leaves state byte-identical and calls no delete primitive — so the accepted behavior is pinned by test rather than left to memory.
