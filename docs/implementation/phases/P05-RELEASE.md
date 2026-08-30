# P05 — Validation, Release, and Cleanup

- **Status:** Planned
- **Depends on:** P03 and P04
- **Phase integrator:** Unassigned
- **PRD coverage:** Sections 11–17

## Outcome

Gist passes product, privacy, reliability, and performance gates; beta and production cutover are controlled and reversible; old runtime is removed only after the rollback window.

## Entry criteria

- [ ] P03 and P04 completed.
- [ ] All required PRD decisions accepted.
- [ ] Production secrets/storage/backup ownership assigned.

## Parallel execution plan

- **PG-05A:** T501, T502, T503, and T504 run concurrently with isolated test/report/runbook paths.
- **PG-05B:** T505 beta release starts after all PG-05A gates pass.
- **PG-05C:** T506 production cutover follows beta approval.
- **PG-05D:** T507 handover may run after T505 and in parallel with production observation; T508 cleanup waits for rollback-window approval.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T501](../tasks/T501-E2E-ACCEPTANCE.md) | Planned | P03, P04 | PG-05A | Unassigned | — |
| [T502](../tasks/T502-SECURITY-REVIEW.md) | Planned | P03, P04 | PG-05A | Unassigned | — |
| [T503](../tasks/T503-PERFORMANCE-OBSERVABILITY.md) | Planned | P03, P04 | PG-05A | Unassigned | — |
| [T504](../tasks/T504-DEPLOYMENT-RUNBOOK.md) | Planned | T106, T307, T406 | PG-05A | Unassigned | — |
| [T505](../tasks/T505-BETA-RELEASE.md) | Planned | T501–T504 | PG-05B | Unassigned | — |
| [T506](../tasks/T506-PRODUCTION-CUTOVER.md) | Planned | T505 + approval | PG-05C | Unassigned | — |
| [T507](../tasks/T507-HANDOVER.md) | Planned | T505 | PG-05D | Unassigned | — |
| [T508](../tasks/T508-LEGACY-CLEANUP.md) | Planned | T506 + rollback window | PG-05D | Unassigned | — |

## Integration procedure

- Gate reports may run concurrently; coordinator records each approval.
- Any privacy failure blocks beta and production.
- Cutover uses one active Slack runtime at a time.
- Legacy deletion requires explicit rollback-window approval and backup verification.

## Exit criteria

- [ ] PRD success metrics and acceptance scenarios pass or have approved exceptions.
- [ ] Security/privacy review approved.
- [ ] Deployment, backup, restore, and rollback rehearsed.
- [ ] Production cutover completed without duplicate bot runtime.
- [ ] Operator handover completed.
- [ ] Legacy code/dependencies removed after rollback window.

## Phase verification

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run benchmark:retrieval
git diff --check
git status --short
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
