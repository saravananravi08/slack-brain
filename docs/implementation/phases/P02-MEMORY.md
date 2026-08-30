# P02 — Memory, Retrieval, and Privacy

- **Status:** Planned
- **Depends on:** P01
- **Phase integrator:** Unassigned
- **PRD coverage:** FR-CTX-001–005, FR-MEM-001–004/009–013, FR-PRV-001–009

## Outcome

Gist has durable Mastra memory, automatic semantic recall, deterministic channel/DM boundaries, enforced access policy, and measurable retrieval/privacy behavior.

## Entry criteria

- [ ] P01 completed.
- [ ] D002, D004, D006, D008, D009, and D010 resolved.

## Parallel execution plan

- **PG-02A:** T201, T202, T203, and T205 may run concurrently after dependencies merge. Each owns isolated files.
- **PG-02B:** T204 integrates memory/access into shared agent/channel/runtime files after T201–T203.
- **PG-02C:** T206 validates integrated behavior after T204 and T205.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T201](../tasks/T201-MEMORY-CONFIG.md) | Completed | T103, T105 | PG-02A | pi-coder-7 | af8fb8d |
| [T202](../tasks/T202-RESOURCE-POLICY.md) | Completed | T004, T106 | PG-02A | pi-coder-5 | a55ed56 |
| [T203](../tasks/T203-ACCESS-PRIVACY.md) | Completed | T004, T102, T104 | PG-02A | claude-planner-2 | 49751a4 |
| [T205](../tasks/T205-RETRIEVAL-BENCHMARK.md) | Planned | T002, T004 | PG-02A | Unassigned | — |
| [T204](../tasks/T204-MEMORY-INTEGRATION.md) | Planned | T201–T203, T106 | PG-02B | Unassigned | — |
| [T206](../tasks/T206-MEMORY-VALIDATION.md) | Planned | T204, T205 | PG-02C | Unassigned | — |

## Integration procedure

1. Merge PG-02A tasks one at a time.
2. T204 alone edits shared composition files.
3. T206 runs privacy tests before retrieval-quality tests.
4. Any cross-boundary leak blocks phase completion regardless of recall score.

## Exit criteria

- [ ] Memory survives restart.
- [ ] Same approved channel shares intended knowledge.
- [ ] Different channels and DMs remain isolated per accepted policy.
- [ ] Retrieval is automatic; no shell/search tool exists.
- [ ] Benchmark captures relevance, grounding, and latency.
- [ ] Traces show recalled context to authorized operators.

## Phase verification

```bash
npm run typecheck
npm test -- --runInBand
npm run test:memory
npm run benchmark:retrieval -- --dataset benchmark/sample
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
