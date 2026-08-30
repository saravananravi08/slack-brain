# P04 — Live Silent Channel Ingestion

- **Status:** Planned
- **Depends on:** P02; may develop alongside P03 after contracts stabilize
- **Phase integrator:** Unassigned
- **PRD coverage:** UJ4, FR-MEM-008, FR-SLK-008–010, FR-PRV-001–007

## Outcome

New human messages, replies, and accepted mutations from approved Slack channels are persisted into Mastra memory without model calls, replies, duplicates, or privacy leakage.

## Entry criteria

- [ ] P02 completed.
- [ ] D001, D004, D005, and D006 resolved.
- [ ] Adapter version pinned.

## Parallel execution plan

1. **PG-04A:** T401 runs first and commits a tested adapter event contract.
2. **PG-04B:** T402, T403, and T404 run concurrently against that contract.
3. **PG-04C:** T405 owns Slack/runtime integration files.
4. **PG-04D:** T406 validates end to end.

P04 component work may run in parallel with P03 component/import work because source paths differ. T501 waits for both phases.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T401](../tasks/T401-ADAPTER-EVENT-SPIKE.md) | Completed | T104, T206 | PG-04A | claude-planner-2 | 8ba694e |
| [T402](../tasks/T402-EVENT-NORMALIZATION.md) | Completed | T401 | PG-04B | claude-planner-2 | 4c615da |
| [T403](../tasks/T403-SILENT-PERSISTENCE.md) | Completed | T201, T202, T401 | PG-04B | pi-coder-10 | c3365cd |
| [T404](../tasks/T404-MUTATION-POLICY.md) | Completed | T001, T203, T401 | PG-04B | pi-coder-11 | 21f5d72 |
| [T405](../tasks/T405-LIVE-INTEGRATION.md) | Completed | T402–T404, T204 | PG-04C | pi-coder-12 | f64b2dc |
| [T406](../tasks/T406-LIVE-VALIDATION.md) | Planned | T405, T205 | PG-04D | Unassigned | — |

## Integration procedure

- Spike must prove supported event API; do not code against assumptions.
- Component tasks use fixtures, not live production data.
- T405 is the sole shared Slack composition writer.
- Verify zero generation-model calls for ambient messages before closing phase.

## Exit criteria

- [ ] Approved human messages persist silently.
- [ ] Bot/system/unapproved events do not pollute memory.
- [ ] Retries are idempotent.
- [ ] Thread identity and speaker metadata are preserved.
- [ ] Edit/delete behavior matches D005.
- [ ] No ambient event triggers a Gist response or model generation.

## Phase verification

```bash
npm run typecheck
npm test
npm run test:ingestion
npm run test:e2e -- --case ambient-message
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
