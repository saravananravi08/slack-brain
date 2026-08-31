# Contract — canonical sender classes and the channel message record

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen); consumers T603, T604, T606
- **Implements:** D014
- **Satisfies:** CM-FR-007, CM-FR-008, CM-FR-009, CM-FR-010, CM-FR-011, CM-NFR-001, CM-NFR-007
- **Enforces:** CM-INV-05, CM-INV-06

Every captured message resolves to one record shape with one sender shape, whoever sent it. Downstream context assembly, retrieval, and attribution then have no sender-class special cases to get wrong.

## 1. Sender classes

```ts
type ChannelSenderClass = 'human' | 'gist' | 'kilo' | 'bot' | 'app' | 'system';
```

| Class | Meaning | Captured | Response-eligible |
|---|---|---|---|
| `human` | A person in the workspace | Yes | Yes, if addressed and authorized |
| `gist` | Gist's own bot user — outgoing or echoed | Yes | **Never** (`self_authored`) |
| `kilo` | The Kilo automation identity | Yes | **Never** (`non_human_sender`) |
| `bot` | Any other bot user | Yes | **Never** |
| `app` | An app/integration posting without a bot user | Yes | **Never** |
| `system` | Channel lifecycle subtype | **No** — not message content | **Never** |

`system` is in the union so classification is total, not because such events are stored. They deny at `capture-policy.md` §3 rule 5.

## 2. Canonical sender

```ts
interface CanonicalSender {
  sender_class: ChannelSenderClass;

  sender_id: string;             // U… bot- or human-user ID; falls back to bot_id, then app_id
  sender_display_name: string;   // resolved at write time (storage.md §1)
  bot_id: string | null;         // B… when Slack provides one
  app_id: string | null;         // A… when Slack provides one
  username: string | null;       // legacy bot `username` override, when present

  is_gist_self: boolean;
  is_external: boolean;
  is_guest: boolean;
}
```

- **No eligibility field.** `CanonicalSender` describes who sent a message; it never states what Gist may do about it. Response eligibility is computed by `responseDecision` from the event and policy (`capture-policy.md` §2). A cached boolean here would be read as permission, and the whole point of D014 is that "we store this" and "we answer this" are different facts.
- **`sender_display_name` is resolved at write time**, per `storage.md` §1 — a read-time lookup fails for deactivated users, renamed bots, and uninstalled apps, which is exactly the population this set adds.
- **`sender_id` never falls back to a text heuristic.** If no user, bot, or app ID is available the event is `malformed_event`. Identifying a sender by display name lets a renamed bot impersonate a person in stored history.

### Resolution order (deterministic, first match wins)

1. `bot_user_id`, or `user`, equals Gist's configured own bot user ID → `gist` (`is_gist_self: true`).
2. `bot_id` or `app_id` matches the configured Kilo identity → `kilo`.
3. Message is a channel lifecycle subtype → `system`.
4. `bot_id` present, or subtype `bot_message` → `bot`.
5. `app_id` present with no bot user → `app`.
6. Otherwise → `human`.

Gist and Kilo are recognized from **configured identifiers**, never from display name or text. Order matters: Gist before Kilo before generic bot, so a self-message can never be classified `bot` and lose its loop-stop, and Kilo can never be mistaken for an anonymous app.

The configured identities are runtime configuration, not contract constants. Fixtures use the synthetic values in `fixtures/manifest.json`.

## 3. Channel message record

Extends v1 `StoredMessage` (`storage.md` §1). Additive only; every v1 field keeps its v1 meaning.

