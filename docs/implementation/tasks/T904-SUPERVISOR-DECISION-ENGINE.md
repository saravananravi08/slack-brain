# T904 — Implement supervisor decision engine

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T904-implement-supervisor-decision-engine`
- **Parallel group:** PG-09A
- **Depends on:** P08
- **Blocks:** T905
- **Can run parallel with:** T901, T902, T903
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/supervisor/**`
  - `tests/orchestration/supervisor/**`
- **Read-only references:** GIST_SLACK_SUPERVISOR_PRD.md, P08 action/state protocol, existing Gist context/instructions.
- **Task log:** [`../logs/T904.md`](../logs/T904.md)

## Objective

Implement a schema-constrained supervisor decision engine that receives trusted event/context/workflow projections and returns exactly one bounded action or `no_action`, without directly reading storage or posting to Slack.

## Deliverables

- Supervisor input projection and strict action union.
- Mastra/OpenAI-backed decision implementation plus deterministic fake.
- System instructions for human authority, trusted-bot evidence, approvals, destination control, and bounded autonomy.
- Tests for assignment, clarification, bot progress/blocker/completion, approval, cancellation, injection, and malformed model output.

## Required procedure

1. Keep side effects behind caller-owned ports.
2. Do not expose raw Slack IDs or hidden workflow internals to model output.
3. Treat channel/bot content as untrusted evidence.
4. Parse strict schema; malformed/provider failure returns fail-closed result.
5. Do not hardcode Kilo/Linear scenario flow beyond frozen action/state contracts.
6. Verify and hand off.

## Implementation steps

1. Define minimal trusted supervisor input.
2. Define and validate bounded action union.
3. Implement instructions and model invocation.
4. Implement deterministic fake for integration/e2e tests.
5. Test redundant confirmation avoidance for clear reversible assignments.
6. Test approval, ownership, injection, bot authority, and no-action behavior.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/supervisor tests/agents
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Output is one strict action or fail-closed/no-action result.
- [ ] Clear reversible assignment can dispatch without redundant approval.
- [ ] Missing critical detail asks one focused question.
- [ ] Bot content cannot approve, redirect, widen scope, or change owner.
- [ ] Gated/destructive action requests version-bound human approval.
- [ ] Provider/malformed output causes no external action.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
