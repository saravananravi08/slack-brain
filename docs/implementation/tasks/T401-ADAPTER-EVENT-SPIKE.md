# T401 — Spike supported ordinary Slack event handling

- **Status:** Completed
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** claude-planner-2
- **Branch:** `task/T401-spike-supported-ordinary-slack-event-handling`
- **Parallel group:** PG-04A
- **Depends on:** T104, T206
- **Blocks:** T402, T403, T404
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T401.md`](../logs/T401.md)
- **Write scope:**
  - `docs/spikes/slack-event-support.md`
  - `tests/spikes/slack-events/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Prove the pinned Mastra/Chat SDK path for receiving ordinary channel messages without invoking or replying through the agent.

## Deliverables

- Executable spike/fixture test.
- Supported API/lifecycle finding with source-doc/version links.
- Chosen handler contract or explicit blocker.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T401-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T401` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Inspect pinned adapter APIs and official docs.
2. Test mention, ambient root, reply, edit, delete, bot, and retry fixtures.
3. Measure whether default handler generates/responds.
4. Identify safe interception point before model invocation.
5. Record decision; do not add production integration.

## Verification

```bash
npm run typecheck
npm test -- tests/spikes/slack-events
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Ambient event can be captured without model call/reply.
- [x] Event identity and acknowledgement behavior are understood.
- [x] Unsupported assumption blocks P04 rather than adding polling silently.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `2d36a86`
- Handoff commit: —
- Merge commit: 8ba694e
- Integration metadata commit: —
- Completed at: 2026-08-30
