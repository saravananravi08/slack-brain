# T404 — Implement edit/delete and retention mutation policy

- **Status:** Ready for Integration
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** pi-coder-11
- **Branch:** `task/T404-implement-edit-delete-and-retention-mutation-policy`
- **Parallel group:** PG-04B
- **Depends on:** T001, T203, T401
- **Blocks:** T405
- **Can run parallel with:** T402, T403
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T404.md`](../logs/T404.md)
- **Write scope:**
  - `src/ingestion/mutations/**`
  - `tests/ingestion/mutations/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Apply accepted Slack edit/delete/retention behavior to Mastra memory without crossing authorization boundaries.

## Deliverables

- Mutation classifier/handler.
- Tests for edits, deletes, late retries, missing originals, and unauthorized events.
- Documented storage limitation/escalation if exact deletion is unsupported.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T404-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T404` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement D004/D005 exactly.
2. Authorize mutation before lookup/write.
3. Update/remove both message and retrieval representation where supported.
4. Make repeated mutation idempotent.
5. Stop and record blocker if Mastra API cannot satisfy deletion requirement.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/mutations
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Behavior matches accepted retention/deletion policy.
- [x] Unauthorized mutation changes nothing.
- [x] No stale embedding remains when policy requires deletion.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `ed068b8adc08a9049f020499dcd16fe99028d455`
- Handoff commit: This task/log metadata commit (exact hash in branch history and handoff report).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
