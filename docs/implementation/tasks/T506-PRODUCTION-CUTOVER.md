# T506 — Perform production cutover

- **Status:** Planned
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** Unassigned
- **Branch:** `task/T506-perform-production-cutover`
- **Parallel group:** PG-05C
- **Depends on:** T505, Product/technical/security approval
- **Blocks:** T508
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T506.md`](../logs/T506.md)
- **Write scope:**
  - `docs/releases/production-cutover.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Replace the legacy production runtime with Mastra Gist using a controlled, observable, reversible cutover.

## Deliverables

- Cutover checklist and timestamps.
- Old/new runtime stop/start evidence.
- Post-cutover smoke and monitoring result.
- Rollback decision checkpoint.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T506-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T506` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Verify current backups and approvals.
2. Stop old bot and cron before new runtime activation.
3. Start Mastra Gist with production secrets.
4. Run DM/mention/thread/recall/ambient smoke tests.
5. Monitor and invoke rollback immediately on defined trigger.

## Verification

```bash
npm run test:e2e -- --case production-smoke
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Exactly one production bot runtime active.
- [ ] Smoke tests pass.
- [ ] Rollback remains immediately executable.
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
