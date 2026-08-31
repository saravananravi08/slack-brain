# Contract — channel isolation and idempotency invariants

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen); consumers all P06/P07 tasks
- **Implements:** D013, D014, D015
- **Satisfies:** CM-FR-003, CM-FR-004, CM-FR-011, CM-FR-012, CM-FR-013, CM-FR-014, CM-NFR-001, CM-NFR-003, CM-NFR-004

These are the properties every P06/P07 change is checked against. Each is stated so it can fail a test, not only an argument.

## Isolation

**CM-INV-01 — one boundary per operation.**
Every capture, read, mutation, summary, observation, retrieval, and answer names exactly one `ch:<workspace_id>:<channel_id>` boundary. Not a list, not a default, not an optional filter (CM-FR-004). A `CaptureDecision` carries a single `BoundaryId`; a scope of length ≠ 1 for a channel request is a contract violation.

**CM-INV-02 — no cross-channel path exists.**
No query, embedding search, summary, observation, tool call, or answer may read from a boundary other than the request's own (CM-NFR-003). Boundary filtering happens **inside** the query, never as post-filtering of results that were already scored across channels (`storage.md` §2). Two channels holding messages with the same Slack `ts` remain two records in two boundaries.

**CM-INV-03 — channels are independent.**
One channel's backlog, embedding failure, leave, or malformed event has no effect on another channel's capture (CM-FR-003). Simultaneous enrollment is normal operation, not a special mode.

**CM-INV-04 — the boundary prefix is structural.**
`ch:` is never stripped, and a `dm:` record can never be written into a `ch:` boundary or the reverse (`identity.md` §4, INV-3/INV-4). This set adds no path around it: channel memory has no DM surface at all.

## Identity and idempotency

**CM-INV-05 — one accepted delivery, at most one record.**
`message_key = workspace_id/channel_id/message_ts` is content identity; `event_id` is delivery identity. Both are required, both are durable, and delivery dedup must survive restart (CM-NFR-001, CM-FR-011). A Slack retry, a reconnect replay, and a restart mid-burst all converge on one record.

**CM-INV-06 — `message_ts` is a verbatim string.**
Never parsed to a float, never normalized, never trimmed. `"1735689600.000200"` and `"1735689600.0002"` are distinct identities. Ordering comparisons pad the fractional part; identity comparisons never do (`enrollment.md` §3).

**CM-INV-07 — mutations key on original identity.**
An edit or delete resolves through the original message's `message_key`, never through the mutation event's own timestamp. Replays are no-ops; apply-if-newer resolves reordering (`mutations.md` §3.3).

## Capture / response separation

**CM-INV-08 — capture never implies response.**
`capture: true` grants nothing. For every sender class other than `human`, `respond_allowed` is `false` regardless of capture (CM-FR-013). No function takes a `CaptureDecision` as an input to a response decision (`capture-policy.md` §2).

**CM-INV-09 — the capture path is silent.**
Capture performs no Slack write of any kind and triggers no generation: no reply, thread post, typing indicator, reaction, status, automation, or webhook (CM-FR-012, CM-NFR-006). A malformed bot or app event cannot produce outbound activity.

## Retention and privacy

**CM-INV-10 — membership changes never delete.**
Leaving a channel stops capture and retains memory; only an explicit operator purge or a D004 retention sweep deletes, through the single v1 `deleteMessages` primitive (CM-FR-005). Under D015 a Slack `message_deleted` deletes nothing and writes no tombstone (`mutations.md` §4).

**CM-INV-11 — logs carry no content.**
No message text, file name, link URL, summary text, observation text, credential, or private identifier reaches application logs (CM-NFR-004). Skips, denials, and ignored mutations are counted **by reason**, and every reason string is safe to log.

**CM-INV-12 — fixtures are synthetic.**
No real workspace, channel, user, bot, app, message body, URL, token, or trace appears in this contract set or its fixtures (FR-PRV-007). Enforced by `contract-safety.test.ts` against the manifest allowlist, so the next person to add a fixture cannot paste a production ID without failing the suite.

## Where each is pinned

| Invariant | Pinned by |
|---|---|
| CM-INV-01, 02, 03, 04 | `isolation.test.ts` |
| CM-INV-05, 06, 07 | `messages.test.ts`, `mutations.test.ts` |
| CM-INV-08, 09 | `capture-policy.test.ts` |
| CM-INV-10 | `enrollment.test.ts`, `mutations.test.ts` |
| CM-INV-11 | `contract-safety.test.ts` (reason strings), reviewed in T604/T606 code |
| CM-INV-12 | `contract-safety.test.ts` |
