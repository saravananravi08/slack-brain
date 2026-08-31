# T1004 — Integrate and validate complete Slack supervisor workflow

- **Status:** Planned
- **Phase:** [P10](../phases/P10-BOT-STEERED-WORKFLOWS.md)
- **Owner:** Unassigned
- **Branch:** `task/T1004-integrate-validate-slack-supervisor`
- **Parallel group:** PG-10B
- **Depends on:** T1001, T1002, T1003
- **Blocks:** Slack supervisor release gate
- **Can run parallel with:** None
- **Conflicts with:** Exclusive final supervisor/runtime integration and live Gist process
- **Write scope:**
  - `src/orchestration/index.ts`
  - `src/orchestration/supervisor/**`
  - `src/mastra/index.ts`
  - `tests/e2e/slack-supervisor/**`
  - `docs/runbooks/slack-supervisor-validation.md`
  - `docs/reports/slack-supervisor-live-validation.md`
- **Read-only references:** All P08–P10 tasks/logs, P06/P07 live reports, deployment/safety runbooks.
- **Task log:** [`../logs/T1004.md`](../logs/T1004.md)

## Objective

Integrate human/Kilo/Linear policies into the generic supervisor and prove one complete Kilo implementation→fresh-review→fix/acceptance workflow plus one Linear workflow over real Slack, with restart, duplicate, authorization, boundary, timeout, and loop controls.

## Deliverables

- Final policy registration/composition.
- Offline end-to-end acceptance suite.
- Operator live-validation runbook.
- Sanitized aggregate live report and explicit GO/NO-GO.

## Required procedure

1. Confirm T1001–T1003 are merged and feature branch is green.
2. Run complete synthetic suite before live Slack.
3. Run exactly one live Gist process on approved internal test channels.
4. Human/operator performs human-only Slack actions; never fake identities.
5. Use disposable work suitable for Kilo/Linear validation; no production secrets/data.
6. Record counts/states/booleans/coarse times only; delete raw evidence.
7. Do not declare GO with an unrun compatibility, restart, loop, approval, or cross-boundary row.
8. Verify full suite/build and hand off.

## Implementation steps

1. Register human/Kilo/Linear policies in supervisor composition.
2. Add offline clear/ambiguous assignment, Kilo blocker/PR/review/fix, Linear operation, restart/replay/concurrency, unauthorized/wrong-boundary, approval, timeout, and loop cases.
3. Write stepwise operator runbook and content-free metric schema.
4. Execute live Kilo and Linear workflows.
5. Sanitize, record findings, and issue gate result.

## Verification

```bash
npm run typecheck
npm test -- tests/e2e/slack-supervisor tests/orchestration
npm run test:e2e
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Human assigns clear work and Gist dispatches without redundant approval.
- [ ] Gist clarifies an ambiguous assignment and resumes durably.
- [ ] Kilo blocker/progress/PR/fresh-review/findings/fix/acceptance flow completes.
- [ ] Linear find/create/update or equivalent measured flow completes.
- [ ] Restart/replay/concurrency causes zero duplicate dispatch.
- [ ] Unknown/self/wrong-boundary/unauthorized events cause zero workflow transition.
- [ ] Gated action waits for correct current approval.
- [ ] Timeout/turn limit terminates safely.
- [ ] Live evidence is sanitized and final GO/NO-GO is explicit.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
