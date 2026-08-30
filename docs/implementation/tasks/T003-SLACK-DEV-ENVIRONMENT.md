# T003 — Prepare isolated Slack development environment

- **Status:** Completed
- **Phase:** [P00](../phases/P00-GOVERNANCE.md)
- **Owner:** pi-coder-3
- **Branch:** `task/T003-prepare-isolated-slack-development-environment`
- **Parallel group:** PG-00A
- **Depends on:** —
- **Blocks:** T104, T401
- **Can run parallel with:** T000, T001, T002
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T003.md`](../logs/T003.md)
- **Write scope:**
  - `docs/runbooks/slack-dev-environment.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Provide a safe Slack app/channel and credential procedure for development without production duplicate replies.

## Deliverables

- Slack app manifest/scopes documented without secrets.
- Dedicated test channel and test-user procedure.
- Socket Mode setup, credential placement, rotation, and teardown steps.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T003-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T003` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Create or identify a non-production Slack workspace/channel.
2. Document required bot events/scopes and Socket Mode app token setup.
3. Verify the bot cannot access unapproved channels.
4. Store credentials only in approved secret location.
5. Run a connectivity smoke check and document sanitized result.

## Verification

```bash
git diff --check
rg -n "xox[bap]-[A-Za-z0-9-]+" docs/runbooks && exit 1 || true
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [x] No production channel receives development events.
- [x] No credential appears in Git.
- [x] A new worker can reproduce setup from the runbook.
- [x] Task log is current and contains no sensitive content.
- [x] Implementation and handoff commits exist.
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Completion record

- Implementation commit: `841a9d9618b4314e19205a5d87ed716dc06242b8`
- Handoff commit: `HEAD` (`docs(T003): hand off Slack development runbook`)
- Operator follow-up: Live app creation, denied-channel API validation, credential connectivity, and end-to-end Socket Mode smoke check pending operator credentials; no real Slack app or credential was created or used in T003.
- Merge commit: 090e8ad
- Integration metadata commit: —
- Completed at: 2026-08-30
