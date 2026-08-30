# T004 — Define architecture and data contracts

- **Status:** Planned
- **Phase:** [P00](../phases/P00-GOVERNANCE.md)
- **Owner:** Unassigned
- **Branch:** `task/T004-define-architecture-and-data-contracts`
- **Parallel group:** PG-00B
- **Depends on:** T001
- **Blocks:** T104, T105, T202, T203, T301, T401
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T004.md`](../logs/T004.md)
- **Write scope:**
  - `docs/architecture/gist-mastra-architecture.md`
  - `docs/architecture/contracts/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Freeze interfaces and boundaries needed for independent implementation without shared-file design conflicts.

## Deliverables

- Runtime component diagram.
- Normalized Slack event/message contract.
- Resource/thread ID contract.
- Storage, authorization, retrieval, and error contracts.
- Versioned contract fixtures for downstream tests.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T004-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T004` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Translate accepted decisions into invariants.
2. Define IDs, metadata, timestamps, edit/delete semantics, and DM/channel boundaries.
3. Define component imports/exports without implementation.
4. Define where generation is forbidden during silent ingestion.
5. Review contracts with owners of P01–P04 tasks and version them.

## Verification

```bash
git diff --check
find docs/architecture/contracts -type f -maxdepth 2 -print
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] All downstream task inputs/outputs are explicit.
- [ ] No contract permits cross-boundary data access.
- [ ] Contract changes require coordinator approval after merge.
- [ ] Task log is current and contains no sensitive content.
- [ ] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
