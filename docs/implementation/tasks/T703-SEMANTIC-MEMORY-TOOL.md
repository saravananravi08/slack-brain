# T703 — Implement scoped semantic memory tool

- **Status:** Planned
- **Phase:** [P07](../phases/P07-CHANNEL-CONTEXT.md)
- **Owner:** Unassigned
- **Branch:** `task/T703-implement-semantic-memory-tool`
- **Parallel group:** PG-07A
- **Depends on:** P06, D017 accepted
- **Blocks:** T704, T705
- **Can run parallel with:** T701, T702
- **Conflicts with:** None under declared scope
- **Task log:** [`../logs/T703.md`](../logs/T703.md)
- **Write scope:**
  - `src/mastra/tools/channel-memory-search.ts`
  - `tests/tools/channel-memory-search.test.ts`
- **Read-only references:** Gist memory citation recall, security boundary policy, Mastra tool API.

## Objective

Expose semantic channel recall as one Gist-only tool whose scope is derived from authorized runtime context and cannot be supplied by the model.

## Deliverables

- `search_channel_memory` tool.
- Typed bounded query/result schema with attribution.
- Boundary, malformed-context, retrieval-failure, and prompt-injection tests.

## Required procedure

Follow repository task workflow; add no unrelated tools or dependencies.

## Implementation steps

1. Accept query text and bounded limit only.
2. Resolve workspace/channel boundary from trusted request context.
3. Call citation-aware resource-scoped recall.
4. Return sender/date/text evidence without internal IDs.
5. Fail closed and content-free when context or retrieval is unavailable.

## Verification

```bash
npm run typecheck
npm test -- tests/tools/channel-memory-search.test.ts
npm test -- tests/security tests/memory
git diff --check
```

## Acceptance criteria

- [ ] Tool has no channel/workspace/scope input controlled by model.
- [ ] Results never cross active channel.
- [ ] Results retain sender/date attribution.
- [ ] Untrusted retrieved content cannot redefine tool or system policy.
- [ ] No shell, generic search, or extra agent tool is introduced.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
