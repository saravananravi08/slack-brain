# T605 — Enforce edit fidelity and delete-ignore policy

- **Status:** Completed
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** T605 worker
- **Branch:** `task/T605-enforce-edit-fidelity`
- **Parallel group:** PG-06B
- **Depends on:** T601
- **Blocks:** T606, T702
- **Can run parallel with:** T602, T603, T604
- **Conflicts with:** None under declared scope
- **Task log:** [`../logs/T605.md`](../logs/T605.md)
- **Write scope:**
  - `src/ingestion/mutations/**`
  - `tests/ingestion/mutations/**`
- **Read-only references:** T601 mutation contract; existing mutation storage.

## Objective

Make Slack edits replace canonical text and vectors idempotently while live Slack delete events deliberately leave stored state unchanged.

## Deliverables

- Edit-in-place behavior for every sender class.
- Stale-vector replacement and edit metadata.
- Explicit no-op live-delete behavior without removing retention primitives.
- Mutation replay and failure-recovery tests.

## Required procedure

Follow repository task workflow; use isolated worktree, declared scope, task log, explicit commits, and all verification checks.

## Implementation steps

1. Resolve edits by original Slack message identity.
2. Preserve immutable sender/channel/thread/sent metadata.
3. Replace text/vector and record edit time atomically or recoverably.
4. Keep duplicate edits idempotent.
5. Distinguish ignored live deletes from operator retention/purge operations.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/mutations
git diff --check
```

## Acceptance criteria

- [x] Edit creates no second message.
- [x] Old text and old vector stop matching after edit.
- [x] Replayed edits are no-op successes.
- [x] Live delete changes no message/vector/derived state.
- [x] Retention and operator purge primitives remain available.

## Blocker resolution

Resolved by accepted D018 at integration commit `34bd987`: orphan edits are ignored, enrollment is injected through a read-only probe, derived invalidation is synchronous and content-free, and omitted file/link replacements preserve existing metadata.

## Completion record

- Implementation commit: `a4587fd9fcab5c4789a5aad48552a73e852d3b99`
- Handoff commit: this commit (`docs(T605): hand off edit fidelity policy`)
- Merge commit: `9cc1326`
- Integration metadata commit: docs(P06) complete T605 metadata commit
- Completed at: 2026-08-31
