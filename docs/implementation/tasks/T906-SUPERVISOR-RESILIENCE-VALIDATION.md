# T906 — Validate supervisor resilience and security

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T906-validate-supervisor-resilience-security`
- **Parallel group:** PG-09C
- **Depends on:** T905
- **Blocks:** P10
- **Can run parallel with:** None
- **Conflicts with:** None under declared validation scope
- **Write scope:**
  - `tests/orchestration/resilience/**`
  - `tests/security/slack-supervisor/**`
  - `tests/e2e/slack-supervisor/runtime-validation.test.ts`
  - `docs/reports/slack-supervisor-resilience.md`
- **Read-only references:** P08/P09 implementation, threat model, live compatibility report.
- **Task log:** [`../logs/T906.md`](../logs/T906.md)

## Objective

Prove the integrated supervisor fails closed and converges under restart, duplicate/reordered events, concurrent replies, Slack/model/storage failure, stale approvals, timeout, turn limits, unauthorized input, wrong boundaries, prompt injection, and self-loop attempts.

## Deliverables

- Deterministic resilience/security suite using real workflow storage and runtime seams.
- Sanitized aggregate validation report with explicit GO/NO-GO.
- Findings with owner/severity/disposition.

## Required procedure

1. Run offline/synthetic cases before any optional live transport check.
2. Use real storage reopen for restart cases.
3. Do not stub away action checkpoints or sender routing under test.
4. Verify exact capture survives supervisor/model failure.
5. Stop on unresolved high-severity finding.
6. Record content-free evidence only.
7. Verify and hand off.

## Implementation steps

1. Build state-machine/restart/replay/concurrency matrix.
2. Add wrong owner/workspace/channel/thread/bot/destination cases.
3. Add injection, malformed model output, stale approval, max-turn, inactivity, lifetime, and dispatch failure cases.
4. Assert zero duplicate actions and zero self/unknown-bot actions.
5. Run full regression and issue gate result.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/resilience tests/security/slack-supervisor tests/e2e/slack-supervisor/runtime-validation.test.ts
npm run test:e2e
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Restart/replay/concurrency produces no duplicate external action.
- [ ] Wrong identity/boundary/owner/approval fails closed.
- [ ] Timeout/turn/failure limits terminate or wait for human as specified.
- [ ] Prompt injection cannot change target, scope, owner, approval, or policy.
- [ ] Exact message capture survives supervisor/model failure.
- [ ] No unresolved high-severity finding remains.
- [ ] P09 GO/NO-GO is explicit.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
