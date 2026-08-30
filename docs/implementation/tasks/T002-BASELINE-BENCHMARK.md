# T002 — Capture baseline and retrieval benchmark

- **Status:** Ready for Integration
- **Phase:** [P00](../phases/P00-GOVERNANCE.md)
- **Owner:** pi-coder-2
- **Branch:** `task/T002-capture-baseline-and-retrieval-benchmark`
- **Parallel group:** PG-00A
- **Depends on:** —
- **Blocks:** T205, T501
- **Can run parallel with:** T000, T001, T003
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T002.md`](../logs/T002.md)
- **Write scope:**
  - `benchmarks/baseline/**`
  - `docs/reports/current-system-baseline.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Create a redacted, repeatable baseline for current Gist behavior and future retrieval quality comparisons.

## Deliverables

- Behavior inventory for DM, mention, thread, restart, retrieval, and failure cases.
- Redacted benchmark schema and synthetic seed dataset.
- Current latency/reliability observations with measurement method.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T002-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T002` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Define benchmark categories from PRD acceptance scenarios.
2. Use synthetic/redacted examples; never commit Slack content.
3. Record expected evidence and grounded answer criteria.
4. Run current system checks where safe and record limitations.
5. Define scoring formula for relevance, grounding, attribution, and latency.

## Verification

```bash
git diff --check
find benchmarks/baseline -type f -maxdepth 3 -print
rg -n "token|xox[bap]-" benchmarks docs/reports/current-system-baseline.md && exit 1 || true
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] Dataset contains no private Slack data.
- [x] Scoring is deterministic enough for two reviewers.
- [x] Baseline limitations are explicit.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `a843a027e5fd46ff4cb5bb9db34a57fd740337eb`
- Handoff commit: pending metadata commit
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
