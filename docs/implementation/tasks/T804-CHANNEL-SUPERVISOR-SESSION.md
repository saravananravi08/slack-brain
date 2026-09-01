# T804 — Implement durable channel supervisor session

- **Status:** In Progress
- **Phase:** [P08](../phases/P08-SLACK-AUTOMATION-CONTRACTS.md)
- **Owner:** pi-t804-channel-supervisor
- **Branch:** `task/T804-channel-supervisor-session`
- **Parallel group:** PG-08S
- **Depends on:** T609d runtime baseline; T801 identity/access invariants
- **Blocks:** resuming T802 by product-owner priority; child cloud-agent workflow integration
- **Can run parallel with:** None on the live Gist runtime
- **Conflicts with:** `src/config.ts`, `src/mastra/index.ts`, `src/mastra/channels/**`, channel runtime tests, live Gist process
- **Write scope:**
  - `src/config.ts`, `.env.example`
  - `src/mastra/index.ts`
  - `src/mastra/channels/**`
  - smallest required existing storage/migration files
  - focused channel-supervisor tests/fixtures
  - this task and its log
- **Read-only references:** current channel memory, retrieval, security boundaries, durable dedupe, T801 workflow contracts.
- **Task log:** [`../logs/T804.md`](../logs/T804.md)

## Objective

Give each approved Slack channel one durable supervisor context that decides whether an addressed request is new, already answered, a continuation, a status query, or an explicit Kilo delegation before normal generation. The first usable slice must dispatch one authorized Kilo child workflow through the requesting user's Slack token, bind Kilo's replies durably, stop duplicate cross-thread answers, and return deterministic status without one long-lived model conversation.

## Deliverables

- Persistent channel-scoped supervisor ledger surviving process restart.
- Successful-answer records containing only the minimum question fingerprint/embedding, evidence version, requester/access boundary, response/thread reference, status, and timestamps.
- Pre-generation routing for `new`, `already_answered`, `continuation`, and `status`.
- Equivalent recent requests with unchanged evidence link to the prior answer instead of regenerating.
- Status requests read deterministic ledger state; they do not ask the model to invent progress.
- Atomic claim prevents concurrent duplicate full answers or Kilo dispatches.
- Explicit `ask Kilo` command path verifies `SLACK_USER_TOKEN` belongs to the requesting Slack user, then posts one deterministic user-authored Kilo mention to the same approved channel.
- Durable Kilo workflow/thread binding accepts replies only from the exact configured Kilo bot/app identity and updates status before Gist notifies the requester.
- Human messages addressed only to Kilo never trigger Gist's proactive responder.
- Existing Slack answer behavior remains the fallback when no safe match or explicit command exists.

## Required behavior

1. Scope every lookup to the authorized workspace/channel and requester-visible boundary.
2. Treat a reply in the original thread as continuation, never as cross-thread duplication.
3. Exact normalized matches are deterministic. Semantic matching may use the existing embedding path, but must fail open to a normal answer when confidence or storage is unavailable.
4. Reuse only when the prior response still exists and its evidence fingerprint is unchanged; otherwise produce an updated answer.
5. Return a Slack thread link/reference, never duplicate stored answer prose.
6. Persist answer lifecycle states sufficient for `queued`, `answering`, `answered`, and `failed`, plus one bounded Kilo child workflow lifecycle: `queued`, `dispatched`, `running`, `completed`, `failed`, `waiting_human`.
7. Recognize only an explicit authorized `ask Kilo` command. Resolve the destination and exact Kilo identity from runtime/config, never model output.
8. Before dispatch, call Slack `auth.test` with `SLACK_USER_TOKEN` and require its user identity to equal the requesting Slack sender. A mismatch or missing token denies dispatch.
9. Post exactly one user-token-authored Kilo instruction, durably bind its Slack thread, and correlate only exact configured Kilo bot/app replies in that thread.
10. A repeated command reuses the existing workflow/status; it never creates duplicate Kilo work.
11. Proactive mode ignores a human message addressed to Kilo unless it also explicitly addresses Gist.
12. Never cross channel, workspace, enrollment, requester, or authorization boundaries.
13. Keep current one-process Socket Mode ownership and existing event dedupe intact.

## Out of scope

- Linear or other cloud-agent dispatch.
- Dispatch on behalf of any user other than the authenticated `SLACK_USER_TOKEN` owner.
- Model-selected destinations, identities, or hidden commands.
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

- [ ] Explicit authorized `ask Kilo` invokes generation zero times and posts exactly one user-token-authored instruction in the same approved channel.
- [ ] Missing/mismatched user token, unapproved channel, unauthorized requester, or absent exact Kilo identity denies dispatch.
- [ ] Exact Kilo reply in the bound thread advances persisted workflow status and produces one Gist update; unrelated bot/thread replies do nothing.
- [ ] Human messages addressed only to Kilo produce zero Gist proactive replies.
- [ ] Repeated Kilo command returns existing workflow status and creates no second dispatch.
- [ ] Same addressed question in a new thread returns a prior-answer reference and invokes generation zero times.
- [ ] Continuation in the original thread reaches normal generation; changed/stale evidence produces a fresh answer.
- [ ] Status query returns persisted deterministic answer/workflow state after restart.
- [ ] Concurrent duplicates produce one full answer or dispatch.
- [ ] Cross-boundary and unauthorized records are never disclosed; lookup/storage failure remains fail-safe.
- [ ] Full regression suite, typecheck, build, scope, and credential scans pass.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
