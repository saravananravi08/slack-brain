# T306 — Run sample archive import and quality gate

- **Status:** In Progress
- **Phase:** [P03](../phases/P03-HISTORY.md)
- **Owner:** Unassigned
- **Branch:** `task/T306-sample-import-synthetic-rehearsal`
- **Parallel group:** PG-03D
- **Depends on:** T205, T305
- **Blocks:** T307
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T306.md`](../logs/T306.md)
- **Coordinator-approved synthetic rehearsal scope:**
  - `tests/migration/**`
  - `docs/implementation/logs/T306.md`
  - `docs/implementation/tasks/T306-SAMPLE-IMPORT.md`
- **Real-sample write scope:**
  - `docs/reports/sample-import-summary.md`
  - `benchmarks/history/**`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Validate migration correctness and retrieval quality on a bounded representative archive sample before full import.

## Deliverables

- Sanitized sample selection method and count report.
- Metadata/count reconciliation.
- Historical retrieval benchmark report and approval decision.

## Preparation status

- Synthetic fixture-shaped archive rehearsal completed on 2026-08-30 through the import CLI and scratch Mastra store.
- First run inserted nine normalized records from 14 approved source rows; rerun reported all nine unchanged with no destination growth.
- Both reports reconciled, contained zero failures, and remained outside Git with the synthetic databases/checkpoints.
- Rehearsal test commit: `a633d874ebf5c27c4a3a45e567e1c1a8b30c6e05`.
- Real bounded sample, retrieval benchmark, and go/no-go decision remain pending B-03 archive DB access and authoritative inventory.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T306-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T306` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Back up source/destination.
2. Select representative dates, users, roots, replies, and exact-value cases without committing content.
3. Run dry-run then sample import.
4. Inspect metadata and rerun idempotency.
5. Run benchmark and record go/no-go.

## Verification

```bash
npm run test:migration
npm run benchmark:retrieval -- --dataset benchmarks/history
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] No source mutation.
- [ ] Sample counts and metadata accepted.
- [ ] PRD recall thresholds met or T307 remains blocked.
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
