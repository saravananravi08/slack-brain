# T706 — Validate channel intelligence end to end

- **Status:** Planned
- **Phase:** [P07](../phases/P07-CHANNEL-CONTEXT.md)
- **Owner:** Unassigned
- **Branch:** `task/T706-validate-channel-intelligence-end-to-end`
- **Parallel group:** PG-07D
- **Depends on:** T705
- **Blocks:** Future orchestrator phase
- **Can run parallel with:** —
- **Conflicts with:** Live Slack/provider validation environment
- **Task log:** [`../logs/T706.md`](../logs/T706.md)
- **Write scope:**
  - `tests/e2e/channel-context/**`
  - `docs/reports/channel-context-validation.md`
- **Read-only references:** P07 outputs, GIST_CHANNEL_MEMORY_PRD.md.

## Objective

Prove that Gist answers from history, summary, and observations first; uses semantic search for older evidence; and leaks no context across two live channels.

## Deliverables

- Offline acceptance suite for CM-AC-08…11.
- Live two-channel context and semantic-fallback procedure.
- Sanitized gate report with observation/tool metrics and no message content.

## Required procedure

Follow repository task workflow; never commit real IDs, messages, prompts, model outputs, credentials, databases, or traces.

## Implementation steps

1. Seed distinct recent and old facts in two channels.
2. Verify recent answer path without semantic tool use.
3. Verify rolling summary and observation context.
4. Verify old-detail semantic tool call with citation.
5. Edit an observed source and verify refreshed derived context.
6. Force observation failure and verify history fallback.
7. Probe cross-channel extraction and require zero evidence.

## Verification

```bash
npm run typecheck
npm run test:e2e
npm test -- tests/e2e/channel-context
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [ ] CM-AC-08…11 pass offline and in live approved channels.
- [ ] Context order and semantic-tool usage match policy.
- [ ] Edit refresh and observation failure behavior pass.
- [ ] Zero cross-channel leakage is observed.
- [ ] Report contains aggregate/content-free evidence only.
- [ ] P07 receives explicit GO/NO-GO for orchestrator reuse.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
