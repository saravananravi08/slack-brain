# T301 — Define archive import contract and fixtures

- **Status:** Blocked
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** pi-coder-8
- **Branch:** `task/T301-define-archive-import-contract-and-fixtures`
- **Parallel group:** PG-03A
- **Depends on:** P02
- **Blocks:** T302, T303, T304
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T301.md`](../logs/T301.md)
- **Write scope:**
  - `docs/architecture/contracts/archive-import.md`
  - `tests/fixtures/migration/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Define a stable, privacy-safe contract for converting the existing Slack archive into Mastra memory.

## Deliverables

- Source/normalized/writer schemas.
- Synthetic fixtures for roots, replies, edits, bots, missing users, timestamps, duplicates.
- Count reconciliation and failure-report rules.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T301-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T301` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Inspect source schema without committing real records.
2. Map fields to architecture identities/metadata.
3. Define deterministic IDs and timezone handling.
4. Define exclusions and D005 behavior.
5. Review contract with T302–T304 owners.

## Verification

```bash
npm run typecheck
npm test -- tests/fixtures/migration
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Fixtures contain no real Slack text/IDs.
- [ ] All source edge cases have expected normalized output.
- [ ] Contract is versioned and immutable for parallel component work.
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
