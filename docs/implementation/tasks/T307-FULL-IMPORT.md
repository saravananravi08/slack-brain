# T307 — Execute full historical import

- **Status:** Planned
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** Unassigned
- **Branch:** `task/T307-execute-full-historical-import`
- **Parallel group:** PG-03E
- **Depends on:** T306, Product/security approval
- **Blocks:** T504, T501
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T307.md`](../logs/T307.md)
- **Write scope:**
  - `docs/reports/full-import-summary.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Import the approved historical archive into production-target Mastra storage with backups, reconciliation, and rollback evidence.

## Deliverables

- Approved execution record.
- Sanitized total/success/skip/failure counts.
- Rerun/idempotency and retrieval smoke results.
- Backup and rollback references.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T307-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T307` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Confirm written approval and maintenance window.
2. Verify backups and source read-only mode.
3. Run dry-run and compare expected counts.
4. Run full import, settle embeddings, and archive private detailed report outside Git.
5. Rerun safe check and retrieval smoke benchmark.

## Verification

```bash
npm run test:migration
npm run benchmark:retrieval -- --dataset benchmarks/history
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Counts reconcile or differences are approved.
- [ ] No private Slack text enters Git/log summary.
- [ ] Backup and rollback are usable.
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
