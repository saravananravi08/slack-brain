# P00 — Governance, Safety, and Contracts

- **Status:** Planned
- **Depends on:** None
- **Phase integrator:** Unassigned
- **PRD coverage:** Sections 10, 12, 15, 16

## Outcome

Repository is safe, product decisions are explicit, baseline behavior is measurable, development Slack access exists, and downstream teams have stable contracts.

## Entry criteria

- [x] PRD exists.
- [x] Migration plan exists.
- [ ] Coordinator and phase integrator assigned.

## Parallel execution plan

- **PG-00A:** T000, T001, T002, and T003 may run concurrently; write scopes do not overlap.
- **PG-00B:** T004 starts only after T001 is merged. It consumes baseline and environment findings but may begin contract drafting while T002/T003 finish; phase cannot close until all tasks complete.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T000](../tasks/T000-REPOSITORY-SAFETY.md) | Completed | — | PG-00A | pi-coder | 730a415 |
| [T001](../tasks/T001-PRODUCT-DECISIONS.md) | Completed | — | PG-00A | claude-planner + pi-coder | ef7838e |
| [T002](../tasks/T002-BASELINE-BENCHMARK.md) | Completed | — | PG-00A | pi-coder-2 | 818734a |
| [T003](../tasks/T003-SLACK-DEV-ENVIRONMENT.md) | Completed | — | PG-00A | pi-coder-3 | 090e8ad |
| [T004](../tasks/T004-ARCHITECTURE-CONTRACTS.md) | Completed | T001 | PG-00B | claude-planner | 151dc00 |

## Integration procedure

1. Integrate PG-00A tasks in any order after scope review.
2. Update decisions before accepting T004.
3. Integrate T004 last.
4. Recheck repository for secrets/data before opening P01.

## Exit criteria

- [ ] Secret/data hygiene checks pass.
- [ ] D001–D010 required outcomes are accepted or explicitly deferred with owners.
- [ ] Benchmark corpus and baseline report exist.
- [ ] Development Slack app/channel is usable.
- [ ] Resource, event, storage, retrieval, and authorization contracts are documented.
- [ ] P01 tasks can implement without inventing product policy.

## Phase verification

```bash
git diff --check
npm test
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
