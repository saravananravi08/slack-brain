# T602 — Implement joined-channel registry

- **Status:** Planned
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** Unassigned
- **Branch:** `task/T602-implement-joined-channel-registry`
- **Parallel group:** PG-06B
- **Depends on:** T601
- **Blocks:** T606
- **Can run parallel with:** T603, T604, T605
- **Conflicts with:** None under declared scope
- **Task log:** [`../logs/T602.md`](../logs/T602.md)
- **Write scope:**
  - `src/channel-memory/registry/**`
  - `tests/channel-memory/registry/**`
- **Read-only references:** T601 contracts, existing Mastra storage and Slack adapter.

## Objective

Persist the set of internal Slack channels Gist has joined and expose fail-closed enrollment checks for capture and context access.

## Deliverables

- Durable channel registry using existing storage facilities.
- Join, leave/deactivate, rejoin, lookup, and list operations.
- Idempotency and restart tests.

## Required procedure

Follow repository task workflow; use isolated worktree, declared scope, task log, explicit commits, and all verification checks.

## Implementation steps

1. Define registry records keyed by workspace/channel.
2. Register only from verified bot-membership lifecycle input.
3. Deactivate capture on leave without deleting memory.
4. Support multiple active channels and restart persistence.
5. Return content-free operational results.

## Verification

```bash
npm run typecheck
npm test -- tests/channel-memory/registry
git diff --check
```

## Acceptance criteria

- [ ] Two joined channels remain distinct after restart.
- [ ] Duplicate join/rejoin is idempotent.
- [ ] Leave stops eligibility without deleting retained data.
- [ ] Unknown or malformed channels fail closed.
- [ ] Registry stores no message text or credentials.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
