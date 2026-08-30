# T205 — Build retrieval benchmark harness

- **Status:** Completed
- **Phase:** [P02](../phases/P02-MEMORY.md)
- **Owner:** pi-coder-6
- **Branch:** `task/T205-build-retrieval-benchmark-harness`
- **Parallel group:** PG-02A
- **Depends on:** T002, T004
- **Blocks:** T206, T306, T406
- **Can run parallel with:** T201, T202, T203
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T205.md`](../logs/T205.md)
- **Write scope:**
  - `benchmarks/retrieval/**`
  - `tests/benchmarks/**`
  - `docs/reports/retrieval-benchmark-template.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Automate PRD retrieval metrics with redacted datasets and reproducible scoring.

## Deliverables

- Benchmark runner and schema.
- Synthetic/paraphrase/exact-value/no-answer test sets.
- Report output for relevance, grounding, attribution, latency, and unsupported claims.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T205-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T205` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Convert baseline schema into executable cases.
2. Separate retrieval score from answer score.
3. Add deterministic evaluator where possible and explicit reviewer rubric otherwise.
4. Prevent benchmark artifacts with message content from entering Git.
5. Document thresholds from PRD.

## Verification

```bash
npm run typecheck
npm test -- tests/benchmarks
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

- [x] Runner returns nonzero on threshold failure.
- [x] No-answer cases penalize invention.
- [x] Reports are comparable across commits.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `a6ed5bcf489a6d0c61fb11e6d7a007db40b29f5d`
- Handoff commit: This task/log metadata commit (see branch history).
- Merge commit: bcfb465
- Integration metadata commit: —
- Completed at: 2026-08-30
