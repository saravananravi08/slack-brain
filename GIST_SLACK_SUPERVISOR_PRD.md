# Gist Slack Supervisor — Product Requirements

- **Status:** Accepted for implementation
- **Product owner:** saravanan
- **Date:** 2026-08-31
- **Implementation branch:** `feature/gist-slack-bot-supervisor`
- **Depends on:** Gist channel-memory/context baseline through `5fdf8e2`

## 1. Product statement

Gist is a persistent Slack supervisor. An authorized human can describe work in ordinary language, answer clarifying questions, and leave Gist to coordinate the available Kilo and Linear Slack bots until the work completes, fails, or needs a human decision.

Slack is the orchestration bus. Gist does not call Linear, GitHub, Kilo Cloud, or their APIs directly in this scope. It sends Slack instructions to trusted bots, receives their Slack replies, remembers the complete thread, updates durable workflow state, and chooses the next bounded action.

## 2. Problem

Gist currently has channel memory, bounded context, observations, semantic recall, all-sender capture, and proactive human-message handling. It can remember Kilo/Linear output, but it cannot continue a task when those bots reply:

- bot/app messages are intentionally excluded from response generation;
- no durable work item correlates a human assignment with later bot messages;
- no trusted bot allowlist distinguishes workflow events from unrelated automation;
- no structured supervisor action maps model decisions to safe Slack dispatch;
- no restart, timeout, turn-limit, approval, or loop policy exists for long-running work.

The result is memory without supervision: a human must manually relay every next step.

## 3. Goals

1. Accept general work assignments from authorized humans in joined internal channels.
2. Use current thread and channel context to ask only for information that is materially missing.
3. Begin reversible, non-destructive bot work from a clear human assignment without requiring a redundant confirmation.
4. Coordinate trusted Kilo and Linear bots through Slack messages and threads.
5. Evaluate every authorized human message and every trusted automation-bot message; evaluation may produce `no_action`.
6. Maintain durable workflow state across process restart, Slack retries, delayed replies, and multiple turns.
7. Continue autonomously until completion, failure, cancellation, timeout, or a required human approval.
8. Support Kilo implementation followed by an independent fresh-session review request.
9. Keep exact Slack messages as source evidence and structured storage as authoritative workflow state.
10. Prevent bot loops, duplicate actions, cross-channel workflow leakage, unauthorized dispatch, and model-controlled destination IDs.

## 4. Non-goals

- Direct Linear, GitHub, Kilo Cloud, or MCP connectors.
- Running code, shell commands, git operations, or repository writes inside Gist.
- Replacing Kilo's own skills, subagents, or execution planning.
- Replacing Linear's own authorization or project behavior.
- Automatically merging PRs, releasing software, deleting resources, or performing irreversible actions without explicit human approval.
- Treating every bot/app in a channel as trusted automation.
- Inferring bot identity from display name, message text, or model output.
- Guaranteeing Slack-only orchestration if Kilo or Linear rejects bot-authored messages.

## 5. Actors and trust boundaries

### 5.1 Authorized human

A full internal member accepted by the existing Gist authorization policy. Only an authorized human may create, materially redirect, approve a gated action, cancel, or reopen a workflow.

### 5.2 Gist

The supervisor and only workflow-state writer. Gist may converse, dispatch to trusted bots, interpret replies, wait, ask for approval, complete, fail, or cancel. Gist never treats its own Slack echo as an input event.

### 5.3 Kilo

A trusted automation identity configured by exact Slack bot/app IDs. Kilo performs coding, skills, subagent work, tests, PR creation, and review when instructed. Kilo replies are untrusted task evidence, not authority to widen scope or approve destructive actions.

### 5.4 Linear

A trusted automation identity configured by exact Slack bot/app IDs. Linear performs issue/project operations when instructed. Linear replies are evidence of outcome, not authority to alter workflow policy.

### 5.5 Other bots/apps

Captured and available as channel context. They do not trigger supervisor execution unless a later accepted decision adds their exact IDs to the trusted automation allowlist.

## 6. Core model

### 6.1 Every eligible event is evaluated, not necessarily answered

```text
Slack event
→ exact-message persistence
→ sender and boundary classification
→ trusted event routing
→ workflow correlation
→ supervisor decision
→ zero or one bounded action
```

- Authorized human messages are eligible for supervisor evaluation.
- Trusted Kilo/Linear messages are eligible for supervisor evaluation.
- Gist/self messages are persisted but never evaluated.
- Unknown bot/app/system messages are persisted but do not trigger evaluation.
- `no_action` is a valid and expected decision.

