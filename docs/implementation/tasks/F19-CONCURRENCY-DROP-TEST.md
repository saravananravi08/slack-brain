# F19 — Pin ambient same-thread concurrency-drop behavior

- **Status:** Ready for Integration
- **Owner:** pi coding agent
- **Branch:** `fix/security-f19-test`
- **Source finding:** F-19, Medium, Data loss
- **Task log:** [`../logs/F19.md`](../logs/F19.md)
- **Write scope:**
  - `tests/**`
  - `docs/implementation/tasks/F19-CONCURRENCY-DROP-TEST.md`
  - `docs/implementation/logs/F19.md`

## Objective

Pin the current defective Chat SDK `concurrency: 'drop'` behavior for ambient ingestion without changing production behavior. A reply arriving while its root turn is in flight on the same Slack thread must be measured as dropped and absent from persistence.

## Constraints

- Dispatch both payloads before awaiting: root at timestamp `T`, then reply with `thread_ts: T`.
- Hold the first persistence call open so the same-thread lock remains in flight.
- Assert the reply is not stored.
- Do not fix or reconfigure concurrency. The design decision is deferred to T502.
- Do not edit package files, `STATUS.md`, `EXECUTION_LOG.md`, or phase files.

## Completion

- [x] Real Slack adapter and Chat dispatch receive both same-thread payloads before any await.
- [x] Controlled persistence promise keeps the root turn in flight.
- [x] Regression asserts SDK `LOCK_FAILED` and persistence of root `T` only.
- [x] Production behavior is unchanged.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes: 36 files passed, 2 skipped; 542 tests passed, 2 skipped, 4 todo.
- [x] Scope and whitespace checks pass.

## Commit record

- Implementation: —
- Handoff metadata: —
- Merge: —
