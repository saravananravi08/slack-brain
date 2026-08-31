# T603 — Normalize all message senders

- **Status:** Ready for Integration
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** pi-agent
- **Branch:** `task/T603-normalize-all-message-senders`
- **Parallel group:** PG-06B
- **Depends on:** T601
- **Blocks:** T606
- **Can run parallel with:** T602, T604, T605
- **Conflicts with:** None under declared scope
- **Task log:** [`../logs/T603.md`](../logs/T603.md)
- **Write scope:**
  - `src/ingestion/events/**`
  - `tests/ingestion/events/**`
- **Read-only references:** T601 event contract; existing Slack adapter spike and fixtures.

## Objective

Normalize human, Gist, Kilo, bot, and app messages into captureable channel events while independently preserving response-trigger exclusions.

## Deliverables

- All-sender normalized message contract implementation.
- Separate capture and response classifications.
- Root/reply, sender metadata, file/link metadata, retry, edit, and delete-event tests.

## Required procedure

Follow repository task workflow; use isolated worktree, declared scope, task log, explicit commits, and all verification checks.

## Implementation steps

1. Preserve sender class rather than skipping bot/app/own messages.
2. Keep addressed-response classification human-authorized only.
3. Normalize roots, replies, edits, and accepted delete-ignore events.
4. Preserve deterministic event/message identities.
5. Reject malformed events without generation or posting.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/events
git diff --check
```

## Acceptance criteria

- [x] Every sender class produces a capture event.
- [x] Bot/app/Gist/Kilo traffic never becomes a response trigger.
- [x] Root/reply identities remain deterministic.
- [x] Retries preserve delivery and message dedupe keys.
- [x] Existing human-message behavior remains covered.

## Completion record

- Implementation commit: `e0832fa72c2955a7e6489936fa8645f44dfe84ef`
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
