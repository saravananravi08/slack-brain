# T104 — Implement Mastra Slack channel adapter

- **Status:** Ready for Integration
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** claude-planner
- **Branch:** `task/T104-implement-mastra-slack-channel-adapter`
- **Parallel group:** PG-01B
- **Depends on:** T101, T003, T004
- **Blocks:** T106, T203, T401
- **Can run parallel with:** T102, T103, T105
- **Conflicts with:** T405
- **Task log:** [`../logs/T104.md`](../logs/T104.md)
- **Worktree:** `../worktrees/T104`
- **Open verification gap:** **B-01** — live Socket Mode smoke check is not run; operator Slack credentials are not yet available. Adapter construction, mode selection, routing, and error mapping are covered offline. A real connect/reconnect check must run before T106 closes.
- **Write scope:**
  - `src/mastra/channels/**`
  - `tests/channels/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Configure the official Slack adapter in Socket Mode with correct routing, formatting, deduplication hooks, and test seams.

## Deliverables

- Slack adapter factory.
- DM/mention/subscribed-thread handler boundaries.
- Socket Mode and message fixture tests.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T104-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T104` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Use `createSlackAdapter` and approved credentials/config.
2. Configure streaming/typing and safe user-facing errors.
3. Expose handlers without implementing memory or live ingestion.
4. Add adapter mocks/fixtures for events and retries.
5. Verify no Slack Bolt import or webhook-only assumption.

## Verification

```bash
npm run typecheck
npm test -- tests/channels
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Adapter initializes with test config.
- [x] DM and mention fixtures route once.
- [x] No production Slack call occurs in unit tests.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `5c9884a`
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