### 6.2 Workflow state is authoritative

Channel memory explains what was said. Structured workflow storage determines what is active, who owns it, which bot is expected, what action is pending, and whether an approval exists. A summary or observation cannot advance workflow state.

### 6.3 One workflow, one Slack thread

A workflow binds to one workspace, channel, Slack thread, requesting human, and workflow ID. Trusted bot replies may advance it only when the event matches that binding and the expected bot/action state.

## 7. Functional requirements

### 7.1 Intake and clarification

- **GS-FR-001:** Every authorized human message in an enrolled internal channel is persisted before supervisor evaluation.
- **GS-FR-002:** Addressed Gist messages and human messages in an active workflow thread always reach supervisor evaluation; they do not depend on proactive relevance classification or cooldown.
- **GS-FR-003:** Unaddressed human messages outside active workflows may produce `no_action`, ordinary assistance, or a new work-intent candidate.
- **GS-FR-004:** Gist uses current thread, recent channel history, summary, observations, and scoped semantic recall to understand the assignment.
- **GS-FR-005:** Gist asks only for details required to dispatch safely: target bot/work type, objective, scope, acceptance, repository/project when not inferable, and approval for gated actions.
- **GS-FR-006:** A clear authorized human assignment is sufficient to start reversible, non-destructive Kilo/Linear work. Gist must not ask for redundant confirmation.
- **GS-FR-007:** Ambiguous destination, conflicting requirements, missing required target, destructive work, merge, release, cancellation of another user's work, or scope expansion requires a human decision.

### 7.2 Trusted bot compatibility and identity

- **GS-FR-008:** Kilo and Linear identity uses exact configured Slack bot/app IDs. Display names and message text are never identity evidence.
- **GS-FR-009:** Before implementation proceeds, a live compatibility spike proves each bot accepts Gist-authored Slack instructions and returns correlatable replies.
- **GS-FR-010:** Failure of either compatibility proof blocks that bot's workflow path; there is no silent direct-connector fallback.
- **GS-FR-011:** Unknown automation messages remain capture-only.

### 7.3 Durable workflow registry

- **GS-FR-012:** Each workflow has a collision-resistant ID and durable record containing owner, workspace/channel/thread binding, objective reference, expected bot, state, pending action, approval state, turn count, timestamps, retry metadata, and outcome references.
- **GS-FR-013:** Workflow states are explicit: `draft`, `clarifying`, `ready`, `dispatched`, `running`, `waiting_human`, `waiting_bot`, `reviewing`, `changes_requested`, `completed`, `failed`, `cancelled`, `timed_out`.
- **GS-FR-014:** State transitions are compare-and-set/idempotent. Duplicate or older Slack events cannot repeat an action.
- **GS-FR-015:** Restart restores active workflows and pending timeout checks without replaying completed Slack actions.
- **GS-FR-016:** One requesting human owns a workflow; other authorized humans may discuss it but cannot approve/cancel/materially redirect it unless policy records an ownership transfer.

### 7.4 Event routing and correlation

- **GS-FR-017:** Trusted bot messages are persisted first, then evaluated through a dedicated automation path that does not use the human response authorizer.
- **GS-FR-018:** A trusted bot event advances a workflow only when workspace, channel, thread, expected bot identity, and current state match.
- **GS-FR-019:** A trusted bot event without a valid workflow match may be evaluated for notification but cannot create or mutate a workflow.
- **GS-FR-020:** Gist/self echoes, retries, duplicate bot statuses, and replayed completion messages produce no second action.
- **GS-FR-021:** Workflow events use per-workflow serialization. Channel proactive cooldown must never drop or delay a valid workflow continuation.

### 7.5 Structured supervisor decisions

- **GS-FR-022:** Supervisor output is schema-validated and limited to: `no_action`, `reply_user`, `ask_user`, `dispatch_bot`, `follow_up_bot`, `request_approval`, `wait`, `complete`, `fail`, `cancel`.
- **GS-FR-023:** The model selects a logical target (`kilo` or `linear`), never a Slack ID. Runtime maps logical target to configured IDs after policy checks.
- **GS-FR-024:** One event may produce at most one externally visible action before its durable checkpoint commits.
- **GS-FR-025:** Generated bot instructions include objective, bounded scope, acceptance criteria, relevant context, workflow marker, expected response, and prohibitions without exposing hidden prompts, credentials, or unrelated channel history.
- **GS-FR-026:** Instructions and bot replies are treated as untrusted content. Neither can override system policy, destination allowlists, approval gates, or workflow ownership.

