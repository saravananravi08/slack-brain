# Gist Slack supervisor contract index

- **Contract set:** `slack-supervisor`
- **Contract version:** 1.0.0
- **Frozen by:** T801, 2026-09-01
- **Requirement authority:** [`GIST_SLACK_SUPERVISOR_PRD.md`](../../../GIST_SLACK_SUPERVISOR_PRD.md) — GS-FR-001…043, GS-NFR-001…008
- **Governing decisions:** D023 (Slack-only bus), D024 (event eligibility), D025 (human authority and approvals), D026 (durable workflow authority), D027 (structured actions, runtime destinations), D028 (serialization, limits, cooldown separation), D029 (compatibility failure blocks the path)
- **Change control:** after T801 merges, **any change to a file in this directory requires coordinator approval** and a version bump below. T803 is the one task pre-authorized to amend this set, and only where T802's measured evidence requires it. A P09/P10 worker who finds a contract wrong must stop and mark their task `Blocked` rather than editing the contract in their own branch.

This set is the interface between T802 (which must measure exactly the fields `compatibility.md` names), T803 (which finalizes the protocol and threat model against measured behavior), and the P09/P10 runtime tasks T901–T906 and T1001–T1004, which run in parallel with disjoint code scopes and must still compose.

Nothing here is runtime code. P09 owns `src/orchestration/**`; T801 writes no source file.

## Files

| File | Defines | Primary consumers |
|---|---|---|
| [`identity.md`](./identity.md) | Exact-ID actor identity, trust precedence, and the human/trusted-bot/self/unknown routing matrix | T902, T905, T803 |
| [`events.md`](./events.md) | Supervisor event record, correlation to a workflow binding, per-workflow serialization, cooldown separation | T902, T905 |
| [`workflow-state.md`](./workflow-state.md) | Workflow record, the thirteen states, the legal transition table, compare-and-set rules, limits, transition audit | T901, T905, T906 |
| [`actions.md`](./actions.md) | The ten-member supervisor action union, logical target → destination mapping, instruction envelope, untrusted-content rules | T904, T903 |
| [`approvals.md`](./approvals.md) | Gated action classes, version-bound approval, ownership and transfer, human control verbs | T904, T1001 |
| [`dispatch.md`](./dispatch.md) | Action checkpoint, delivery state machine, one-event/one-action claim, restart reconciliation, failure taxonomy | T903, T905, T906 |
| [`compatibility.md`](./compatibility.md) | The exact content-free measurements T802 must obtain, and the correlation strategy each outcome permits | T802, T803 |
| [`invariants.md`](./invariants.md) | GS-INV-01…14: the properties every P08–P10 change is checked against | all |
| [`requirements-map.md`](./requirements-map.md) | GS-FR-001…043 and GS-NFR-001…008 → contract clause, integration rule, or named later task | integrator, T803, T906, T1004 |
| [`../../../tests/contracts/slack-supervisor/fixtures/`](../../../tests/contracts/slack-supervisor/fixtures/) | Versioned synthetic test vectors | all downstream tests |

Fixtures live under `tests/contracts/slack-supervisor/fixtures/` rather than beside these documents, because T801's declared write scope places them there. `fixtures/manifest.json` carries the same `contract_version` as this file and is the list of legal synthetic identifiers.

## 1. Relationship to the frozen sets below it

Two contract sets are already frozen and are **not modified by T801**:

- `docs/architecture/contracts/` (v1, T004) — `MessageKey`, `BoundaryId`, `ThreadId`, the deny taxonomy, the never-log-message-text rule.
- `docs/architecture/channel-memory/` (channel-memory 1.0.0, T601, patched to 1.0.1 by D018) — enrollment, capture policy, the six sender classes, mutations, CM-INV-01…12.

This set is **purely additive**. It supersedes nothing. Every clause here sits *after* capture in the pipeline and adds a supervision layer on top of memory that already exists:

```text
Slack event
→ exact-message persistence          (channel-memory 1.0.0 — unchanged)
→ sender and boundary classification (channel-memory 1.0.0 — unchanged)
→ trusted event routing              (identity.md, events.md — new)
→ workflow correlation               (events.md — new)
→ supervisor decision                (actions.md — new)
→ zero or one bounded action         (dispatch.md — new)
```

Vocabulary is reused rather than restated:

