# T508 — Remove legacy runtime after rollback window

- **Status:** Blocked
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** pi coding agent (assessment only)
- **Branch:** `task/T508-remove-legacy-runtime-after-rollback-window`
- **Parallel group:** PG-05D
- **Depends on:** T506, Rollback-window approval
- **Blocks:** —
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** T000, T101
- **Task log:** [`../logs/T508.md`](../logs/T508.md)
- **Write scope:**
  - `agent.ts`
  - `bot.ts`
  - `clickup.ts`
  - `cron.ts`
  - `db.ts`
  - `files.ts`
  - `proactive.ts`
  - `search.ts`
  - `package.json`
  - `package-lock.json`
  - `.env.example`
  - `.gitignore`
  - `README.md`
  - `tests/legacy/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Delete replaced code/dependencies/config only after production stability and rollback approval.

## Deliverables

- Legacy files and dependencies removed.
- Manifest/lock/config/docs regenerated for Mastra-only runtime.
- Full regression and repository hygiene report.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T508-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T508` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Confirm rollback-window approval and retain archived backup outside active tree.
2. Delete only modules proven unused.
3. Remove Bolt, better-sqlite3, ClickUp, Claude CLI, old env vars/scripts.
4. Regenerate lockfile and update README/env example/gitignore.
5. Run full checks and search for stale imports/references.

## Verification

```bash
npm ci
npm run typecheck
npm test
npm run build
rg -n "@slack/bolt|better-sqlite3|clickup|askClaude|search\.ts" --glob "!docs/implementation/**" . && exit 1 || true
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Mastra-only runtime passes all checks.
- [ ] No active legacy import/script/config remains.
- [ ] Rollback archive remains available outside production tree.
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