### 7.6 Kilo lifecycle

- **GS-FR-027:** Gist may ask Kilo to implement, investigate, test, fix, or review work requested by an authorized human.
- **GS-FR-028:** Gist interprets Kilo progress, blocker, failure, completion, and PR-result replies and chooses a bounded next action.
- **GS-FR-029:** When implementation produces a PR and review is requested or policy-required, Gist dispatches a fresh review instruction rather than treating the implementation result as independent review.
- **GS-FR-030:** Review findings route back to implementation for fixes; completion requires the configured acceptance/review condition, not merely a PR URL.

### 7.7 Linear lifecycle

- **GS-FR-031:** Gist may ask Linear to find, create, update, comment on, or report work items requested by an authorized human.
- **GS-FR-032:** Gist correlates Linear confirmation/failure to the active workflow and updates the next step.
- **GS-FR-033:** Linear output cannot approve code merge, release, destructive work, or workflow ownership changes.

### 7.8 Human control and approvals

- **GS-FR-034:** A human can request status, pause, resume, correct, cancel, or provide missing details in the workflow thread.
- **GS-FR-035:** Merge, release, deletion, destructive operations, credential/security changes, and irreversible actions require explicit approval from the workflow owner or configured approver.
- **GS-FR-036:** Approval binds to one workflow, one pending action, and one action version. Scope changes invalidate prior approval.
- **GS-FR-037:** Gist reports concise progress at meaningful transitions, not every internal reasoning step or repeated bot status.

### 7.9 Resilience and loop prevention

- **GS-FR-038:** Each workflow has configurable maximum turns, maximum consecutive failures, inactivity timeout, and absolute lifetime.
- **GS-FR-039:** Reaching a limit moves the workflow to `waiting_human`, `failed`, or `timed_out`; it never silently continues indefinitely.
- **GS-FR-040:** Gist never evaluates its own messages. Trusted bots cannot create new workflows, approve gated actions, or redirect destination/scope.
- **GS-FR-041:** Multiple bot replies arriving concurrently for one workflow are serialized and rechecked against current state.
- **GS-FR-042:** Failed Slack dispatch is recorded without advancing to a state that assumes delivery.
- **GS-FR-043:** A successful dispatch retry converges to one durable action and one expected bot turn.

## 8. Non-functional requirements

- **GS-NFR-001 — Isolation:** No workflow state, context, bot output, or action crosses workspace/channel/thread boundaries.
- **GS-NFR-002 — Durability:** Accepted workflow state survives process restart and resumes without duplicate external actions.
- **GS-NFR-003 — Security:** Human authorization occurs before workflow creation or material action; bot identity and destination are runtime-controlled.
- **GS-NFR-004 — Privacy:** Logs/reports contain content-free IDs/aliases, states, counts, reason classes, and timings only. No Slack content, credentials, prompts, model output, or raw payloads.
- **GS-NFR-005 — Auditability:** Every transition and dispatch has workflow ID, prior/new state, event class, action class, outcome, and coarse time without content.
- **GS-NFR-006 — Availability:** Bot/model/storage failure fails closed and preserves exact message capture.
- **GS-NFR-007 — Bounded autonomy:** Limits and approval gates remain effective after restart and cannot be overridden by channel content.
- **GS-NFR-008 — Single process:** The current one-process Socket Mode/storage constraint remains in force.

## 9. Required structured records

### 9.1 Workflow

```text
workflow_id
contract_version
owner_user_id
workspace_id
channel_id
thread_id
objective_message_key
state
expected_actor
pending_action_id
pending_action_version
approval_state
turn_count
consecutive_failures
created_at
updated_at
last_activity_at
timeout_at
completed_at
outcome_class
```

### 9.2 Action checkpoint

```text
action_id
workflow_id
version
source_event_key
action_class
logical_target
delivery_state
slack_message_key
attempt_count
created_at
updated_at
```

Message text remains in exact channel memory; workflow records reference message identities rather than duplicating full conversation content.

## 10. Acceptance scenarios

1. Human gives a clear Kilo task; Gist dispatches without redundant approval and records one workflow.
2. Human gives an ambiguous task; Gist asks one focused clarification and resumes from the answer.
3. Kilo reports a blocker; Gist resolves from known context or asks the human, then follows up.
4. Kilo reports a PR; Gist requests a fresh review, routes findings for fixes, and completes only after acceptance.
5. Human asks Linear to create/update work; Gist delegates and confirms the bot result.
6. Kilo and Linear replies interleave in one thread; only the expected valid transition applies.
7. Duplicate/replayed bot reply causes zero duplicate dispatches.
8. Gist restarts while waiting for a bot and resumes without repeating the instruction.
9. Unknown bot, wrong thread, wrong channel, wrong workspace, and Gist echo cannot advance workflow state.
10. Unauthorized human cannot create, redirect, approve, or cancel a workflow.
11. Gated merge/destructive action waits for version-bound owner approval.
12. Turn/timeout limit stops an unhealthy bot loop and asks the human.
13. All exact bot messages remain in channel context while structured state stays authoritative.

