# T503 — Validate performance and observability

- **Status:** In Progress
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** pi coding agent
- **Branch:** `task/T503-validate-performance-and-observability`
- **Parallel group:** PG-05A
- **Depends on:** P03, P04
- **Blocks:** T505
- **Can run parallel with:** T501, T502, T504
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T503.md`](../logs/T503.md)
- **Write scope:**
  - `tests/performance/**`
  - `docs/reports/performance-observability.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Measure PRD latency/reliability metrics and prove traces support diagnosis without unsafe logging.

## Deliverables

- Repeatable latency/load scenarios.
- p50/p90/p95 timing and event success report.
- Trace correlation/redaction validation.
- Capacity/cost observations.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T503-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T503` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Measure typing, first token, completion, retrieval, and ingestion latency.
2. Exercise concurrent threads and reconnects at approved load.
3. Correlate Slack event to one trace/run.
4. Inspect trace redaction/access.
5. Compare results to PRD thresholds and record provider incidents separately.

## Verification

```bash
npm run test:performance
npm run benchmark:retrieval
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] PRD timing targets pass or approved remediation exists.
- [ ] Ambient ingestion shows zero generation cost.
- [ ] Trace can diagnose failures without standard-log content.
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
