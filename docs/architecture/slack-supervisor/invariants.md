# Contract — supervisor invariants

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers all P08–P10 tasks
- **Implements:** D023, D024, D025, D026, D027, D028, D029
- **Satisfies:** GS-NFR-001…008

These are the properties every P08–P10 change is checked against. Each is stated so it can fail a
test, not only an argument. They compose with, and never relax, the channel-memory set's
CM-INV-01…12.

## Isolation

**GS-INV-01 — one workflow, one immutable binding.**
Every workflow names exactly one `(workspace_id, channel_id, thread_root_ts, owner_user_id,
workflow_id)`. The binding is fixed at creation and never edited (`events.md` §4.1). A thread holds
at most one non-terminal workflow, so no bot reply in a bound thread is ambiguous
(GS-NFR-001).

**GS-INV-02 — no cross-boundary transition exists.**
No workflow state, context, instruction, bot output, or action crosses a workspace, channel, or
thread boundary. Wrong workspace, wrong channel, wrong thread, a DM, and an external/shared channel
all resolve to "no workflow matched" and change nothing (`events.md` §4.4). Destination is derived
from the binding, never from an action (`actions.md` §3 step 7).

## Authority

**GS-INV-03 — durable workflow state is the only authority.**
A summary, an observation, a semantic-recall hit, a rendered context block, or a model's belief
cannot advance workflow state, satisfy an approval, or authorize a dispatch. Only the
`WorkflowRecord` read at decision time can (D026, `workflow-state.md` §3.2). Exact messages remain
evidence.

**GS-INV-04 — identity is exact configured IDs.**
Actor identity resolves by whole-string equality against configured `U…` / `B…` / `A…` values.
Display name, username, message text, emoji, bot profile, unfurl, and model output are never
identity evidence, at any gate (`identity.md` §2, GS-FR-008). Two configurations disagreeing
resolves to `unknown_automation`, not to trust.

**GS-INV-05 — Gist never evaluates itself.**
`gist_self` events are persisted and never evaluated. This is unconditional: no configuration,
allowlist, flag, or later decision may enable it (GS-FR-040, `identity.md` §3).

**GS-INV-06 — unknown automation cannot activate the supervisor.**
An automation identity that is not in `TrustedAutomationConfig` is capture-only. It cannot create,
advance, approve, redirect, or terminate a workflow (GS-FR-011, D024).

**GS-INV-07 — trusted content is untrusted evidence.**
A message from a trusted bot is trusted to be *from that bot* and nothing more. No content from any
actor may set a destination, grant an approval, change an owner, widen scope, raise a limit, or
alter policy (`identity.md` §4, `actions.md` §6, GS-FR-026).

**GS-INV-08 — only authorized humans own, approve, cancel, and redirect.**
Workflow creation, ownership, ownership transfer, approval, cancellation, and material redirection
require an `authorized_human` who is the owner or a configured approver (`approvals.md` §3, §4,
GS-FR-016, GS-FR-035, GS-NFR-003).

## Action integrity

**GS-INV-09 — one event, at most one durable external action.**
`ActionClaimKey = wf:<workflow_id>|ev:<source_event_key>` is claimed durably before the action
becomes externally visible. A second externally visible action for the same event is refused
(GS-FR-024, `dispatch.md` §2).

**GS-INV-10 — the model never controls a Slack identifier.**
A validated `SupervisorAction` contains no channel ID, thread timestamp, user ID, bot ID, app ID,
workspace ID, or Slack permalink, anywhere, including inside instruction text. The model selects a
`LogicalTarget`; the runtime maps it after authorization, state, approval, and compatibility checks
(D027, GS-FR-023, `actions.md` §3).

**GS-INV-11 — approvals are version-bound.**
An approval authorizes one workflow, one action, one action version, granted by the owner or a
configured approver, within its expiry. Any material change increments the version and invalidates
the approval structurally (GS-FR-036, `approvals.md` §3).

**GS-INV-12 — restart and retry cannot duplicate a dispatch.**
The checkpoint write precedes the Slack call; `delivered` is set only from a confirmed outgoing
message identity; retries share one action and one version; an unreconcilable in-flight action asks
a human rather than re-sending (GS-FR-015, GS-FR-020, GS-FR-043, GS-NFR-002, `dispatch.md` §2, §5).

**GS-INV-13 — autonomy is bounded and survives restart.**
Every workflow carries `max_turns`, `max_consecutive_failures`, `inactivity_timeout_ms`,
`absolute_lifetime_ms`, and `max_in_flight_actions = 1` on its own record. Limits are checked before
evaluation and before dispatch, are re-derived from durable timestamps after restart, and cannot be
raised by channel content. Reaching one moves the workflow to `waiting_human`, `failed`, or
`timed_out` — never silent continuation (GS-FR-038, GS-FR-039, GS-NFR-007,
`workflow-state.md` §7).

## Privacy and provenance

**GS-INV-14 — records, logs, and fixtures are content-free and synthetic.**
Workflow records, action checkpoints, transition records, compatibility measurements, and every log
line carry IDs, classes, counts, and coarse times only. No message text, display name, file name,
link URL, prompt, model output, raw payload, credential, or trace (GS-NFR-004, GS-NFR-005). No real
workspace, channel, user, bot, or app identifier appears in this contract set or in
`tests/contracts/slack-supervisor/**` (FR-PRV-007). Enforced by `contract-safety.test.ts` against
the manifest allowlist, so the next person to add a fixture cannot paste a production ID without
failing the suite.

## Where each is pinned

| Invariant | Pinned by |
|---|---|
| GS-INV-01, 02 | `events.test.ts`, `actions.test.ts` |
| GS-INV-03 | `workflow-state.test.ts` |
| GS-INV-04, 05, 06 | `identity-routing.test.ts` |
| GS-INV-07 | `identity-routing.test.ts`, `actions.test.ts` |
| GS-INV-08 | `approvals.test.ts` |
| GS-INV-09 | `dispatch.test.ts` |
| GS-INV-10 | `actions.test.ts`, `contract-safety.test.ts` |
| GS-INV-11 | `approvals.test.ts` |
| GS-INV-12 | `dispatch.test.ts` |
| GS-INV-13 | `limits.test.ts` |
| GS-INV-14 | `contract-safety.test.ts` |
