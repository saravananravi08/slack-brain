# T406 — Validate live ingestion end to end

- **Status:** Blocked
- **Phase:** [P04](../phases/P04-LIVE-INGESTION.md)
- **Owner:** pi-coder-14
- **Branch:** `task/T406-validate-live-ingestion-end-to-end`
- **Parallel group:** PG-04D
- **Depends on:** T405, T205
- **Blocks:** T501, T502, T503
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T406.md`](../logs/T406.md)
- **Write scope:**
  - `tests/e2e/live-ingestion/**`
  - `docs/reports/live-ingestion-validation.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Prove live approved-channel knowledge capture, exclusion, mutation, recall, and zero-generation behavior.

## Deliverables

- E2E fixture/live-test suite.
- Sanitized event/count/model-call report.
- Go/no-go phase result.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T406-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T406` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Run ambient root/reply/edit/delete/retry/bot/unapproved cases.
2. Assert model and Slack post call counts.
3. Ask Gist a later paraphrased question to verify recall.
4. Run privacy boundary cases.
5. Record limitations and gate outcome.

## Verification

```bash
npm run typecheck
npm run test:ingestion
npm run test:e2e -- --case ambient-message
git diff --check
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Zero ambient generation/replies.
- [ ] Expected message is later recalled.
- [ ] No excluded event pollutes knowledge.
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