```ts
type CaptureSource = 'live_event' | 'outgoing_self';

interface FileRef {
  file_id: string;
  name: string;
  mimetype: string;
  size_bytes: number;
}

interface LinkRef {
  url: string;
  domain: string;
}

interface ChannelMessageRecord {
  contract_version: string;

  message_key: MessageKey;        // workspace_id/channel_id/message_ts — primary key (CM-INV-05)
  boundary_id: BoundaryId;        // ch: only
  thread_id: ThreadId;
  workspace_id: string;
  channel_id: string;

  message_ts: string;             // verbatim Slack ts
  thread_root_ts: string;         // identity.md §3 — both root encodings collapse here
  is_thread_reply: boolean;       // thread_root_ts !== message_ts

  sender: CanonicalSender;
  sent_at: string;                // RFC 3339 UTC, derived from message_ts
  edited_at: string | null;

  text: string;
  files: readonly FileRef[];
  links: readonly LinkRef[];

  capture_source: CaptureSource;
  ingested_at: string;
  enrollment_epoch: number;       // enrollment.md §4
}
```

Field rules:

- **`message_ts` is a verbatim string** everywhere — key, comparison, storage (`slack-event.md` §2). `"1735689600.000200"` and `"1735689600.0002"` are two distinct messages with two distinct `message_key`s.
- **`is_thread_reply` is derived, not carried from Slack.** Both Slack root encodings (`thread_ts` absent, `thread_ts === message_ts`) collapse to `thread_root_ts === message_ts`, so a root can never be recorded as a reply and a thread can never split in two (CM-FR-008).
- **`files` and `links` hold metadata only** — no file bytes, no fetched page content (CM-FR-009). They are `readonly` arrays and are `[]` when absent, never `null`, so consumers need no presence check.
- **`text` is never written to application logs** (CM-NFR-004, INV-12). Nor are `files[].name` or `links[].url` — a file name and a URL are message content.
- **`enrollment_epoch`** records which visit captured the record, so a re-join gap (`enrollment.md` §4) is visible in the data rather than only in the registry.
- Exact records are the source of truth; summaries and observations are derived and never replace them (CM-NFR-007).

## 4. Gist's own outgoing messages (CM-FR-010)

Gist persists its own messages **directly at send time**, with `capture_source: 'outgoing_self'`, using the `ts` returned by the Slack post call.

- Memory must not depend on Slack echoing Gist's own message back as an event. Whether an app receives its own message depends on subscription and adapter behavior; either assumption produces a defect — a silent gap, or a duplicate.
- If the post call returns no usable `ts`, **no record is written**. The event path then captures it if an echo arrives. Writing a record under a guessed key would create a second, unmergeable row for one message, which is the worse of the two failures.
- When both paths fire, they converge: identical `message_key` → one record (§5). `capture_source` records which path wrote first and is **not** part of identity.

## 5. Idempotency and convergence

```ts
function upsertChannelMessage(r: ChannelMessageRecord): 'inserted' | 'updated' | 'unchanged';
```

Keyed on `message_key`, per v1 `storage.md` §5. Required outcomes:

| Case | Result |
|---|---|
| First delivery | `inserted` |
| Slack retry, same envelope `event_id` | Denied earlier as `duplicate_delivery`; storage is never reached (CM-INV-05) |
| Same message, different envelope | `unchanged` — one canonical record (CM-NFR-001, CM-INV-05) |
| `outgoing_self` write then Slack echo | `unchanged` — one record, `capture_source` stays `outgoing_self` |
| Same `ts`, different channel | Two records — different `message_key`, different boundary (CM-INV-02) |
| Restart mid-burst, redelivery | `unchanged` for anything already stored |

Both dedup layers are required and neither substitutes for the other: `event_id` stops duplicate *deliveries*, `message_key` stops duplicate *records*. Delivery dedup must be durable, since the retry commonly arrives after the restart that lost an in-memory set.

## 6. Fixtures

[`../../../tests/contracts/channel-memory/fixtures/senders.v1.json`](../../../tests/contracts/channel-memory/fixtures/senders.v1.json) — one raw-shape case per class, including a bot with no user ID and an app with no bot ID, plus the two ordering traps (Gist self before generic bot; Kilo before generic app).

[`../../../tests/contracts/channel-memory/fixtures/messages.v1.json`](../../../tests/contracts/channel-memory/fixtures/messages.v1.json) — roots and thread replies in both channels, every sender class, both root encodings, a retried delivery, an `outgoing_self` record with its later echo, and the same `ts` in two channels.
