# T804 — Implement durable channel supervisor session

- **Status:** In Progress
- **Phase:** [P08](../phases/P08-SLACK-AUTOMATION-CONTRACTS.md)
- **Owner:** pi-t804-channel-supervisor
- **Branch:** `task/T804-channel-supervisor-session`
- **Parallel group:** PG-08S
- **Depends on:** T609d runtime baseline; T801 identity/access invariants
- **Blocks:** resuming T802 by product-owner priority; child cloud-agent workflow integration
- **Can run parallel with:** None on the live Gist runtime
- **Conflicts with:** `src/mastra/channels/**`, channel runtime tests, live Gist process
- **Write scope:**
  - `src/mastra/channels/**`
  - smallest required existing storage/migration files
  - focused channel-supervisor tests/fixtures
  - this task and its log
- **Read-only references:** current channel memory, retrieval, security boundaries, durable dedupe, T801 workflow contracts.
- **Task log:** [`../logs/T804.md`](../logs/T804.md)

## Objective

Give each approved Slack channel one durable supervisor context that decides whether an addressed request is new, already answered, a continuation, or a status query before generation. The first usable slice must stop duplicate cross-thread answers and return durable status without depending on one long-lived model conversation.

## Deliverables

- Persistent channel-scoped supervisor ledger surviving process restart.
- Successful-answer records containing only the minimum question fingerprint/embedding, evidence version, requester/access boundary, response/thread reference, status, and timestamps.
- Pre-generation routing for `new`, `already_answered`, `continuation`, and `status`.
- Equivalent recent requests with unchanged evidence link to the prior answer instead of regenerating.
- Status requests read deterministic ledger state; they do not ask the model to invent progress.
- Atomic claim prevents concurrent duplicate full answers.
- Existing Slack answer behavior remains the fallback when no safe match exists.

## Required behavior

1. Scope every lookup to the authorized workspace/channel and requester-visible boundary.
2. Treat a reply in the original thread as continuation, never as cross-thread duplication.
3. Exact normalized matches are deterministic. Semantic matching may use the existing embedding path, but must fail open to a normal answer when confidence or storage is unavailable.
4. Reuse only when the prior response still exists and its evidence fingerprint is unchanged; otherwise produce an updated answer.
5. Return a Slack thread link/reference, never duplicate stored answer prose.
6. Persist lifecycle states sufficient for `queued`, `answering`, `answered`, and `failed`; later cloud-agent tasks will extend this ledger rather than create an immortal chat session.
7. Never cross channel, workspace, enrollment, or authorization boundaries.
8. Keep current one-process Socket Mode ownership and existing event dedupe intact.

## Out of scope

- Kilo/Linear dispatch adapters.
- User-token impersonation.
- Replacing thread-local conversational memory.
- A single unbounded LLM context for the whole channel.
- General workflow framework or connector abstraction.

## Verification

```bash
npm run typecheck
npm test -- <focused channel-supervisor tests>
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Same addressed question in a new thread returns a prior-answer reference and invokes generation zero times.
- [ ] Semantically equivalent wording is detected without matching unrelated questions.
- [ ] Continuation in the original thread reaches normal generation.
- [ ] Changed/stale/deleted evidence produces a fresh answer.
- [ ] Status query returns persisted deterministic state after restart.
- [ ] Concurrent duplicates produce one full answer.
- [ ] Cross-boundary and unauthorized records are never disclosed.
- [ ] Lookup/storage failure preserves current answer behavior.
- [ ] Full regression suite, typecheck, build, scope, and credential scans pass.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
