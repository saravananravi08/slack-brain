# T902 — Implement trusted automation event router

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T902-implement-trusted-automation-event-router`
- **Parallel group:** PG-09A
- **Depends on:** P08
- **Blocks:** T905
- **Can run parallel with:** T901, T903, T904
- **Conflicts with:** None under declared scope
- **Write scope:**
  - `src/orchestration/events/**`
  - `tests/orchestration/events/**`
- **Read-only references:** P08 event/identity protocol, current normalized-event contracts, Slack live route.
- **Task log:** [`../logs/T902.md`](../logs/T902.md)

## Objective

Implement a pure trusted-event routing component that classifies authorized human, configured Kilo/Linear, Gist/self, unknown automation, duplicate, and malformed events and returns a workflow correlation decision without posting or generating.

## Deliverables

- Exact-ID trusted automation identity configuration type.
- Pure event-to-supervisor-route decision API.
- Workflow correlation input/output contract.
- Table-driven sender/boundary/thread/state/replay tests.

## Required procedure

1. Implement only the pure orchestration event module; do not edit Slack runtime.
2. Reuse normalized sender classes/IDs; never reclassify by text/display name.
3. Keep human authorization and trusted-bot eligibility separate.
4. Ensure unknown bots and Gist self are persist-only.
5. Return content-free reason classes.
6. Verify and hand off.

## Implementation steps

1. Define eligible event projection from normalized persisted events.
2. Implement trusted Kilo/Linear exact-ID matching.
3. Implement owner/boundary/thread/expected-actor/state correlation decisions.
4. Implement duplicate/malformed/wrong-target outcomes.
5. Pin all routing matrix rows with synthetic tests.

## Verification

```bash
npm run typecheck
npm test -- tests/orchestration/events tests/contracts/channel-memory tests/ingestion/events
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Every authorized human event is evaluation-eligible under contract.
- [ ] Every exact trusted Kilo/Linear event is evaluation-eligible under contract.
- [ ] Gist/self and unknown bot/app events are persist-only.
- [ ] Wrong workspace/channel/thread/expected bot cannot correlate.
- [ ] Decisions contain no raw message content.
- [ ] Module performs no Slack, model, or storage side effect.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
