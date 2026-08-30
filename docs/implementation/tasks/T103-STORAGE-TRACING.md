# T103 — Configure Mastra storage and tracing

- **Status:** Ready for Integration
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** pi-coder-3
- **Branch:** `task/T103-configure-mastra-storage-and-tracing`
- **Parallel group:** PG-01B
- **Depends on:** T101
- **Blocks:** T106, T201
- **Can run parallel with:** T102, T104, T105
- **Conflicts with:** T106, T204
- **Task log:** [`../logs/T103.md`](../logs/T103.md)
- **Write scope:**
  - `src/mastra/storage/**`
  - `src/mastra/index.ts`
  - `tests/storage/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Provide persistent Mastra storage and trace configuration with safe local and production behavior.

## Deliverables

- Storage factory using approved backend.
- Initial Mastra instance registration.
- Trace configuration and redaction policy.
- Restart/persistence tests.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T103-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T103` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement file-backed local storage using absolute URL handling.
2. Keep backend selection constrained to accepted decision.
3. Configure only required storage domains.
4. Ensure traces/logs follow retention and privacy policy.
5. Test initialization, reopen, and failure behavior.

## Verification

```bash
npm run typecheck
npm test -- tests/storage
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] State survives close/reopen.
- [x] Database path is not inside tracked data by default.
- [x] Trace errors expose no message/token values.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `396e6e4241f326da22a47787914a248f68c4a236`
- Handoff commit: `HEAD` (`docs(T103): hand off storage and tracing`)
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
