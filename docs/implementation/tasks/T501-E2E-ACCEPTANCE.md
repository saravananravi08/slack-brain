# T501 — Run complete PRD acceptance suite

- **Status:** Planned
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** Unassigned
- **Branch:** `task/T501-run-complete-prd-acceptance-suite`
- **Parallel group:** PG-05A
- **Depends on:** P03, P04
- **Blocks:** T505
- **Can run parallel with:** T502, T503, T504
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T501.md`](../logs/T501.md)
- **Write scope:**
  - `tests/e2e/acceptance/**`
  - `docs/reports/prd-acceptance.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Automate and execute AC-01 through AC-15 and produce a launch-gate report.

## Deliverables

- Acceptance tests mapped one-to-one to PRD scenarios.
- Sanitized pass/fail/evidence report.
- Approved exceptions with owner and expiry.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T501-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T501` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Map every AC ID to test/manual procedure.
2. Run fresh-install, restart, retry, thread, recall, unknown, privacy, and provider-failure cases.
3. Record environment/version/commit.
4. Do not mark flaky failure as pass.
5. Produce go/no-go recommendation.

## Verification

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Every AC has evidence.
- [ ] No unapproved failing required scenario.
- [ ] Report references exact tested commit.
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
