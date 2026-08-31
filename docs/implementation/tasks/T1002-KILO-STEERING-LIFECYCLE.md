# T1002 — Implement Kilo execution and review steering

- **Status:** Planned
- **Phase:** [P10](../phases/P10-BOT-STEERED-WORKFLOWS.md)
- **Owner:** Unassigned
- **Branch:** `task/T1002-implement-kilo-steering-lifecycle`
- **Parallel group:** PG-10A
- **Depends on:** P09
- **Blocks:** T1004
- **Can run parallel with:** T1001, T1003
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/policies/kilo-steering.ts`
  - `tests/orchestration/policies/kilo-steering.test.ts`
- **Read-only references:** PRD Kilo requirements, T802 measured behavior, P09 contracts/engine.
- **Task log:** [`../logs/T1002.md`](../logs/T1002.md)

## Objective

Implement the policy projection that turns Kilo progress, blocker, failure, PR, review, findings, and fix outcomes into generic supervisor actions while preserving human authority and requiring a fresh review instruction where configured.

## Deliverables

- Pure Kilo steering policy.
- Measured-response-shape interpretation rules from T802.
- Tests for implementation, blocker, follow-up, PR, fresh review, findings, fixes, completion, duplicate, and malformed replies.

## Required procedure

1. Use only response features proven by T802; do not infer unsupported Kilo APIs.
2. Keep policy pure; T1004 integrates it.
3. Kilo cannot authorize scope expansion, merge, release, destructive work, or ownership change.
4. PR existence alone does not complete work.
5. Distinguish fresh review dispatch from implementation continuation.
6. Verify and hand off.

## Implementation steps

1. Define Kilo outcome categories from measured Slack behavior.
2. Map outcomes/states to generic supervisor actions.
3. Implement blocker and human-escalation policy.
4. Implement PR→fresh review→findings→fix→acceptance transitions.
5. Add duplicate/replay/malformed/injection tests.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/policies/kilo-steering.test.ts
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Kilo progress/blocker/failure/completion outcomes map deterministically.
- [ ] PR result triggers configured review/acceptance path, not automatic completion.
- [ ] Review findings route to bounded fixes and re-verification.
- [ ] Kilo cannot approve or widen work.
- [ ] Duplicate/malformed/unexpected replies produce no duplicate action.
- [ ] Policy has no Slack/storage/model side effect.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
