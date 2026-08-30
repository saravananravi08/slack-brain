# T106 — Integrate foundation runtime

- **Status:** In Progress
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** pi-coder-4
- **Branch:** `task/T106-integrate-foundation-runtime`
- **Parallel group:** PG-01C
- **Depends on:** T102, T103, T104, T105
- **Blocks:** T202, T204
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** T103, T104, T105, T204
- **Task log:** [`../logs/T106.md`](../logs/T106.md)
- **Write scope:**
  - `src/mastra/index.ts`
  - `src/index.ts`
  - `tests/integration/foundation/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Compose validated config, storage, tracing, Slack adapter, and Gist agent into one runnable service.

## Deliverables

- Single runtime entry point.
- Mastra registration and graceful shutdown.
- Foundation integration tests and Slack smoke-test checklist.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T106-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T106` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Integrate component exports without duplicating logic.
2. Initialize in safe order: config, storage, Mastra, channel.
3. Handle SIGINT/SIGTERM and storage settling.
4. Run mocked integration tests.
5. Run sanitized live Slack DM/mention/thread/reconnect smoke tests.

## Verification

```bash
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

- [ ] One process starts and stops cleanly.
- [ ] Live test produces one threaded reply.
- [ ] No Claude CLI/Bolt request path executes.
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
