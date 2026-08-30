# T502 — Perform security and privacy review

- **Status:** Planned
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** Unassigned
- **Branch:** `task/T502-perform-security-and-privacy-review`
- **Parallel group:** PG-05A
- **Depends on:** T203, P03, P04
- **Blocks:** T505
- **Can run parallel with:** T501, T503, T504
- **Conflicts with:** None under declared write scope
- **Task log:** [`../logs/T502.md`](../logs/T502.md)
- **Write scope:**
  - `tests/security/release/**`
  - `docs/reports/security-review.md`
- **Read-only references:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, this phase file, `STATUS.md`, and other task files.

## Objective

Verify secrets, authorization, DM/channel isolation, external-user denial, logs, traces, storage, and dependencies before release.

## Deliverables

- Threat checklist and automated negative tests.
- Dependency/secret scan results.
- Privacy boundary and trace-retention review.
- Signed go/no-go with unresolved risk owners.

## Mandatory procedure — follow throughout

1. Confirm every dependency is **merged** and `Completed`; confirm required decisions are accepted.
2. Obtain coordinator assignment before creating `task/T502-...` from the latest integration branch.
3. Use an isolated worktree. Mark only this task file `In Progress` and append start entry to its task log.
4. Edit only **Write scope** paths. Treat references and shared integration files as read-only.
5. Keep changes minimal; add tests with behavior; never commit secrets, Slack content, DBs, traces, or `.env`.
6. Log material commands, results, decisions, failed attempts, rebases, and blockers as they happen.
7. If an assumption/dependency is wrong, stop, mark `Blocked`, record evidence and unblock owner—do not invent a workaround.
8. Before handoff run all verification, `git diff --check`, scope diff, and inspect `git status --short`.
9. Stage explicit paths only; create an implementation commit containing `T502` in its subject.
10. Record commit hash, mark `Ready for Integration`, and commit task/log handoff metadata.
11. Phase integrator merges, reruns checks, then marks `Completed` and updates phase file, `STATUS.md`, and `EXECUTION_LOG.md` in a separate metadata commit.

## Implementation steps

1. Review data flow and trust boundaries.
2. Test unauthorized read/write/generation attempts.
3. Scan Git history/current tree and build artifacts for secrets/data.
4. Inspect logs/traces for message/token leakage.
5. Review dependency advisories and storage permissions.

## Verification

```bash
npm audit --omit=dev
npm test -- tests/security
git diff --check
git status --short
```

Also run:

```bash
git diff --name-only integration/mastra-rewrite...HEAD
git status --short
```

Every changed path must be in this task's write scope or its own task/log metadata.

## Acceptance criteria

- [ ] Zero known cross-boundary leak.
- [ ] No secret/private dataset committed.
- [ ] Critical/high findings block beta unless formally remediated.
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
