# T302 — Implement read-only archive source reader

- **Status:** Ready for Integration
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** pi-coder-8
- **Branch:** `task/T302-implement-read-only-archive-source-reader`
- **Parallel group:** PG-03B
- **Depends on:** T301
- **Blocks:** T305
- **Can run parallel with:** T303, T304
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T302.md`](../logs/T302.md)
- **Write scope:**
  - `src/migration/source/**`
  - `tests/migration/source/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Read the legacy SQLite archive safely and stream typed source records without mutation or business mapping.

## Deliverables

- Read-only database opener.
- Paginated/streamed readers for users, messages, and threads.
- Source count and corruption/error reporting.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T302-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T302` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Open source explicitly read-only.
2. Avoid loading entire archive into memory.
3. Return contract records only.
4. Handle missing optional fields and malformed rows.
5. Test against synthetic SQLite fixture.

## Verification

```bash
npm run typecheck
npm test -- tests/migration/source
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Source file is never mutated.
- [x] Counts are deterministic.
- [x] Errors identify record IDs without logging content.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `ed257f5113cfedab1630865d510cd51b8e784677`
- Handoff commit: `1eb08a742d23277685fc89f83e0ce389d167eb96`
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
