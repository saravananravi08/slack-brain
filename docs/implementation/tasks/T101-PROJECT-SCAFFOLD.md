# T101 — Scaffold Mastra TypeScript project

- **Status:** Planned
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** Unassigned
- **Branch:** `task/T101-scaffold-mastra-typescript-project`
- **Parallel group:** PG-01A
- **Depends on:** P00
- **Blocks:** T102, T103, T104, T105
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** T508
- **Task log:** [`../logs/T101.md`](../logs/T101.md)
- **Write scope:**
  - `package.json`
  - `package-lock.json`
  - `tsconfig.json`
  - `src/** (empty entry scaffolding only)`
  - `tests/smoke/project.test.ts`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Create a clean, reproducible Mastra project baseline with pinned dependencies and standard scripts.

## Deliverables

- Pinned Mastra, memory, libSQL, Slack adapter, TypeScript, and test dependencies.
- TypeScript configuration and scripts for typecheck/test/build/dev/start.
- Minimal source/test layout that compiles without implementing later components.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T101-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T101` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Reconcile package manifest and lockfile with npm.
2. Install only dependencies required by approved architecture.
3. Create strict TypeScript config compatible with Mastra.
4. Create scripts expected by all phase files.
5. Add smoke test and document Node version.

## Verification

```bash
npm ci
npm run typecheck
npm test
npm run build
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Fresh clone installs reproducibly.
- [ ] No deprecated old runtime is invoked by new scripts.
- [ ] No later task implementation is preempted.
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
