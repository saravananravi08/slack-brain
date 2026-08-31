# Gist Channel Memory — Product Requirements

## 1. Purpose

Turn Gist into the durable context layer for every internal Slack channel it joins. Gist listens continuously, stores all channel messages in an isolated channel boundary, maintains recent history and observational memory, and answers primarily from that context. Semantic search is available to the Gist agent as a channel-scoped fallback tool.

This document supersedes conflicting channel-memory behavior in `GIST_MASTRA_PRD.md` for P06 and P07. It does not define the later Linear/GitHub/Kilo work orchestrator.

## 2. Accepted product rules

- Capture begins when Gist joins a new channel; no historical backfill is required.
- The production process is intended to remain continuously online.
- One Gist instance may remember multiple joined channels.
- Every channel is an isolated memory boundary.
- Store all messages: human, Kilo, Gist, other bot, and app messages.
- Store roots and thread replies.
- Capture edits in place and replace stale embeddings.
- Ignore Slack delete events for now; retained content remains recallable.
- Capturing a message and deciding whether to respond are separate policies.
- Observation Memory is enabled per channel.
- Answers receive recent history, rolling summary, and observations by default.
- Semantic retrieval is exposed as a Gist-only tool pinned to the active channel.

## 3. Goals

- **CM-G1:** Preserve everything said in each joined Slack channel from join time onward.
- **CM-G2:** Keep channels structurally isolated during storage, observation, retrieval, and generation.
- **CM-G3:** Give Gist useful channel context without requiring semantic search on every turn.
- **CM-G4:** Let semantic search recover older details when summary, observations, and recent history are insufficient.
- **CM-G5:** Provide a stable context API for a later work-orchestration layer.

## 4. Non-goals

- Slack history backfill before Gist joins.
- Recovery of Slack messages unavailable after workspace retention removes them.
- Linear, GitHub, or Kilo workflow orchestration.
- Cross-channel memory sharing.
- Responding to bot/app traffic.
- Propagating Slack deletions into memory in this phase.

## 5. Functional requirements

### Channel enrollment and isolation

- **CM-FR-001:** Gist must maintain a durable registry of channels it has joined.
- **CM-FR-002:** Capture must start only after Slack confirms Gist membership in the channel.
- **CM-FR-003:** Gist must support simultaneous capture from multiple joined channels.
- **CM-FR-004:** Every stored message, observation, summary, history query, semantic query, and answer must be pinned to one workspace/channel boundary.
- **CM-FR-005:** Leaving a channel must stop new capture for that channel without silently deleting retained memory.
- **CM-FR-006:** No Slack history backfill is required; channel memory begins at enrollment.

### Complete live message capture

- **CM-FR-007:** Gist must capture human, bot, app, Kilo, and Gist-authored messages.
- **CM-FR-008:** Gist must capture channel roots and thread replies.
- **CM-FR-009:** Gist must preserve sender type, sender identity, channel, thread root, Slack timestamp, text, and available file/link metadata.
- **CM-FR-010:** Gist-authored outgoing messages must be persisted directly so memory does not depend on Slack echo behavior.
- **CM-FR-011:** Duplicate/retried Slack deliveries must converge on one stored message.
- **CM-FR-012:** Capture must not generate a Slack reply, typing indicator, or automation action.
- **CM-FR-013:** Bot/app messages may be captured but must not trigger Gist responses or bot-to-bot loops.
- **CM-FR-014:** Reconnect handling and Slack retries must remain supported; scheduled history reconciliation is not required.

### Edits and deletes

- **CM-FR-015:** `message_changed` must update the existing record keyed by original Slack message identity.
- **CM-FR-016:** An edit must preserve original sender, channel, thread, and sent timestamp, and record `edited_at`.
- **CM-FR-017:** An edit must replace the stale embedding and eventually invalidate or regenerate derived observations that contain stale text.
- **CM-FR-018:** Replayed edit events must be idempotent.
- **CM-FR-019:** `message_deleted` must be ignored in P06/P07; the stored message, embedding, summary, and observation may remain.

### Recent history and observational memory

- **CM-FR-020:** Gist must provide chronological recent history across all threads in the active channel.
- **CM-FR-021:** Current-thread history must remain separately identifiable from channel-wide recent history.
- **CM-FR-022:** Mastra Observation Memory must be enabled and isolated per channel.
- **CM-FR-023:** Background observation work may call the configured model but must never post to Slack.
- **CM-FR-024:** Observations must capture decisions, ongoing work, unresolved questions, conventions, and outcomes with source references where supported.
- **CM-FR-025:** Gist must maintain a compact rolling channel summary suitable for default prompt injection.
- **CM-FR-026:** Edited source content must not leave knowingly stale quoted text in regenerated summaries or observations.

### Answer context and semantic fallback

