# T801 — Freeze Slack supervisor contracts

- **Status:** Ready for Integration
- **Phase:** [P08](../phases/P08-SLACK-AUTOMATION-CONTRACTS.md)
- **Owner:** claude-opus5
- **Branch:** `task/T801-freeze-slack-supervisor-contracts`
- **Parallel group:** PG-08A
- **Depends on:** D023–D029; channel-memory/context/proactive baseline `5fdf8e2`
- **Blocks:** T802
- **Can run parallel with:** None
- **Conflicts with:** T803 on contract paths; serialized by dependency
- **Write scope:**
  - `GIST_SLACK_SUPERVISOR_PRD.md` (requirements mapping/clarification only)
  - `docs/architecture/slack-supervisor/**`
  - `tests/contracts/slack-supervisor/**`
- **Read-only references:** `GIST_CHANNEL_MEMORY_PRD.md`, D013–D029, P06/P07 phase files, `src/mastra/channels/**`, `src/ingestion/**`.
- **Task log:** [`../logs/T801.md`](../logs/T801.md)

## Objective

Freeze versioned workflow, event, identity, state-transition, action, approval, dispatch, and failure contracts so workers can implement the supervisor without inventing policy or weakening existing capture/authorization boundaries.

## Deliverables

- Architecture contract set with version and requirements mapping.
- Synthetic contract fixtures and executable invariant tests.
- Explicit separation between exact message evidence, derived context, and authoritative workflow state.
- Exact human/trusted-bot/self/unknown-bot routing matrix.

## Required procedure

1. Confirm decisions and baseline are merged on the feature branch.
2. Create isolated task branch/worktree from `feature/gist-slack-bot-supervisor`.
3. Mark task/log In Progress.
4. Read current normalization, authorization, proactive, context, and outgoing-message paths completely.
5. Write contracts before implementation code exists.
6. Use only synthetic Slack-shaped identifiers/content.
7. Run verification, scope audit, secret scan, and `git diff --check`.
8. Commit implementation with T801 in subject; commit Ready for Integration metadata separately.
9. Never mark Completed; feature integrator owns merge/metadata.

## Implementation steps

1. Define workflow/action/event records and allowed state transitions.
2. Define sender routing and trusted identity precedence.
3. Define schema-valid supervisor action union and destination mapping rules.
4. Define approval versioning, ownership transfer, limits, timeout, restart, replay, and dispatch checkpoint rules.
5. Define Slack thread/workflow correlation requirements and compatibility measurements T802 must obtain.
6. Map every GS-FR/GS-NFR requirement to contract/tests or a later task.

## Verification

```bash
npm run typecheck
npm test -- tests/contracts/slack-supervisor
npm test -- tests/contracts/channel-memory tests/security/access
npm run build
git diff --check
```

## Acceptance criteria

- [x] All GS requirements are mapped exactly once to implementation/validation ownership.
- [x] Contracts prohibit model-controlled Slack IDs and bot-text authority.
- [x] Gist self is persist-only; trusted bots are evaluate-eligible; unknown bots are capture-only.
- [x] One event/one checkpointed external-action invariant is executable.
- [x] State transition, approval, duplicate, restart, and wrong-boundary cases are executable.
- [x] No production data or identifiers appear.

## Completion record

- Implementation commit: `df23b00eb10b9874aeafd0f9063bba4b6519a201`
- Review fix commit: `3a05f73d93c4a82de67f88f784020bdd2d499d3e` (closes the five integration-review defects; contract set stays at 1.0.0, pre-merge)
- Second review correction commit: `974a586c86be8e16f18820b8c440014c5f8763aa` (resolves seven contradictions found in the fix pack; contract set stays at 1.0.0, pre-merge)
- Third review correction commit: `07217e9c42a17785bba21814a6d3a0505a1fd1c3` (continuation crash-safety plus two stale contradictions; contract set stays at 1.0.0, pre-merge)
- Architecture correction commit: `b483552e8d869db6b76f3e15fe2e99c318dc2de1` (one durable command/outbox protocol; strict action schemas; bounded limit control; bound/unbound checkpoints; target identity alternatives; serial retries; complete compatibility outcome evidence)
- Focused re-review correction commit: `c0fa9afc1287019d67016edc5b826feeae7685f1` (intent-specific limit authority; full checkpoint schema validation; strict compatibility count shape; reopen unsupported pending product-owner decision)
- Final focused correction commit: `1a81af9a58b00f618e2609a6fa1af1bbf20daf28` (configured approvers cannot redirect; checkpoint failure/key/destination semantics closed)
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
