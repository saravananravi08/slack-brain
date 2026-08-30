# T405 — Integrate live silent ingestion

- **Status:** Ready for Integration
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** pi-coder-12
- **Branch:** `task/T405-integrate-live-silent-ingestion`
- **Parallel group:** PG-04C
- **Depends on:** T402, T403, T404, T204
- **Blocks:** T406
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** T104, T204
- **Task log:** [`../logs/T405.md`](../logs/T405.md)
- **Write scope:**
  - `src/mastra/channels/slack.ts`
  - `src/mastra/index.ts`
  - `src/ingestion/index.ts`
  - `tests/integration/live-ingestion/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Wire ambient event normalization, authorization, persistence, and mutation handling into the Slack runtime.

## Deliverables

- Integrated supported event hook.
- Separation between ambient ingestion and Gist response path.
- Integration tests with generation/post spies.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T405-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T405` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Compose components at T401 interception point.
2. Run authorization before persistence.
3. Route mention/DM to Gist and ambient events to silent ingestion.
4. Handle errors without failed acknowledgements or content logs where possible.
5. Test concurrent/retry ordering.

## Verification

```bash
npm run typecheck
npm test -- tests/integration/live-ingestion
npm test
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Ambient messages persist and receive no reply.
- [x] Mentions still produce exactly one reply.
- [x] Retries/mutations remain idempotent.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `b9c52516aacac0a6f94825cbeecf8bdddf9be91e`
- Handoff commit: This task/log metadata commit (exact hash in branch history and handoff report).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
