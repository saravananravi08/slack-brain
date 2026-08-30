# T202 — Implement resource and thread identity policy

- **Status:** Planned
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** Unassigned
- **Branch:** `task/T202-implement-resource-and-thread-identity-policy`
- **Parallel group:** PG-02A
- **Depends on:** T004, T106
- **Blocks:** T204, T403
- **Can run parallel with:** T201, T203, T205
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T202.md`](../logs/T202.md)
- **Write scope:**
  - `src/mastra/memory/resource-policy.ts`
  - `tests/memory/resource-policy.test.ts`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Map Slack workspaces/channels/threads/DMs to deterministic Mastra identities without collisions or privacy leaks.

## Deliverables

- Pure resource/thread resolver functions.
- Deterministic test vectors for channel, thread, and DM cases.
- Collision and invalid-input handling.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T202-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T202` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement accepted channel and DM ownership policy.
2. Include workspace/channel boundaries where required.
3. Keep DM private history separate from shared knowledge.
4. Match historical-import contract.
5. Test deterministic results and forbidden cross-scope reuse.

## Verification

```bash
npm run typecheck
npm test -- tests/memory/resource-policy.test.ts
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Same Slack thread maps consistently after restart.
- [ ] Different channels/DM users never collide.
- [ ] Mappings match architecture fixtures.
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
