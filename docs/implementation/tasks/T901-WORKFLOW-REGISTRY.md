# T901 — Implement durable workflow registry

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T901-implement-durable-workflow-registry`
- **Parallel group:** PG-09A
- **Depends on:** P08
- **Blocks:** T905
- **Can run parallel with:** T902, T903, T904
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/workflows/**`
  - `tests/orchestration/workflows/**`
- **Read-only references:** GIST_SLACK_SUPERVISOR_PRD.md, P08 contracts, existing FactoryStorage domains.
- **Task log:** [`../logs/T901.md`](../logs/T901.md)

## Objective

Implement one durable, versioned workflow/action registry with idempotent state transitions, ownership/approval checks, pending-action checkpoints, timeout metadata, and restart-safe queries.

## Deliverables

- FactoryStorage-compatible workflow domain.
- Validated workflow/action types and transition API.
- Compare-and-set/idempotency behavior.
- Restart, duplicate, stale-version, ownership, approval, timeout, and terminal-state tests.

## Required procedure

1. Confirm P08 is completed and contract version is frozen.
2. Use existing storage dependency; add no dependency.
3. Store references to exact messages, not duplicated conversation content.
4. Make illegal transitions and stale writes explicit failures/no-ops per contract.
5. Stay inside scope; integration owns runtime registration.
6. Verify and hand off with separate implementation/metadata commits.

## Implementation steps

1. Implement record validation and deterministic workflow/action IDs.
2. Implement create/read/list-active/transition/checkpoint/approval/timeout APIs.
3. Implement per-workflow atomic or CAS behavior supported by FactoryStorage.
4. Implement restart reopen tests and terminal-state immutability.
5. Ensure records/loggable errors contain no message content or credentials.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/workflows
npm test -- tests/channel-memory/registry
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Workflow and action records match frozen contracts.
- [ ] Duplicate create/transition/checkpoint converges.
- [ ] Stale version, wrong owner, wrong boundary, and terminal mutation fail closed.
- [ ] Restart restores active/pending records without replay.
- [ ] Version-bound approval invalidates on action change.
- [ ] No full message/prompt/bot reply is duplicated into workflow state.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
