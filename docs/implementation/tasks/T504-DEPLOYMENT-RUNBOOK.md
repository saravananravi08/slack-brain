# T504 — Write and rehearse deployment, backup, restore, rollback runbook

- **Status:** In Progress (runbook drafted and current; rehearsals blocked on T307/T406)
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** claude-planner-2
- **Branch:** `task/T504-write-and-rehearse-deployment-backup-restore-rollback-runbook`
- **Parallel group:** PG-05A
- **Depends on:** T106, T307, T406
- **Blocks:** T505, T506
- **Can run parallel with:** T501, T502, T503
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T504.md`](../logs/T504.md)
- **Write scope:**
  - `docs/runbooks/deployment.md`
  - `docs/runbooks/backup-restore.md`
  - `docs/runbooks/rollback.md`
  - `deploy/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Make beta/production operations repeatable, owned, monitored, and reversible.

## Deliverables

- Deployment/service configuration.
- Secret and persistent path checklist.
- Backup/restore and old-runtime rollback procedures.
- Rehearsal evidence without credentials/data.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T504-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T504` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Define build/start/health/shutdown and single-instance Socket Mode operation.
2. Document storage/trace backup and restore.
3. Prevent simultaneous old/new Slack runtimes.
4. Rehearse restore and rollback in non-production.
5. Record owners, monitoring, and escalation.

## Verification

```bash
npm run build
git diff --check
rg -n "xox[bap]-[A-Za-z0-9-]+" docs/runbooks deploy && exit 1 || true
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] New operator can deploy from runbook. *(Procedure, inventories, and health
      checks are complete; the operator still cannot finish a real cutover until
      the T307/T406 gates fill.)*
- [ ] Restore and rollback rehearsal succeeds. **Blocked** — needs a
      non-production environment plus T307/T406 evidence.
- [x] No secret or environment-specific private value is committed. Verified:
      `grep -rE "xox[bap]-…|sk-…" docs/runbooks deploy` clean; no real
      workspace, channel, host, or account name appears.
- [ ] Task log is current and contains no sensitive content.
- [ ] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Status note

Runbook content is complete and matches the tree at `276cf52` + this branch:
deployment, backup/restore, and rollback procedures; service and secret
inventories; the F-12 single-instance constraint required by the T502 sign-off
§3.1; and health checks that run without T406.

**Not complete, and not completable here:**

- **Restore and rollback rehearsals** (acceptance criterion 2) need a
  non-production environment and evidence from T307 (full import) and T406
  (live ingestion). Both are unmerged — T307 is blocked on B-03 (archive DB
  path), T406 on B-07 (operator message). The rehearsal sections and evidence
  templates are written and ready to fill.
- **The production start command** is verified to start and to fail closed, but
  its Socket Mode hold, reconnect, and SIGTERM behaviour still need T406.

This branch is therefore safe to merge as documentation, but it is **not**
cutover approval and does not satisfy criterion 2.

## Completion record

- Implementation commit: `820a393`
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
