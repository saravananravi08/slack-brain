# T201 — Configure Mastra Memory and semantic recall

- **Status:** Ready for Integration
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** pi-coder-7
- **Branch:** `task/T201-configure-mastra-memory-and-semantic-recall`
- **Parallel group:** PG-02A
- **Depends on:** T103, T105
- **Blocks:** T204, T304, T403
- **Can run parallel with:** T202, T203, T205
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T201.md`](../logs/T201.md)
- **Write scope:**
  - `src/mastra/memory/gist-memory.ts`
  - `tests/memory/config.test.ts`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Create the approved Mastra Memory configuration for recent history, embeddings, and automatic semantic recall.

## Deliverables

- Memory factory with storage/vector/embedder.
- Explicit recall defaults and validated model selection.
- Tests for configuration and storage/vector compatibility.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T201-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T201` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement recent history and resource-scoped semantic recall.
2. Use approved embedding provider/model.
3. Keep Observational/Working Memory disabled unless decision changes.
4. Expose tuning values without broad config framework.
5. Test no tool is required for recall.

## Verification

```bash
npm run typecheck
npm test -- tests/memory/config.test.ts
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Semantic recall is enabled automatically.
- [x] Memory and vector dimensions/config align.
- [x] No search tool/shell command is introduced.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `84718e95ca41b6b19658fac4e2da249e36b09e32`
- Handoff commit: This task/log metadata commit (see branch history).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
