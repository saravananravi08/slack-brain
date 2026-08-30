# T304 — Implement idempotent Mastra memory writer

- **Status:** In Progress
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** pi-coder-10
- **Branch:** `task/T304-implement-idempotent-mastra-memory-writer`
- **Parallel group:** PG-03B
- **Depends on:** T201, T301
- **Blocks:** T305
- **Can run parallel with:** T302, T303
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T304.md`](../logs/T304.md)
- **Write scope:**
  - `src/migration/writer/**`
  - `tests/migration/writer/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Persist normalized import records and embeddings into Mastra-owned storage idempotently.

## Deliverables

- Batch writer with retry boundaries.
- Duplicate-safe upsert/checkpoint behavior.
- Sanitized success/failure counters.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T304-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T304` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Use supported Mastra Memory/storage APIs.
2. Write in bounded batches and settle embedding work before exit.
3. Make reruns safe after partial failure.
4. Never include message bodies in normal logs.
5. Test partial failure and rerun.

## Verification

```bash
npm run typecheck
npm test -- tests/migration/writer
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Second write does not duplicate messages/embeddings.
- [ ] Partial failure resumes safely.
- [ ] Counters reconcile accepted/rejected records.
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
