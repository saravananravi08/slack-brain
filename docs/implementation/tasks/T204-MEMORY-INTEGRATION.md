# T204 — Integrate memory, identity, and access

- **Status:** Ready for Integration
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** pi-coder-5
- **Branch:** `task/T204-integrate-memory-identity-and-access`
- **Worktree:** `../worktrees/T204`
- **Parallel group:** PG-02B
- **Depends on:** T201, T202, T203, T106
- **Blocks:** T206, T405
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** T103, T104, T105, T405
- **Task log:** [`../logs/T204.md`](../logs/T204.md)
- **Write scope:**
  - `src/mastra/index.ts`
  - `src/mastra/agents/gist.ts`
  - `src/mastra/channels/slack.ts`
  - `tests/integration/memory/**`
  - `tests/integration/foundation/runtime.test.ts` (coordinator-approved scope amendment, `6cffe41`)
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Wire approved access checks and deterministic Mastra memory into every Gist Slack run.

## Deliverables

- Agent memory registration.
- Channel request-context/resource/thread resolution.
- Pre-memory authorization path.
- Integration tests for DM/channel boundaries and restart.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T204-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T204` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Compose existing modules; do not reimplement them.
2. Ensure authorization occurs before memory retrieval/write/model call.
3. Attach memory to Gist and channel identities to Mastra context.
4. Handle denied events without data leakage.
5. Test persistence and multi-user channel behavior.

## Verification

```bash
npm run typecheck
npm test -- tests/integration/memory
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

- [x] Automatic recall occurs on normal Gist call.
- [x] DM/channel boundaries match decisions.
- [x] Restart test retains context.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `3d6f5ad206ef2d0636162fc55f87095e6c933bdd`
- Handoff commit: This task/log metadata commit (see branch history).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
