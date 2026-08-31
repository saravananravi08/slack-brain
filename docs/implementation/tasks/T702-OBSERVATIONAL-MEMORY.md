# T702 — Enable channel-scoped Observation Memory

- **Status:** Planned
- **Phase:** [P07](../phases/P07-CHANNEL-CONTEXT.md)
- **Owner:** Unassigned
- **Branch:** `task/T702-enable-channel-observation-memory`
- **Parallel group:** PG-07A
- **Depends on:** P06, T605
- **Blocks:** T704
- **Can run parallel with:** T701, T703
- **Conflicts with:** Gist memory configuration
- **Task log:** [`../logs/T702.md`](../logs/T702.md)
- **Write scope:**
  - `src/mastra/memory/gist-memory.ts`
  - `src/channel-memory/observations/**`
  - `tests/memory/observation-memory/**`
  - `tests/channel-memory/observations/**`
- **Read-only references:** Mastra Memory APIs, P06 exact messages, CM-FR-022…026.

## Objective

Enable asynchronous per-channel observational memory and rolling summaries without blocking exact capture or posting to Slack.

## Deliverables

- Channel-scoped Observation Memory configuration/processor.
- Rolling summary and observation access interface.
- Source attribution where supported, edit-refresh behavior, failure isolation, and multi-channel tests.

## Required procedure

Follow repository task workflow. Verify pinned Mastra behavior before implementation; stop and record a blocker if resource-scoped observations cannot be enforced safely.

## Implementation steps

1. Pin observations to the channel resource, never caller-controlled scope.
2. Trigger consolidation asynchronously from persisted channel messages.
3. Produce compact summary plus decisions/work/questions/conventions/outcomes.
4. Ensure model/observer failure does not fail exact capture.
5. Refresh or invalidate derived stale text after edits.
6. Emit content-free observation lag/failure metrics.

## Verification

```bash
npm run typecheck
npm test -- tests/memory/observation-memory tests/channel-memory/observations
npm test -- tests/memory
git diff --check
```

## Acceptance criteria

- [ ] Observation Memory is enabled per channel.
- [ ] Two channels produce isolated summaries/observations.
- [ ] Bot/app authors remain distinguishable in derived context.
- [ ] No background observation posts to Slack.
- [ ] Observation failure leaves exact capture healthy.
- [ ] Edited source is eventually reflected without known stale quotation.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
