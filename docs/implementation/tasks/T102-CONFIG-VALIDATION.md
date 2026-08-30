# T102 — Implement startup configuration validation

- **Status:** Ready for Integration
- **Phase:** [P01](../phases/P01-FOUNDATION.md)
- **Owner:** pi-coder-2
- **Branch:** `task/T102-implement-startup-configuration-validation`
- **Parallel group:** PG-01B
- **Depends on:** T101
- **Blocks:** T106, T203
- **Can run parallel with:** T103, T104, T105
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T102.md`](../logs/T102.md)
- **Write scope:**
  - `src/config.ts`
  - `tests/config/**`
  - `.env.example`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Fail fast with safe errors when required Slack, model, embedding, or storage configuration is missing or invalid.

## Deliverables

- Typed validated config object.
- Environment example with placeholders only.
- Tests for missing, malformed, and valid configuration.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T102-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T102` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Implement schema-based parsing without new config abstraction layers.
2. Require Slack tokens, model IDs, database URL, and approved IDs dictated by decisions.
3. Prevent hardcoded production defaults.
4. Redact secrets in errors/logs.
5. Test process-independent parsing.

## Verification

```bash
npm run typecheck
npm test -- tests/config
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Missing config fails before network/storage initialization.
- [x] Errors name variable but never value.
- [x] Valid config is immutable/typed.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `bd6b9102a38776418eb631b4f9fb36c83c05c1cc`
- Handoff commit: pending metadata commit
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
