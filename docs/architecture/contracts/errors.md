# Contract — errors, user-facing messages, and logging

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers all
- **Enforces:** INV-11, INV-12
- **Implements:** FR-RSP-007/008, FR-PRV-008, NFR-OBS-001/003, AC-15

## 1. Two audiences, never mixed

| Audience | Sees | Never sees |
|---|---|---|
| Slack user | One short sentence + a run ID | Framework names, model IDs, storage paths, boundary/thread IDs, deny reasons, stack traces, provider errors |
| Operator (traces, restricted) | Full class, cause, run ID, message keys | — |
| Application log (14d, unrestricted) | Class, run ID, counts | Message bodies, tokens, DM content, deny reasons naming a channel |

The legacy system printed exception detail to process output while showing users a generic retry (T002 baseline). The contract keeps that split but makes the operator half durable and correlatable instead of transient.

## 2. Taxonomy

```ts
type ErrorClass =
  | 'config_invalid'        // startup only — fail closed, never degrade
  | 'unauthorized'          // authorization denied
  | 'event_malformed'
  | 'storage_unavailable'
  | 'retrieval_failed'
  | 'model_unavailable'     // provider error, rate limit, timeout
  | 'model_refused'
  | 'internal';

interface GistError {
  class: ErrorClass;
  run_id: string;           // NFR-OBS-001, correlates Slack event ↔ run
  cause?: unknown;          // operator-only, never serialized to Slack
  deny_reason?: DenyReason; // operator-only
}
```

## 3. User-facing messages

Fixed strings. Not model-generated — an error path must not depend on the component that may be failing.

| Class | Slack message |
|---|---|
| `unauthorized` | *"I can't help with that here."* |
| `retrieval_failed`, `storage_unavailable` | *"I couldn't get to my notes just now — try again in a moment."* |
| `model_unavailable`, `model_refused` | *"I couldn't finish that one. Try again in a moment."* |
| `event_malformed`, `internal` | *"Something went wrong on my end."* |
| `config_invalid` | No user message — the service does not start. |

Rules:

1. **`unauthorized` never explains why.** Distinguishing "channel not approved" from "you are a guest" tells an unauthorized asker about the policy and the channel's existence.
2. Never name a provider, model, framework, or file path (INV-11, FR-RSP-007).
3. A run ID may be appended for support, and is meaningless outside operator tooling.
4. **An error reply is still one reply** (FR-SLK-007). A failure after a partial stream edits that message rather than posting a second one.
5. Gist identifies only as Gist (FR-RSP-001) — including in errors.

## 4. Failure containment (NFR-REL-003)

| Failure | Required outcome |
|---|---|
| Model call fails mid-request | Channel/memory state unchanged; user turn already persisted stays persisted; no partial assistant record |
| Retrieval fails | Either answer without recall and say so, or return `retrieval_failed`. **Never** silently answer as though history were searched and empty — that manufactures a confident wrong answer, which is worse than an error (D009, FR-RSP-006) |
| Storage write fails during silent ingestion | Log by class and count; no reply, no model call (INV-6). Ingestion failures are never user-visible |
| Duplicate delivery | No error; drop as `duplicate_delivery` |
| Authorization denies | Not an exception. A normal, expected outcome with a deny reason |
| Config invalid at startup | Process exits non-zero. Never start with a partial or defaulted policy (D001, FR-OPS-001) |

The retrieval-failure row is the one most likely to be implemented wrong by accident: an empty result and a failed search are indistinguishable at the call site unless the contract forces them apart.

## 5. Logging rules

Permitted: error class, run ID, `message_key`, `boundary_id`, counts, durations, skip/deny reason codes.

Forbidden in application logs: message text, thread text, user display names in DM context, tokens, API keys, full traces, prompt content, retrieved item text.

Traces may hold content but are operator-restricted with 30-day retention (D004, D010, R7). The distinction is deliberate: logs are broadly readable and long-lived relative to their sensitivity; traces are neither.

## 6. Fixtures

[`fixtures/errors.v1.json`](./fixtures/errors.v1.json) — each class with its exact user-facing string and the operator fields that must not reach Slack, so T501/T502 can assert both halves.
