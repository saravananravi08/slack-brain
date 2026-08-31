# Requirement map — CM-FR-001…019 → contract clause or integration rule

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen)
- **Requirement authority:** [`GIST_CHANNEL_MEMORY_PRD.md`](../../../GIST_CHANNEL_MEMORY_PRD.md) §5

Every requirement in P06's coverage range resolves to a **contract clause** (frozen shape or rule in this set) or an **integration rule** (behavior no single Wave-1 contract can hold, assigned to a named task). Nothing in the range is unassigned. `requirements-map.test.ts` asserts this table stays complete and that every referenced file exists.

Legend — **Kind:** `contract` = pinned by a clause here; `integration` = clause plus a named task that must compose it.

## Channel enrollment and isolation

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| CM-FR-001 | Durable registry of joined channels | contract | `enrollment.md` §1, §2 rule 4, §6 | T602 |
| CM-FR-002 | Capture only after Slack confirms membership | contract | `enrollment.md` §2 rules 1–3 | T602 |
| CM-FR-003 | Simultaneous multi-channel capture | contract | `enrollment.md` §2 rule 5; `invariants.md` CM-INV-03 | T602, T606 |
| CM-FR-004 | Every operation pinned to one boundary | contract | `invariants.md` CM-INV-01, CM-INV-02; `capture-policy.md` §1 | all |
| CM-FR-005 | Leave stops capture, retains memory | contract | `enrollment.md` §5; `invariants.md` CM-INV-10 | T602 |
| CM-FR-006 | No backfill; memory begins at enrollment | contract | `enrollment.md` §3, §4 | T602 |

## Complete live message capture

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| CM-FR-007 | Capture human, bot, app, Kilo, Gist senders | contract | `message-record.md` §1; `capture-policy.md` §3 ("sender class is not in this list") | T603, T604 |
| CM-FR-008 | Capture roots and thread replies | contract | `message-record.md` §3 (`thread_root_ts`, `is_thread_reply`) | T604 |
| CM-FR-009 | Preserve sender, channel, thread, ts, text, file/link metadata | contract | `message-record.md` §2, §3 | T603, T604 |
| CM-FR-010 | Persist Gist's own outgoing messages directly | integration | `message-record.md` §4 — send path writes `outgoing_self`; echo path converges by `message_key` | T604 + T606 |
| CM-FR-011 | Duplicate/retried deliveries converge on one record | contract | `message-record.md` §5; `invariants.md` CM-INV-05 | T604 |
| CM-FR-012 | Capture generates no reply, typing, or automation | contract | `capture-policy.md` §5 (`CaptureEffect = never`); `invariants.md` CM-INV-09 | T604, T606 |
| CM-FR-013 | Bot/app captured but never trigger responses | contract | `capture-policy.md` §4 rules 1–2, §6; `invariants.md` CM-INV-08 | T603, T606 |
| CM-FR-014 | Reconnect and retry supported; no scheduled reconciliation | integration | `enrollment.md` §6 (idempotent membership replay, floor never moves backwards) + `message-record.md` §5 (durable delivery dedup across restart) | T602, T604, T606 |

## Edits and deletes

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| CM-FR-015 | `message_changed` updates the record keyed on original identity | contract | `mutations.md` §2, §3 | T605 |
| CM-FR-016 | Edit preserves sender, channel, thread, sent time; records `edited_at` | contract | `mutations.md` §3.1 | T605 |
| CM-FR-017 | Edit replaces stale embedding; invalidates derived observations | integration | `mutations.md` §3.2 (embedding, in P06) + §3.5 (`DerivedInvalidation` emitted in P06, regenerated in P07) | T605 (emit), T702/T705 (consume) |
| CM-FR-018 | Replayed edits are idempotent | contract | `mutations.md` §3.3 apply-if-newer; `invariants.md` CM-INV-07 | T605 |
| CM-FR-019 | `message_deleted` ignored in P06/P07 | contract | `mutations.md` §4, §4.1 | T605 |

## Non-functional requirements in P06 coverage

| Req | Summary | Kind | Where |
|---|---|---|---|
| CM-NFR-001 | One accepted delivery → at most one canonical record | contract | `invariants.md` CM-INV-05; `message-record.md` §5 |
| CM-NFR-002 | Capture continues when generation is unavailable | contract | `capture-policy.md` §5; `mutations.md` §3.2 (stale-embedding retry, text still updated) |
| CM-NFR-004 | Logs carry no bodies, credentials, or private identifiers | contract | `invariants.md` CM-INV-11; `message-record.md` §3 |
| CM-NFR-006 | Malformed bot/app event cannot trigger generation or outbound activity | contract | `capture-policy.md` §3 rule 6, §4 rules 1–2, §5; `invariants.md` CM-INV-09 |

## Deliberately out of Wave 1

CM-FR-020…032 (recent history, Observation Memory, rolling summary, answer context, `search_channel_memory`) belong to P07 and are **not** frozen here. Two P06 clauses exist specifically so P07 can land without reopening this set:

1. `mutations.md` §3.5 — `DerivedInvalidation`, the signal P07 consumes for CM-FR-026.
2. `invariants.md` CM-INV-01/CM-INV-02 — the isolation guarantee P07's retrieval and observation work inherits (CM-FR-022, CM-FR-029, CM-FR-030).

CM-FR-026 appears in both ranges: its P06 half (emit the staleness signal) is frozen here; its P07 half (regenerate without stale quotes) is not.
