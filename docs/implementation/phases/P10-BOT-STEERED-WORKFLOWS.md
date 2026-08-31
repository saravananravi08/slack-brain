# P10 — Bot-Steered Workflows and Live Validation

- **Status:** Planned
- **Depends on:** P09
- **Phase integrator:** Unassigned
- **PRD coverage:** GS-FR-001–007, GS-FR-027–037, all acceptance scenarios

## Outcome

An authorized human can assign general work in Slack and Gist can clarify, dispatch to Kilo/Linear, interpret replies, request fixes or approval, run a fresh Kilo review path, and report a durable final outcome without a human relaying bot messages.

## Entry criteria

- [ ] P09 completed.
- [ ] Supervisor resilience/security validation is GO.
- [ ] Approved internal test channels and real Kilo/Linear bots are available.
- [ ] P06/P07 live-gate exceptions are closed or explicitly accepted for this release.

## Parallel execution plan

1. **PG-10A:** T1001, T1002, and T1003 run concurrently against the generic P09 engine with disjoint policy/scenario scopes.
2. **PG-10B:** T1004 integrates and validates the complete live workflow sequentially.

Maximum parallel workers: three.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T1001](../tasks/T1001-HUMAN-ASSIGNMENT-LIFECYCLE.md) — Implement human assignment and approval lifecycle | Planned | P09 | PG-10A | Unassigned | — |
| [T1002](../tasks/T1002-KILO-STEERING-LIFECYCLE.md) — Implement Kilo execution and review steering | Planned | P09 | PG-10A | Unassigned | — |
| [T1003](../tasks/T1003-LINEAR-STEERING-LIFECYCLE.md) — Implement Linear work steering | Planned | P09 | PG-10A | Unassigned | — |
| [T1004](../tasks/T1004-SUPERVISOR-LIVE-VALIDATION.md) — Validate complete Slack supervisor workflow | Planned | T1001–T1003 | PG-10B | Unassigned | — |

## Integration procedure

1. Merge T1001–T1003 one at a time and rerun generic supervisor tests.
2. Verify policies remain data-driven and do not duplicate the P09 engine.
3. T1004 runs synthetic/offline suites before any real Slack action.
4. Live validation records aggregate/content-free evidence only.
5. Close the phase only after one Kilo implementation/review workflow and one Linear workflow reach expected terminal states.

## Exit criteria

- [ ] Clear human assignments start reversible work without redundant confirmation.
- [ ] Missing critical details produce focused clarification and durable resume.
- [ ] Kilo blocker/progress/PR/review/fix outcomes advance correctly.
- [ ] Fresh review behavior is distinguishable from implementation continuation.
- [ ] Linear find/create/update/comment outcomes advance correctly.
- [ ] Human status/correction/pause/resume/cancel/approval behavior passes.
- [ ] Unknown bot, wrong thread/channel/workspace, duplicate, restart, timeout, and loop cases pass.
- [ ] Live evidence contains no real IDs, content, prompts, responses, raw logs, or credentials.
- [ ] Final GO/NO-GO and residual risks are explicit.

## Phase verification

```bash
npm run typecheck
npm test -- tests/orchestration tests/e2e/slack-supervisor
npm run test:e2e
npm test
npm run build
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
