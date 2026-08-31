# T607 — Validate complete multi-channel capture

- **Status:** Ready for Integration
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** T607 agent
- **Branch:** `task/T607-validate-complete-multi-channel-capture`
- **Parallel group:** PG-06D
- **Depends on:** T606
- **Blocks:** P07
- **Can run parallel with:** —
- **Conflicts with:** Live Slack validation environment
- **Task log:** [`../logs/T607.md`](../logs/T607.md)
- **Write scope:**
  - `tests/e2e/channel-memory-capture/**`
  - `docs/reports/channel-memory-capture-validation.md`
- **Read-only references:** P06 outputs and live Slack runbook.

## Objective

Prove complete post-join capture, response silence, edits, delete-ignore behavior, restart continuity, and isolation across two real internal Slack channels.

## Deliverables

- Offline acceptance matrix and live operator procedure.
- Sanitized validation report with aggregate evidence only.
- Regression tests covering CM-AC-01…07 and CM-AC-12.

## Required procedure

Follow repository task workflow; never commit real channel IDs, message text, tokens, databases, or raw logs.

## Implementation steps

1. Validate join/enrollment in two channels.
2. Post human, Gist, Kilo/app, root, reply, and retry cases.
3. Prove zero bot-triggered generation/replies.
4. Edit one source and verify row/vector replacement.
5. Delete one source and verify accepted retained state.
6. Restart and verify registry/data continuity; leave one channel and verify capture stops.

## Verification

```bash
npm run typecheck
npm run test:ingestion
npm test -- tests/e2e/channel-memory-capture
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [x] CM-AC-01…07 and CM-AC-12 pass offline; live operator steps remain pending.
- [x] Zero cross-channel records or responses are observed offline.
- [x] Offline capture and response counts match expected values.
- [x] Report skeleton contains no private content or identifiers.
- [x] P06 phase gate is explicitly Pending / NO-GO until live checklist completion.

## Resolved blocker

- T607 found that production delivery claims did not survive process re-composition. The coordinator assigned `fix/p06-durable-delivery-dedup`; durable LibSQL claims merged in `45d2cac`. T607 resumed against that integration commit and re-verifies restart suppression before handoff.

## Completion record

- Implementation commit: `37a717a`
- Handoff commit: this handoff commit
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
