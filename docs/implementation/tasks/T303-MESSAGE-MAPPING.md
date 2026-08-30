# T303 — Implement archive message normalization

- **Status:** Planned
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** Unassigned
- **Branch:** `task/T303-implement-archive-message-normalization`
- **Parallel group:** PG-03B
- **Depends on:** T301
- **Blocks:** T305
- **Can run parallel with:** T302, T304
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T303.md`](../logs/T303.md)
- **Write scope:**
  - `src/migration/mapping/**`
  - `tests/migration/mapping/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Convert source archive rows into deterministic Mastra-ready messages and metadata.

## Deliverables

- Pure message/thread mapping functions.
- Timezone/identity/speaker normalization.
- Bot/system exclusion and deterministic ID tests.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T303-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T303` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement only T301 contract.
2. Preserve original timestamp and derive display date safely.
3. Map root/reply relationships and multi-user author metadata.
4. Apply accepted exclusion/mutation rules.
5. Add edge-case table tests.

## Verification

```bash
npm run typecheck
npm test -- tests/migration/mapping
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Same input always yields same IDs/output.
- [ ] DM/channel identities cannot mix.
- [ ] No live storage or DB access in mapper.
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
