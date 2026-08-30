# T403 — Persist ambient messages silently

- **Status:** Planned
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** Unassigned
- **Branch:** `task/T403-persist-ambient-messages-silently`
- **Parallel group:** PG-04B
- **Depends on:** T201, T202, T401
- **Blocks:** T405
- **Can run parallel with:** T402, T404
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T403.md`](../logs/T403.md)
- **Write scope:**
  - `src/ingestion/persistence/**`
  - `tests/ingestion/persistence/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Store normalized approved channel messages into Mastra memory without model generation or Slack response.

## Deliverables

- Silent persistence service.
- Idempotent write/embedding behavior.
- Tests proving zero generation and correct resource/thread mapping.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T403-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T403` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Accept normalized contract, not raw Slack payload.
2. Authorize/mapping dependencies through explicit interfaces.
3. Persist bounded data and settle asynchronous embedding work safely.
4. Return counters/results without message content.
5. Test retries and failures.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/persistence
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] No model method is called.
- [ ] No Slack post method is called.
- [ ] Duplicate event creates no duplicate memory.
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
