# T802 — Prove Kilo and Linear bot compatibility

- **Status:** Blocked
- **Phase:** [P08](../phases/P08-SLACK-AUTOMATION-CONTRACTS.md)
- **Owner:** pi-t802-compatibility
- **Branch:** `task/T802-prove-kilo-linear-bot-compatibility`
- **Parallel group:** PG-08B
- **Depends on:** T801; operator-approved test channel and bot access
- **Blocks:** T803, P09
- **Can run parallel with:** None
- **Conflicts with:** Live Gist process; exactly one Socket Mode/runtime writer may run
- **Write scope:**
  - `scripts/probes/slack-bot-compatibility.ts`
  - `tests/spikes/slack-bot-compatibility/**`
  - `docs/spikes/slack-bot-compatibility.md`
  - `docs/reports/slack-bot-compatibility.md`
- **Read-only references:** T801 contracts, Slack runbook, current adapter/runtime, trusted-bot configuration.
- **Task log:** [`../logs/T802.md`](../logs/T802.md)

## Objective

Prove with sanitized live evidence that exact Kilo and Linear identities receive Gist-authored Slack instructions and return replies that can be deterministically correlated to the intended thread/workflow.

## Deliverables

- Re-runnable content-safe probe/harness.
- Offline fixtures for accepted/rejected response shapes.
- Sanitized Kilo/Linear compatibility report with independent GO/NO-GO rows.
- Measured thread, mention, reply, retry, error, and completion behavior.

## Required procedure

1. Confirm T801 is merged and compatibility fields are frozen.
2. Coordinate human/operator Slack actions; never fake human or bot identity.
3. Stop any duplicate Gist process before live probe.
4. Check credential presence/count only; never print values.
5. Use disposable content and aliases only.
6. Capture aggregate booleans/counts; delete raw payload/log/message notes after review.
7. A bot path is NO-GO if it ignores Gist-authored messages or cannot correlate replies.
8. Do not add direct connectors or modify production source.
9. Verify, commit, and hand off.

## Implementation steps

1. Build synthetic probe tests for expected routing/correlation observations.
2. Send one Gist-authored instruction to Kilo and one to Linear through approved Slack transport.
3. Measure whether each bot receives, replies, threads, retries, and reports success/error distinctly.
4. Test one duplicate instruction marker and one unrelated bot message without causing real work.
5. Record only aggregate evidence and final per-bot decision.

## Verification

```bash
npm run typecheck
npm test -- tests/spikes/slack-bot-compatibility
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Kilo Gist-authored-message acceptance is proven GO or explicit NO-GO.
- [ ] Linear Gist-authored-message acceptance is proven GO or explicit NO-GO.
- [ ] Reply thread/correlation behavior is measured, not assumed.
- [ ] Duplicate/error/completion behavior is documented content-free.
- [ ] Raw evidence is deleted and no IDs/content/tokens are committed.
- [ ] P09 is blocked for any failed bot path.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
