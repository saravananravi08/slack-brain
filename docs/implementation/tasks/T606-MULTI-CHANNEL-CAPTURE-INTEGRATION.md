# T606 — Integrate multi-channel capture runtime

- **Status:** Completed
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** pi coding agent
- **Branch:** `task/T606-integrate-multi-channel-capture-runtime`
- **Parallel group:** PG-06C
- **Depends on:** T602, T603, T604, T605
- **Blocks:** T607
- **Can run parallel with:** —
- **Conflicts with:** Shared runtime/channel/security changes
- **Task log:** [`../logs/T606.md`](../logs/T606.md)
- **Write scope:**
  - `src/config.ts`
  - `src/security/**`
  - `src/mastra/channels/**`
  - `src/mastra/index.ts`
  - `tests/config/**`
  - `tests/security/**`
  - `tests/channels/**`
  - `tests/integration/channel-memory-capture/**`
- **Read-only references:** T601–T605 outputs; existing foundation/live integration tests.

## Objective

Wire membership-authoritative multi-channel enrollment, all-message capture, direct outgoing persistence, response filtering, and edit handling into the live Socket Mode runtime.

## Deliverables

- Runtime composition for P06 components.
- Dynamic joined-channel authorization replacing static capture-only assumptions.
- Direct persistence of Gist outbound messages.
- Integration tests for two channels and every sender class.

## Required procedure

Follow repository task workflow; integrate only merged dependencies, use isolated worktree, maintain task log, and run full scoped regression.

## Implementation steps

1. Connect verified Slack join/leave lifecycle to registry.
2. Authorize capture by active membership and internal-workspace policy.
3. Route every message to capture before response eligibility is considered.
4. Persist outgoing Gist messages once without relying on event echo.
5. Route edits and ignore live deletes under D015.
6. Expose content-free capture/edit metrics.

## Verification

```bash
npm run typecheck
npm run test:ingestion
npm test -- tests/channels tests/security tests/integration/channel-memory-capture
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [x] Two joined channels capture concurrently and remain isolated.
- [x] Every sender class is stored.
- [x] Only authorized human-addressed input triggers a Gist response.
- [x] Gist output is stored exactly once.
- [x] No history-backfill service is introduced.
- [x] Existing DM boundaries remain unchanged.

## Completion record

- Implementation commit: `8403b3e`
- Handoff commit: this commit (`docs(T606): hand off multi-channel capture runtime`)
- Merge commit: `7fd43b5`
- Integration metadata commit: docs(P06) complete T606 metadata commit
- Completed at: 2026-08-31
