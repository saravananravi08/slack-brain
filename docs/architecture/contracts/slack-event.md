# Contract — normalized Slack event and message

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers T104, T401, T402, T403, T404
- **Enforces:** INV-1, INV-6, INV-10, INV-12

Slack SDK types stop at the channel adapter. Everything downstream speaks the shapes here, so authorization, memory, and retrieval have no Slack coupling and are testable with plain objects.

## 1. Classification

Every inbound event resolves to exactly one class. The class determines which request path in the architecture doc applies, and specifically whether generation is permitted.

| Class | Meaning | Generation |
|---|---|---|
| `addressed` | DM to Gist, `app_mention`, or a message in a thread Gist is subscribed to | Permitted |
| `ambient` | Ordinary human message in an approved channel, Gist not addressed | **Forbidden** (INV-6) |
| `mutation` | `message_changed` or `message_deleted` | **Forbidden** |
| `skip` | Ignored; carries a `SkipReason` | n/a |

Classification happens **before** authorization and must not depend on stored state — it is a pure function of the event.

## 2. `NormalizedEvent`

```ts
type EventClass = 'addressed' | 'ambient' | 'mutation';

interface NormalizedEvent {
  contract_version: string;        // "1.0.0"
  class: EventClass;

  // Identity (INV-10). The triple is the message's primary key everywhere.
  workspace_id: string;            // Slack team ID, e.g. "T0SYNTH01"
  channel_id: string;              // channel or DM conversation ID
  message_ts: string;              // Slack ts, verbatim string — never parsed to float
  event_id: string;                // Slack envelope event ID, for delivery dedup

  conversation_type: 'channel' | 'dm';
  thread_ts: string | null;        // null for a non-threaded root message
  sender_id: string;
  sender_type: 'human' | 'bot' | 'app' | 'system';
  sender_is_external: boolean;     // Slack Connect / cross-workspace
  sender_is_guest: boolean;        // single- or multi-channel guest

  sent_at: string;                 // RFC 3339 UTC, derived from message_ts
  text: string;                    // may be empty only for a mutation delete
  addressed_to_gist: boolean;

  mutation?: MutationDetail;       // present iff class === 'mutation'
}
```

### Field rules

- **`message_ts` stays a string.** Slack timestamps are decimal strings whose precision does not survive a float round-trip; `"1735689600.000200"` and `"1735689600.0002"` must not collide or converge. Every comparison, key, and storage write uses the verbatim string. This is the single most common source of duplicate-or-lost records in Slack integrations.
- **`sent_at`** is derived from `message_ts` for human use (citations, D009). `message_ts` remains authoritative for identity and ordering.
- **`thread_ts === null`** means a root message. A reply carries its root's ts. `thread_ts === message_ts` is also a root and must normalize to `null` so both encodings converge (see `identity.md` §3).
- **`text`** is the message body after Slack-mention substitution. It is never logged (INV-12).

## 3. Idempotency

```ts
type MessageKey = `${string}/${string}/${string}`;   // workspace_id/channel_id/message_ts
function messageKey(e: NormalizedEvent): MessageKey;
```

- `messageKey` is the identity for **content**: the same message from live ingestion and from archive import produces the same key and converges to one record (INV-10). This is what makes FR-MEM-007 and AC-14 hold.
- `event_id` is the identity for **delivery**: a Slack retry of the same envelope must not produce a second reply (FR-SLK-008, AC-06). Delivery dedup is durable — an in-memory set does not survive the restart that AC-13 tests.

Both are required. Delivery dedup alone permits duplicate records from two different envelopes describing one message; content dedup alone permits duplicate replies.

## 4. Mutations (D005)

```ts
interface MutationDetail {
  kind: 'edit' | 'delete';
  target_ts: string;         // message_ts of the message being changed
  edited_at: string;         // RFC 3339
  new_text?: string;         // present iff kind === 'edit'
}
```

Required handler semantics:

| Case | Result |
|---|---|
| `edit` on a stored record | Update text, set edit timestamp, **re-embed**; stale pre-edit embedding must not survive |
| `delete` on a stored record | Delete record **and** embedding in one operation (INV-9); leave a content-free tombstone (`messageKey` + deletion timestamp) |
| Mutation for a never-stored message | No-op **success**, not an error — the original may have been legitimately skipped |
| Replayed mutation | No-op success (idempotent) |
| Mutation from an unapproved channel | Denied at authorization, **before** any storage lookup — so it cannot probe what Gist holds |
| Late delivery of an original after its delete | Tombstone suppresses re-ingestion |

Tombstones hold no message text. Ever.

## 5. Skip reasons

```ts
type SkipReason =
  | 'bot_message' | 'app_message' | 'system_subtype' | 'own_message'
  | 'empty_text' | 'unapproved_channel' | 'unapproved_workspace'
  | 'external_user' | 'guest_user' | 'malformed_event' | 'duplicate_delivery';
```

Skips are counted by reason for observability (NFR-OBS-003) and carry no message content. `unapproved_*`, `external_user`, and `guest_user` are produced by the authorization guard, not the normalizer — the normalizer has no policy knowledge; see `authorization.md`.

## 6. Normalizer interface

```ts
function normalize(raw: unknown): NormalizedEvent | { skip: SkipReason };
```

- **Total function.** Any input, including malformed or unknown-shape events, returns a value. It never throws — a Slack schema surprise must not take down the socket handler.
- **Pure.** No I/O, no storage, no clock beyond deriving `sent_at` from `message_ts`.
- Unknown event types return `{ skip: 'malformed_event' }` rather than a partially populated event.

## 7. Fixtures

[`fixtures/slack-events.v1.json`](./fixtures/slack-events.v1.json) — synthetic vectors for each class, both mutation kinds, every skip reason, the `thread_ts === message_ts` root case, and the timestamp-precision pair. All identifiers are synthetic.
