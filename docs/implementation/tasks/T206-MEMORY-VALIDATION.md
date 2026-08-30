# T206 — Validate memory, retrieval, and privacy

- **Status:** Ready for Integration
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** pi-coder-6
- **Branch:** `task/T206-validate-memory-retrieval-and-privacy`
- **Parallel group:** PG-02C
- **Depends on:** T204, T205
- **Blocks:** T301, T401, T501
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T206.md`](../logs/T206.md)
- **Write scope:**
  - `tests/integration/memory-validation/**`
  - `docs/reports/memory-validation.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Prove integrated memory behavior and block downstream work on privacy or grounding failures.

## Deliverables

- Automated boundary/restart/recall tests.
- Sanitized validation report against PRD thresholds.
- Known limitations and tuning recommendation.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T206-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T206` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Run privacy cases first.
2. Run same-thread, cross-thread resource, DM, and channel recall cases.
3. Inspect traces to verify retrieved context and no hidden tool calls.
4. Run benchmark and classify failures.
5. Record go/no-go result.

## Verification

```bash
npm run typecheck
npm test -- tests/integration/memory-validation
npm run benchmark:retrieval -- --dataset benchmarks/retrieval/synthetic
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Zero privacy leaks.
- [x] Persistence/restart cases pass.
- [x] Retrieval baseline is accepted or phase remains blocked.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `8aa8921bf4b9390b516d02ecc88c090f3f0b209c`
- Handoff commit: This task/log metadata commit (see branch history).
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
