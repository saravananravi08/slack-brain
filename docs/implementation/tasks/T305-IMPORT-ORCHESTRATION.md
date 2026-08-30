# T305 — Integrate archive importer and reporting

- **Status:** Planned
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** Unassigned
- **Branch:** `task/T305-integrate-archive-importer-and-reporting`
- **Parallel group:** PG-03C
- **Depends on:** T302, T303, T304
- **Blocks:** T306
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T305.md`](../logs/T305.md)
- **Write scope:**
  - `src/migration/index.ts`
  - `scripts/import-slack.ts`
  - `tests/migration/orchestration/**`
  - `docs/runbooks/archive-import.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Compose reader, mapper, and writer into a safe dry-run/sample/full import command.

## Deliverables

- Import CLI with dry-run, sample limit, checkpoint/resume, and report options.
- Operational runbook and confirmation guards.
- End-to-end synthetic import tests.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T305-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T305` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Validate source/destination paths and refuse same file.
2. Default to dry-run; require explicit full-import flag.
3. Compose components without bypassing contracts.
4. Write sanitized machine-readable summary outside Git by default.
5. Document backup, stop, resume, and rollback.

## Verification

```bash
npm run typecheck
npm test -- tests/migration/orchestration
npm run test:migration
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Dry-run performs no writes.
- [ ] Sample/full modes are explicit.
- [ ] Synthetic rerun is idempotent.
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
