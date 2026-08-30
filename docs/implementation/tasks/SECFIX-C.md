# SECFIX-C — Resolve remaining low-severity security findings

- **Status:** Ready for Integration
- **Owner:** pi coding agent
- **Branch:** `fix/security-review-pack-c`
- **Source review:** [`../../security/design-review.md`](../../security/design-review.md)
- **Task log:** [`../logs/SECFIX-C.md`](../logs/SECFIX-C.md)
- **Write scope:**
  - `src/migration/mapping/tests/**`
  - `src/migration/mapping/dist/**`
  - `tests/migration/**`
  - `src/ingestion/mutations/**`
  - `src/mastra/memory/**`
  - `tests/ingestion/**`
  - `tests/memory/**`
  - this task/log metadata

## Objective

Resolve design-review findings F-11, F-13, F-14, and F-15 without changing release metadata or package configuration.

## Completion

- [x] F-11: mapping test moved from `src` to `tests/migration/mapping`; no tracked `src/migration/mapping/dist` directory existed.
- [x] F-13: retention and pending-mutation reconciliation stream one thread batch at a time.
- [x] F-14: real LibSQL regression confirms `updateResource` preserves unrelated resource metadata when tombstones are added.
- [x] F-15: caller-supplied semantic recall config cannot change recall scope from `resource`.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes: 35 files / 537 tests.
- [x] Scope and whitespace checks pass.

## Commit record

- Implementation: `1434a44051b8b0a81789b1171395b0c404c4afac`
- Handoff metadata: `ab57efe0e1f3b2a3fe4ba698c988a739bf83058c`
- Merge: —
