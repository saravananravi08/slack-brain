# T203 — Implement Slack authorization and privacy guard

- **Status:** Completed
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** claude-planner-2
- **Branch:** `task/T203-implement-slack-authorization-and-privacy-guard`
- **Parallel group:** PG-02A
- **Depends on:** T004, T102, T104
- **Blocks:** T204, T404, T502
- **Can run parallel with:** T201, T202, T205
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T203.md`](../logs/T203.md)
- **Write scope:**
  - `src/security/**`
  - `tests/security/access/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Enforce approved workspace/channel/user and Slack Connect policy before retrieval, storage, or generation.

## Deliverables

- Authorization policy module.
- Explicit deny reasons safe for logs/users.
- Tests for approved, unapproved, external, DM, and malformed identities.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T203-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T203` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Translate D001/D002/D006 into deny-by-default checks.
2. Run authorization before memory access.
3. Separate DM conversation permission from shared knowledge permission.
4. Avoid logging message bodies/tokens.
5. Add table-driven boundary tests.

## Verification

```bash
npm run typecheck
npm test -- tests/security/access
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Unauthorized events cannot read/write memory or invoke model.
- [x] Slack Connect denied by default.
- [x] Every boundary has positive and negative tests.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `4abb5fa`
- Handoff commit: —
- Merge commit: 49751a4
- Integration metadata commit: —
- Completed at: 2026-08-30
