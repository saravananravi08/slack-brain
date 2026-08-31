# T903 — Implement structured Slack bot dispatch

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T903-implement-structured-slack-bot-dispatch`
- **Parallel group:** PG-09A
- **Depends on:** P08
- **Blocks:** T905
- **Can run parallel with:** T901, T902, T904
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/dispatch/**`
  - `tests/orchestration/dispatch/**`
- **Read-only references:** P08 action/dispatch contracts, current Slack adapter/outgoing persistence.
- **Task log:** [`../logs/T903.md`](../logs/T903.md)

## Objective

Implement a Slack dispatch port/executor that accepts only schema-valid logical targets and checkpointed actions, maps targets to configured exact IDs, emits a correlatable instruction in the bound thread, and reports delivery without advancing workflow state itself.

## Deliverables

- Logical target and dispatch request/result types.
- Runtime-controlled Kilo/Linear destination mapping.
- Safe workflow marker/instruction rendering.
- Fake Slack port tests for success, retry, duplicate, failure, wrong target, and missing config.

## Required procedure

1. Keep Slack SDK/runtime composition outside this task; depend on an injected port.
2. Reject raw destination IDs from model/action payloads.
3. Require bound workspace/channel/thread and durable action ID/version.
4. Do not log instruction text or Slack IDs.
5. A failed/unknown delivery must not claim success.
6. Verify and hand off.

## Implementation steps

1. Implement strict dispatch schema and logical target mapping.
2. Render contract-compatible bot mention/workflow marker/message.
3. Implement injected post port with deterministic idempotency input.
4. Return content-free delivery result and canonical message reference.
5. Add table-driven tests for all failure/duplicate paths.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/dispatch
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Model cannot supply or override Slack destination IDs.
- [ ] Missing/unconfigured logical target fails closed.
- [ ] Dispatch stays in workflow's bound channel/thread.
- [ ] Retry input converges to one action identity.
- [ ] Result distinguishes delivered, duplicate, retryable failure, and terminal failure.
- [ ] Logs/results expose no instruction content or credentials.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
