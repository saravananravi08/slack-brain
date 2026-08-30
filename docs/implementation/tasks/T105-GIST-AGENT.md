# T105 — Implement Gist agent behavior

- **Status:** Ready for Integration
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** pi-coder
- **Branch:** `task/T105-implement-gist-agent-behavior`
- **Parallel group:** PG-01B
- **Depends on:** T101, T004
- **Blocks:** T106, T201
- **Can run parallel with:** T102, T103, T104
- **Conflicts with:** T204
- **Task log:** [`../logs/T105.md`](../logs/T105.md)
- **Write scope:**
  - `src/mastra/agents/**`
  - `tests/agents/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Create the Mastra agent named Gist with concise Slack behavior, grounded-answer rules, and no tools.

## Deliverables

- Gist agent factory/instructions.
- Model configuration integration point.
- Behavior tests for identity, brevity, uncertainty, and internal-error suppression.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T105-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T105` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Extract only product-relevant persona from old prompt.
2. Remove tool/search/ClickUp/Claude/MCP/poll instructions.
3. Register no agent-callable tools.
4. Keep instructions separate from memory policy.
5. Test prompt invariants and fallback responses.

## Verification

```bash
npm run typecheck
npm test -- tests/agents
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Agent display identity is Gist.
- [x] No tools are registered.
- [x] Unknown evidence yields uncertainty instruction.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `2f1764442833c89dad133b28dbbaccd4bbad8156`
- Handoff commit: This task/log metadata commit (see branch history).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
