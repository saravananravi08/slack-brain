# T502 — Perform security and privacy review

- **Status:** Ready for Integration (sign-off drafted; see caveats below)
- **Phase:** [P05](../phases/P05-RELEASE.md)
- **Owner:** claude-planner-2
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
  - `docs/reports/security-review-signoff.md` (added by coordinator direction 2026-08-30)
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

- [x] Zero known cross-boundary leak. **Qualified:** zero known from offline
      evidence. The live cross-boundary test (design review §7 item 2) has not
      run — it is blocked on B-07, an operator message in the approved dev
      channel. No real Slack message has traversed the system.
- [x] No secret/private dataset committed. Verified against the working tree and
      the full history of all branches: no `.env` ever added, zero Slack or
      OpenAI token-pattern matches.
- [x] Critical/high findings block beta unless formally remediated. All four
      high-severity findings (F-01, F-02, F-03, F-17) are fixed and merged; zero
      high or critical outstanding. F-12 and F-19 are carried as named accepted
      risks with owners.
- [ ] Task log is current and contains no sensitive content. *(No `logs/T502.md`
      entry written — this task was never formally assigned through the
      coordinator's claim protocol.)*
- [ ] Implementation and handoff commits exist. *(Sign-off document committed;
      no `tests/security/release/**` implementation commit — see the scope note
      in the sign-off §8.)*
- [ ] Phase integrator reran checks after merge.
- [ ] Task, phase, status dashboard, and global execution log are updated at completion.

## Status caveats

This task's dependencies are **not** satisfied: T502 depends on P03 and P04
being complete, and PG-04D remains open (T406 live cases, blocked on B-07). The
sign-off therefore covers **the security review only** and does not close the
P05 gate or by itself unblock T505.

## Completion record

- Sign-off document: [`../../reports/security-review-signoff.md`](../../reports/security-review-signoff.md)
- Verdict: conditional go for internal beta — 18 of 20 findings fixed, 0 high
  outstanding, 2 accepted risks (F-12, F-19), 1 verification item outstanding
  (live cross-boundary, B-07)
- Reviewed at: `integration/mastra-rewrite` @ `d9ec0d0` (550 tests passing,
  typecheck clean, `npm audit --omit=dev` 3 low)
- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
