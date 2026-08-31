# T1001 — Implement human assignment and approval lifecycle

- **Status:** Planned
- **Phase:** [P10](../phases/P10-BOT-STEERED-WORKFLOWS.md)
- **Owner:** Unassigned
- **Branch:** `task/T1001-implement-human-assignment-lifecycle`
- **Parallel group:** PG-10A
- **Depends on:** P09
- **Blocks:** T1004
- **Can run parallel with:** T1002, T1003
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/policies/human-assignment.ts`
  - `tests/orchestration/policies/human-assignment.test.ts`
- **Read-only references:** PRD intake/approval requirements, P09 supervisor engine/contracts.
- **Task log:** [`../logs/T1001.md`](../logs/T1001.md)

## Objective

Implement the policy projection for general human assignments, clarification, status, correction, pause/resume, cancellation, ownership transfer, and version-bound approval without creating a second workflow engine.

## Deliverables

- Pure human-assignment policy used by the generic supervisor.
- Tests for clear assignment, ambiguity, active-thread continuation, approval, scope change, cancellation, and unauthorized human.

## Required procedure

1. Keep policy pure and within scope; T1004 integrates it.
2. A clear reversible assignment must not ask redundant confirmation.
3. Ask only for materially missing/ambiguous details.
4. Merge/release/destructive/irreversible actions require owner approval.
5. Scope change invalidates prior approval.
6. Verify and hand off.

## Implementation steps

1. Define human intent/policy inputs and outputs matching P09 actions.
2. Implement new-work and active-workflow rules.
3. Implement owner/approval/cancel/transfer rules.
4. Add table-driven synthetic tests.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/policies/human-assignment.test.ts
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Clear reversible assignment becomes ready/dispatchable.
- [ ] Missing critical detail asks one focused clarification.
- [ ] Active workflow correction/status/pause/resume behaves deterministically.
- [ ] Unauthorized human cannot materially mutate workflow.
- [ ] Gated action requires current version-bound owner approval.
- [ ] Policy has no Slack/storage/model side effect.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
