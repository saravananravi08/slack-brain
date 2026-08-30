# T505 — Execute internal beta release

- **Status:** In Progress (preparation complete; beta not run — blocked, see below)
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** claude-planner-2
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

- [ ] No critical/privacy incident. **Requires the beta to run.**
- [ ] Metrics meet launch thresholds. **Blocked — T503 not started; no
      thresholds defined.**
- [ ] Production approval is recorded. **Requires the two above.**
- [ ] Task log is current and contains no sensitive content.
- [ ] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Status note

**Preparation deliverable merged; the beta has not been executed.**
[`docs/releases/beta.md`](../../releases/beta.md) carries the scope, pre-flight
checklist, test-workspace deployment procedure, observation plan, exit criteria,
and blocker register.

The beta is technically ready to start — the Slack app is a member of the beta
channel (verified 2026-08-30), scopes and provider credential are in place, and
Socket Mode plus live generation both passed T501's opt-in checks. What stops
T505 from completing is not readiness to run but the following:

- **Dependency gap:** T505 depends on T501, T502, T503, T504. **T503 has never
  been assigned**, so "metrics meet launch thresholds" cannot be evaluated —
  no thresholds exist.
- **B-08 (new):** `npm run build` fails — `"mastra" is not exported by
  src/mastra/index.ts`, a consequence of the F-05 security fix. Low impact on
  the beta because the documented start path does not use `mastra build`, but it
  must be fixed before T506.
- **Execution requires an operator.** The acceptance criteria need a beta window
  to have run; nothing here can satisfy them.

The beta is deliberately scoped to exclude historical recall: B-03 means no
archive has been imported, so the corpus is only what is posted during the
window. That expectation must reach beta users before the first message.

## Completion record

- Implementation commit: `2dccf1f`
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
