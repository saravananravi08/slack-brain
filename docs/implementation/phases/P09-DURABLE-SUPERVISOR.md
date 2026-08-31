# P09 — Durable Slack Supervisor Runtime

- **Status:** Planned
- **Depends on:** P08
- **Phase integrator:** Unassigned
- **PRD coverage:** GS-FR-012–026, GS-FR-034–043, GS-NFR-001–008

## Outcome

Gist durably correlates authorized human assignments and trusted bot replies, produces one schema-valid bounded decision per event, dispatches only to configured logical bot targets, and resumes safely after retries, concurrency, timeout, and restart.

## Entry criteria

- [ ] P08 completed.
- [ ] Both Kilo and Linear Slack compatibility paths are GO.
- [ ] Supervisor workflow/action/event contracts are frozen.
- [ ] P08 threat model has no unresolved high-severity finding.

## Parallel execution plan

1. **PG-09A:** T901, T902, T903, and T904 run concurrently with disjoint scopes.
2. **PG-09B:** T905 exclusively integrates shared config, Slack channel, agent instructions, and runtime composition.
3. **PG-09C:** T906 validates restart, replay, authorization, limits, and loop prevention.

Maximum parallel workers: four.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T901](../tasks/T901-WORKFLOW-REGISTRY.md) — Implement durable workflow registry | Planned | P08 | PG-09A | Unassigned | — |
| [T902](../tasks/T902-AUTOMATION-EVENT-ROUTER.md) — Implement trusted automation event router | Planned | P08 | PG-09A | Unassigned | — |
| [T903](../tasks/T903-SLACK-BOT-DISPATCH.md) — Implement structured Slack bot dispatch | Planned | P08 | PG-09A | Unassigned | — |
| [T904](../tasks/T904-SUPERVISOR-DECISION-ENGINE.md) — Implement supervisor decision engine | Planned | P08 | PG-09A | Unassigned | — |
| [T905](../tasks/T905-SUPERVISOR-RUNTIME-INTEGRATION.md) — Integrate durable supervisor runtime | Planned | T901–T904 | PG-09B | Unassigned | — |
| [T906](../tasks/T906-SUPERVISOR-RESILIENCE-VALIDATION.md) — Validate supervisor resilience and security | Planned | T905 | PG-09C | Unassigned | — |

## Integration procedure

1. Merge T901–T904 one at a time; rerun their focused suites after each merge.
2. T905 owns all shared runtime/config/channel/agent composition.
3. Verify the existing human mention, proactive, capture, context, and bot-silence behavior after integration.
4. Merge T906 only with explicit restart/replay/loop/security evidence.
5. Update phase, status, and execution metadata.

## Exit criteria

- [ ] Workflow/action state is durable and compare-and-set/idempotent.
- [ ] Every authorized human and trusted Kilo/Linear event reaches the correct supervisor path.
- [ ] Gist/self and unknown automation cannot trigger the supervisor.
- [ ] Logical targets map to configured IDs outside model control.
- [ ] One event produces at most one checkpointed external action.
- [ ] Per-workflow serialization prevents stale concurrent transitions.
- [ ] Restart, duplicate, timeout, dispatch failure, max-turn, and approval-version tests pass.
- [ ] Exact capture remains independent of supervisor/model failure.

## Phase verification

```bash
npm run typecheck
npm test -- tests/orchestration tests/channels tests/security tests/integration/slack-supervisor
npm test
npm run build
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