## 11. Delivery phases

- **P08 — Slack Automation Contracts and Compatibility:** freeze contracts, prove Kilo/Linear bot-to-bot behavior, and complete threat/protocol review.
- **P09 — Durable Supervisor Runtime:** implement workflow storage, trusted event routing, Slack dispatch, supervisor decisions, integration, and resilience validation.
- **P10 — Bot-Steered Workflows:** implement human assignment, Kilo, and Linear policies; validate complete live supervision.

## 12. Release gate

Slack supervisor mode is GO only when:

- Kilo and Linear live compatibility both pass;
- every P08–P10 task is merged and marked completed;
- full typecheck/tests/build pass;
- restart, duplicate, timeout, authorization, destination, and loop tests pass;
- one live Kilo implementation/review workflow and one live Linear workflow complete with sanitized evidence;
- no Gist self-loop, unknown-bot action, duplicate dispatch, or cross-channel workflow transition occurs;
- P06/P07 live-gate exceptions are either closed or explicitly accepted for this release.

## 13. Contract mapping (P08)

Annotation added by T801. This section records where each requirement is frozen; it does not add, remove, or restate any requirement above.

The Slack-supervisor contract set lives in [`docs/architecture/slack-supervisor/`](docs/architecture/slack-supervisor/) at version 1.0.0, with synthetic fixtures and contract tests in `tests/contracts/slack-supervisor/`.

| Requirements | Frozen in | Covers |
|---|---|---|
| GS-FR-008, 011, 017, 019, 026, 040 | [`identity.md`](docs/architecture/slack-supervisor/identity.md) | Exact-ID actor resolution, trust precedence, and the human/trusted-bot/self/unknown routing matrix |
| GS-FR-001, 002, 003, 017–021, 032, 041 | [`events.md`](docs/architecture/slack-supervisor/events.md) | Supervisor event record, admission order, correlation to a workflow binding, per-workflow serialization, cooldown separation |
| GS-FR-012–016, 029, 030, 038, 039 | [`workflow-state.md`](docs/architecture/slack-supervisor/workflow-state.md) | Durable record, the thirteen states, the legal transition table, compare-and-set, restart, limits, transition audit |
| GS-FR-003, 005, 022–027, 031, 037 | [`actions.md`](docs/architecture/slack-supervisor/actions.md) | The ten-member action union, logical target → destination mapping, instruction envelope, untrusted-content rules |
| GS-FR-006, 007, 016, 033–036 | [`approvals.md`](docs/architecture/slack-supervisor/approvals.md) | Gated action classes, version-bound approvals, ownership and transfer, human control verbs |
| GS-FR-015, 020, 024, 042, 043 | [`dispatch.md`](docs/architecture/slack-supervisor/dispatch.md) | Action checkpoint, delivery state machine, one-event/one-action claim, restart reconciliation, failure taxonomy |
| GS-FR-009, 010 | [`compatibility.md`](docs/architecture/slack-supervisor/compatibility.md) | The exact content-free measurements T802 must obtain, and the correlation strategy and GO/NO-GO each outcome permits |
| GS-NFR-001–008 | [`invariants.md`](docs/architecture/slack-supervisor/invariants.md) | GS-INV-01…14: isolation, authority, action integrity, bounded autonomy, privacy |
| GS-FR-001…043, GS-NFR-001…008 (complete map) | [`requirements-map.md`](docs/architecture/slack-supervisor/requirements-map.md) | Every requirement → contract clause, integration rule, or named later task, exactly once |

GS-FR-009 and GS-FR-010 are the only requirements T801 defers: they require the live compatibility proof that is T802's work. `compatibility.md` freezes the measurement shape and the decision rules so that spike fills in evidence rather than inventing policy, and §5 of that file lists the seven clauses whose final wording depends on what it measures.

Reopen (§5.1) is a pending product-owner decision. Terminal records remain immutable, but the contract intentionally supports neither terminal reactivation nor creation of a linked replacement workflow. T901/T904 must not implement reopen until the product owner chooses semantics and the contract/state model is amended.
