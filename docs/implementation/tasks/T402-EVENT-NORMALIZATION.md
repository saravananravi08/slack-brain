# T402 — Normalize and deduplicate live Slack events

- **Status:** Ready for Integration
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** claude-planner-2
- **Branch:** `task/T402-normalize-and-deduplicate-live-slack-events`
- **Parallel group:** PG-04B
- **Depends on:** T401
- **Blocks:** T405
- **Can run parallel with:** T403, T404
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T402.md`](../logs/T402.md)
- **Write scope:**
  - `src/ingestion/events/**`
  - `tests/ingestion/events/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Convert supported Slack events into the normalized contract and reject duplicates/bots/system/unapproved shapes before persistence.

## Deliverables

- Pure event normalizer.
- Deduplication key and classification logic.
- Fixtures/tests for root, reply, retry, bot, system, malformed events.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T402-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T402` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement T401/T004 contracts only.
2. Preserve event/message/thread/sender/timestamp metadata.
3. Classify mutation events for T404.
4. Return explicit ignored reasons without content logging.
5. Test deterministic duplicate keys.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/events
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Retries normalize to same key.
- [x] Bot/system events are ignored.
- [x] No storage/model/Slack API side effects.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `af39f16`
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
