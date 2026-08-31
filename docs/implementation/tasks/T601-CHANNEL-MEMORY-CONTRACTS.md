# T601 — Freeze channel-memory contracts

- **Status:** Completed
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** claude-opus5
- **Branch:** `task/T601-freeze-channel-memory-contracts`
- **Parallel group:** PG-06A
- **Depends on:** T406, D013–D015 accepted
- **Blocks:** T602, T603, T604, T605
- **Can run parallel with:** —
- **Conflicts with:** Any task changing channel-memory contracts
- **Task log:** [`../logs/T601.md`](../logs/T601.md)
- **Write scope:**
  - `GIST_CHANNEL_MEMORY_PRD.md`
  - `docs/architecture/channel-memory/**`
  - `tests/contracts/channel-memory/**`
- **Read-only references:** Existing Slack, identity, authorization, storage, and retrieval contracts; P06.

## Objective

Freeze versioned contracts for joined-channel enrollment, all-sender capture, capture/response separation, edit fidelity, and delete-ignore behavior.

## Deliverables

- Channel enrollment, event, storage, mutation, and capture-policy contracts.
- Synthetic fixtures for human, Gist, Kilo, bot/app, root, reply, retry, edit, delete-ignore, join, leave, and two-channel isolation.
- Contract tests pinning version and invariants.

## Required procedure

1. Confirm dependencies are merged and task is assigned.
2. Work in an isolated branch/worktree.
3. Edit only declared scope and maintain `logs/T601.md`.
4. Resolve no product ambiguity silently; log blockers.
5. Run verification, scope check, and `git diff --check`.
6. Commit implementation and handoff with T601 in subjects.

## Implementation steps

1. Define membership-authoritative channel enrollment and retention-after-leave semantics.
2. Separate capture eligibility from response eligibility.
3. Define canonical sender/message metadata for every sender class.
4. Define edit replacement and accepted delete-ignore behavior.
5. Pin channel isolation and idempotency invariants with fixtures.

## Verification

```bash
npm run typecheck
npm test -- tests/contracts/channel-memory
git diff --check
```

## Acceptance criteria

- [x] Every CM-FR-001…019 requirement maps to a contract or explicit integration rule.
- [x] Fixtures cover two channels and every sender/mutation class.
- [x] Bot/app capture cannot imply response authorization.
- [x] Delete-ignore risk is explicit and tested.
- [x] No real Slack IDs or content are committed.

## Completion record

- Implementation commit: `991fc4aaf03ca10700c85cf3a72243fb213c9ff0`
- Handoff commit: `38fcec0`
- Merge commit: `d8206d1`
- Integration metadata commit: docs(P06) complete T601 metadata commit
- Completed at: 2026-08-31
