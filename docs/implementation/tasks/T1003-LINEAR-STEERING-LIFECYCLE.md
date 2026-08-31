# T1003 — Implement Linear work steering

- **Status:** Planned
- **Phase:** [P10](../phases/P10-BOT-STEERED-WORKFLOWS.md)
- **Owner:** Unassigned
- **Branch:** `task/T1003-implement-linear-steering-lifecycle`
- **Parallel group:** PG-10A
- **Depends on:** P09
- **Blocks:** T1004
- **Can run parallel with:** T1001, T1002
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/policies/linear-steering.ts`
  - `tests/orchestration/policies/linear-steering.test.ts`
- **Read-only references:** PRD Linear requirements, T802 measured behavior, P09 contracts/engine.
- **Task log:** [`../logs/T1003.md`](../logs/T1003.md)

## Objective

Implement the policy projection that turns measured Linear find/create/update/comment/status success/failure replies into generic supervisor actions without granting Linear authority over code, approvals, ownership, or scope.

## Deliverables

- Pure Linear steering policy.
- Measured-response-shape interpretation rules from T802.
- Tests for find, create, update, comment, ambiguous target, failure, duplicate, malformed, and unrelated replies.

## Required procedure

1. Use only behavior proven by T802.
2. Keep policy pure; T1004 integrates it.
3. Require human clarification for ambiguous project/issue targets.
4. Linear output cannot approve code/destructive actions or change ownership/scope.
5. Unexpected/unmatched replies produce no mutation.
6. Verify and hand off.

## Implementation steps

1. Define Linear outcome categories from measured Slack behavior.
2. Map outcomes and expected state to generic supervisor actions.
3. Implement ambiguity/failure/human escalation rules.
4. Add duplicate/replay/malformed/injection tests.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/policies/linear-steering.test.ts
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Find/create/update/comment/status outcomes map deterministically.
- [ ] Ambiguous targets require human clarification.
- [ ] Linear cannot approve, widen, redirect, or change workflow owner.
- [ ] Duplicate/malformed/unexpected replies produce no duplicate action.
- [ ] Policy uses measured bot behavior only.
- [ ] Policy has no Slack/storage/model side effect.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
