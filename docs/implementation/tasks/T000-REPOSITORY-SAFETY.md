# T000 — Repository safety and secret hygiene

- **Status:** Planned
- **Phase:** [P00](../phases/P00-GOVERNANCE.md)
- **Owner:** Unassigned
- **Branch:** `task/T000-repository-safety-and-secret-hygiene`
- **Parallel group:** PG-00A
- **Depends on:** —
- **Blocks:** T101
- **Can run parallel with:** T001, T002, T003
- **Conflicts with:** T508
- **Task log:** [`../logs/T000.md`](../logs/T000.md)
- **Write scope:**
  - `.gitignore`
  - `docs/security/repository-safety.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Make the repository safe for parallel development before dependencies, databases, or Slack credentials are introduced.

## Deliverables

- Remove `test_secrets.js` from the Git index without reading or committing its contents.
- Ignore database files, local Mastra state, generated artifacts, `.env`, and task worktrees.
- Create a repository safety checklist with secret/data scan commands and incident handling.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T000-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T000` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Inspect tracked/staged paths without printing secret values.
2. Unstage and remove accidental secret fixtures from commit scope.
3. Extend `.gitignore` narrowly for runtime databases, local artifacts, coverage, traces, and worktrees.
4. Run filename/content secret scans with redacted output.
5. Document safe handling and verify a clean intended index.

## Verification

```bash
git diff --check
git status --short
git ls-files | grep -E "(^|/)(\.env|.*\.db|test_secrets\.js)$" && exit 1 || true
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] No secret fixture remains staged/tracked.
- [ ] Runtime data patterns are ignored.
- [ ] Safety runbook exists and contains no credential values.
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
