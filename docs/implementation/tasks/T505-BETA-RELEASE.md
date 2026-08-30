# T505 — Execute internal beta release

- **Status:** Planned
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** Unassigned
- **Branch:** `task/T505-execute-internal-beta-release`
- **Parallel group:** PG-05B
- **Depends on:** T501, T502, T503, T504
- **Blocks:** T506, T507
- **Can run parallel with:** None until dependencies merge
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T505.md`](../logs/T505.md)
- **Write scope:**
  - `docs/releases/beta.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Run Gist in the approved beta channel, observe real behavior, and obtain production go/no-go.

## Deliverables

- Beta release record with commit/version/config identifiers.
- Sanitized metric/incident/user-feedback summary.
- Production approval or remediation list.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T505-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T505` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Confirm all gate approvals and backup.
2. Deploy one beta runtime using approved Slack app/channel.
3. Monitor duplicates, privacy, recall, latency, cost, reconnect, and ingestion.
4. Log incidents in task log immediately.
5. Collect approval after agreed observation period.

## Verification

```bash
npm run test:e2e
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

- [ ] No critical/privacy incident.
- [ ] Metrics meet launch thresholds.
- [ ] Production approval is recorded.
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
