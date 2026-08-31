# T705 — Integrate context with Gist agent

- **Status:** Planned
- **Phase:** [P07](../phases/P07-CHANNEL-CONTEXT.md)
- **Owner:** Unassigned
- **Branch:** `task/T705-integrate-context-with-gist-agent`
- **Parallel group:** PG-07C
- **Depends on:** T704, T703
- **Blocks:** T706
- **Can run parallel with:** —
- **Conflicts with:** Shared Gist agent/runtime/channel composition
- **Task log:** [`../logs/T705.md`](../logs/T705.md)
- **Write scope:**
  - `src/mastra/agents/**`
  - `src/mastra/channels/**`
  - `src/mastra/index.ts`
  - `tests/agents/**`
  - `tests/integration/channel-context/**`
- **Read-only references:** T703–T704 outputs, existing security and citation contracts.

## Objective

Provide default channel context to Gist and register the scoped semantic tool as the only memory-search fallback.

## Deliverables

- Agent/runtime context injection.
- `search_channel_memory` registration and usage instructions.
- Tests for context-first answers, semantic fallback, attribution, silence, and isolation.

## Required procedure

Follow repository task workflow; integrate only merged dependencies and run full regression because shared agent/runtime paths are touched.

## Implementation steps

1. Build channel context only after authorization.
2. Inject history, summary, and observations as untrusted evidence.
3. Register only the scoped semantic memory tool.
4. Instruct Gist to call it for older/missing evidence, not by default.
5. Preserve correct Slack thread routing and outgoing-message capture.

## Verification

```bash
npm run typecheck
npm test -- tests/agents tests/integration/channel-context
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Recent questions can be answered without semantic tool invocation.
- [ ] Older questions can invoke semantic fallback.
- [ ] Tool and injected context remain current-channel scoped.
- [ ] Historical claims preserve attribution.
- [ ] Bot/app capture still triggers no response.
- [ ] Existing DM isolation remains unchanged.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