- **CM-FR-027:** Default answer context must include current thread, recent channel history, rolling channel summary, and channel observations.
- **CM-FR-028:** Gist must expose a `search_channel_memory` tool for semantic search.
- **CM-FR-029:** The tool must derive its channel boundary from authorized runtime context; the model must not supply or override a channel ID.
- **CM-FR-030:** Semantic search results must preserve sender/date attribution and remain inside the active channel.
- **CM-FR-031:** The agent should use semantic search only when default context is insufficient or the user asks about older details.
- **CM-FR-032:** The resulting channel-context interface must be reusable by a later orchestrator without exposing storage internals.

## 6. Non-functional requirements

- **CM-NFR-001:** One accepted Slack delivery produces at most one canonical message record.
- **CM-NFR-002:** Capture continues when model generation is unavailable; observation work may lag without blocking message persistence.
- **CM-NFR-003:** No query, observation, tool call, or answer may cross a channel boundary.
- **CM-NFR-004:** Application logs contain no message bodies, observation text, credentials, or private identifiers.
- **CM-NFR-005:** The always-online process exposes capture lag, failures, edit failures, observation lag, and semantic-tool usage.
- **CM-NFR-006:** A malformed bot/app event cannot trigger generation or outbound Slack activity.
- **CM-NFR-007:** Exact messages remain the source of truth; summaries and observations are derived context.

## 7. Context order

For an addressed question, build context in this order:

1. Current Slack thread.
2. Recent chronological channel history.
3. Rolling channel summary.
4. Channel observations.
5. Optional `search_channel_memory` calls for older or missing evidence.

The whole channel is never copied into one prompt. Exact messages remain durable; bounded context is assembled per request.

## 8. Acceptance scenarios

| ID | Scenario | Expected result |
|---|---|---|
| CM-AC-01 | Gist joins two channels | Both enroll; memory remains isolated |
| CM-AC-02 | Human posts root/reply | Both persist once without a Gist reply |
| CM-AC-03 | Kilo and another app post | Both persist; neither triggers Gist |
| CM-AC-04 | Gist posts a response | Outgoing response appears once in channel memory |
| CM-AC-05 | Slack retries delivery | Destination still contains one canonical record |
| CM-AC-06 | Message is edited | Same record is updated and old embedding no longer matches |
| CM-AC-07 | Message is deleted | Stored content remains unchanged under accepted temporary policy |
| CM-AC-08 | User asks about recent work | Answer uses history/summary/observations without requiring semantic search |
| CM-AC-09 | User asks about older detail | Agent may call scoped semantic tool and cite evidence |
| CM-AC-10 | Same query is asked in another channel | No source message, observation, or semantic result crosses boundary |
| CM-AC-11 | Observation generation fails | Exact capture continues and answer degrades to history/semantic evidence |
| CM-AC-12 | Gist leaves a channel | New capture stops; existing memory is retained |

## 9. Accepted risk

Ignoring delete events means content removed from Slack remains stored and recallable by Gist. This is an explicit temporary product decision for P06/P07, not an implementation omission. Re-enabling hard-delete propagation requires a new approved decision and regression of messages, embeddings, summaries, observations, and backups.

## 10. Contract mapping (P06 Wave 1)

Annotation added by T601. This section records where each requirement is frozen; it does not add, remove, or restate any requirement above.

The channel-memory contract set lives in [`docs/architecture/channel-memory/`](docs/architecture/channel-memory/) at version 1.0.0, with synthetic fixtures and contract tests in `tests/contracts/channel-memory/`.

| Requirements | Frozen in | Covers |
|---|---|---|
| CM-FR-001…006 | [`enrollment.md`](docs/architecture/channel-memory/enrollment.md) | Membership-authoritative enrollment, capture floor, no backfill, retention after leave |
| CM-FR-007, 012, 013 | [`capture-policy.md`](docs/architecture/channel-memory/capture-policy.md) | Capture eligibility, separated from response eligibility |
| CM-FR-007…011 | [`message-record.md`](docs/architecture/channel-memory/message-record.md) | Canonical sender classes, stored record, outgoing-message persistence, idempotency |
| CM-FR-015…019 | [`mutations.md`](docs/architecture/channel-memory/mutations.md) | Edit replacement on original identity; accepted delete-ignore and its risk |
| CM-FR-004, 011, 014 | [`invariants.md`](docs/architecture/channel-memory/invariants.md) | CM-INV-01…12: isolation, idempotency, separation, retention, logging |
| CM-FR-001…019 (complete map) | [`requirements-map.md`](docs/architecture/channel-memory/requirements-map.md) | Every requirement → contract clause or named integration rule |

CM-FR-020…032 are P07 and are not frozen by T601. CM-FR-026 straddles both: P06 emits the staleness signal (`mutations.md` §3.5), P07 regenerates the affected derived context.

The accepted risk in §9 is pinned by test in `tests/contracts/channel-memory/mutations.test.ts` so the behavior cannot change without a failing suite and a new approved decision.