- `MessageKey = workspace_id/channel_id/message_ts`, and `message_ts` is **never** parsed to a float — `contracts/slack-event.md` §2, §3; `channel-memory/invariants.md` CM-INV-06.
- `BoundaryId = ch:<workspace_id>:<channel_id>`, `ThreadId = <boundary_id>#<thread_root_ts>` — `contracts/identity.md` §2, §3.
- The six sender classes `human | gist | kilo | bot | app | system` and their configured-ID resolution order — `channel-memory/message-record.md` §2.
- Capture never implies response, and the capture path is silent — CM-INV-08, CM-INV-09.

Three points where this set **extends** an existing rule without weakening it, each stated in full where it lives:

| Existing rule | Still true | What this set adds | Authority |
|---|---|---|---|
| `channel-memory/capture-policy.md` §4 — every non-human sender is response-ineligible | Yes, verbatim, for the **human response** path | A separate **supervisor evaluation** path that trusted Kilo/Linear events enter *after* persistence and that never consults the human response authorizer (`events.md` §3) | D024, GS-FR-017 |
| `src/mastra/channels/proactive.ts` — per-channel cooldown suppresses unsolicited commentary | Yes, for proactive channel commentary | Active-workflow events bypass the cooldown entirely and are serialized per workflow instead (`events.md` §5) | D028, GS-FR-021 |
| `channel-memory/message-record.md` §2 — Kilo is recognised from `kilo_bot_id` / `kilo_app_id` | Yes | Linear joins the same mechanism as a second configured trusted identity, and `linear` becomes a supervisor **actor class**, not a seventh sender class (`identity.md` §1) | D023, GS-FR-008 |

The last row matters for implementers: `sender_class` stays a six-member union owned by channel-memory. The supervisor derives its own `ActorClass` from `sender_class` plus configuration; it does not widen anyone else's type.

## 2. Versioning

One semantic version for the set, recorded in every file header and in `fixtures/manifest.json`.

- **Patch** — clarification, no shape change.
- **Minor** — additive optional field; existing consumers stay valid.
- **Major** — removal, rename, or semantic change; every consuming task re-verifies.

This set versions **independently** of the v1 and channel-memory sets. Tests pin `contract_version` and fail loudly on a bump rather than silently drifting.

T803 is expected to produce at least a patch bump: `compatibility.md` §5 lists the clauses whose final wording is conditional on T802's measurements, so that the places live evidence may move are known in advance rather than discovered during review.

## 3. Synthetic identifiers

Every identifier in this set and its fixtures is invented. No real workspace, channel, user, bot, app, message body, URL, token, prompt, model output, or trace appears here or in `tests/contracts/slack-supervisor/**` (FR-PRV-007, GS-NFR-004). `contract-safety.test.ts` enforces this by scanning the fixtures and the contract documents against the manifest allowlist, so a real ID pasted in later fails the suite rather than merging quietly.

The corpus is workspace `T0SUPVTEST` with channels `C0SUPVTESTA` and `C0SUPVTESTB`; actors are listed in `fixtures/manifest.json`.

## 4. How to use these

1. Read the contract for your surface **before** writing code.
2. Import the fixture vectors rather than inventing your own — cross-task agreement is the point.
3. `tests/contracts/slack-supervisor/reference-rules.ts` is the executable statement of these rules. It is **not** the runtime implementation; T901–T904 own that. Drive your implementation against the same fixtures and use it as an oracle.
4. If a contract is wrong or silent on something you need, stop and record a blocker. Do not resolve product ambiguity in an implementation branch.

## 5. Standing constraints this set inherits

- **GS-NFR-008 — single process.** The Socket Mode/storage design remains one process. Every serialization rule in `events.md` §5 is in-process ordering plus a durable compare-and-set, not a distributed lock. A second concurrent writer invalidates the analysis in `dispatch.md` §3 and requires a new decision.
- **D023 — Slack is the only bus.** No clause here may be implemented by calling Linear, GitHub, Kilo Cloud, or an MCP server. A capability that cannot be expressed as a Slack instruction to a trusted bot is out of scope, not a reason to add a connector.
- **GS-NFR-004 — privacy.** Every record shape in this set carries IDs, classes, counts, and coarse times. Where conversation content is needed it is *referenced* by `MessageKey` into channel memory, never copied into workflow state.
