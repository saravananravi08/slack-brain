# P03 — Historical Slack Migration

- **Status:** Planned
- **Depends on:** P02
- **Phase integrator:** Unassigned
- **PRD coverage:** FR-MEM-005–013, Section 10

## Outcome

Approved historical Slack messages are imported idempotently into Mastra-owned memory/retrieval with preserved identity, timestamps, thread structure, audit reports, and accepted recall quality.

## Entry criteria

- [ ] P02 completed.
- [ ] D003, D004, D005, D009, and D010 resolved.
- [ ] Source database backed up and mounted read-only.

## Parallel execution plan

1. **PG-03A:** T301 defines immutable import contract and fixtures.
2. **PG-03B:** T302, T303, and T304 run concurrently after T301; source reader, mapper, and writer paths do not overlap.
3. **PG-03C:** T305 integrates those components.
4. **PG-03D:** T306 evaluates sample import.
5. **PG-03E:** T307 full import starts only after explicit sample approval.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T301](../tasks/T301-IMPORT-CONTRACT.md) | Completed | P02 | PG-03A | pi-coder-8 | f50438e |
| [T302](../tasks/T302-SOURCE-READER.md) | Planned | T301 | PG-03B | Unassigned | — |
| [T303](../tasks/T303-MESSAGE-MAPPING.md) | Planned | T301 | PG-03B | Unassigned | — |
| [T304](../tasks/T304-MEMORY-WRITER.md) | Planned | T201, T301 | PG-03B | Unassigned | — |
| [T305](../tasks/T305-IMPORT-ORCHESTRATION.md) | Planned | T302–T304 | PG-03C | Unassigned | — |
| [T306](../tasks/T306-SAMPLE-IMPORT.md) | Planned | T205, T305 | PG-03D | Unassigned | — |
| [T307](../tasks/T307-FULL-IMPORT.md) | Planned | T306 + approval | PG-03E | Unassigned | — |

## Integration procedure

- Never test against the only source database copy.
- Merge component tasks before orchestration.
- Sample import report and approval must be committed before T307 starts.
- Full imported data and generated reports containing Slack content stay outside Git.

## Exit criteria

- [ ] Import rerun creates no duplicates.
- [ ] Counts reconcile or every difference is explained.
- [ ] Sender/date/thread metadata sample is correct.
- [ ] Recall benchmark meets PRD thresholds.
- [ ] Unknown questions remain grounded.
- [ ] Source archive remains available for rollback.

## Phase verification

```bash
npm run typecheck
npm test
npm run test:migration
npm run benchmark:retrieval -- --dataset benchmark/history
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
