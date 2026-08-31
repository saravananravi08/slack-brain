# T604 — Persist all live channel messages

- **Status:** Ready for Integration
- **Phase:** [P06](../phases/P06-CHANNEL-CAPTURE.md)
- **Owner:** pi coding agent
- **Branch:** `task/T604-persist-all-live-channel-messages`
- **Parallel group:** PG-06B
- **Depends on:** T601
- **Blocks:** T606
- **Can run parallel with:** T602, T603, T605
- **Conflicts with:** None under declared scope
- **Task log:** [`../logs/T604.md`](../logs/T604.md)
- **Write scope:**
  - `src/ingestion/persistence/**`
  - `tests/ingestion/persistence/**`
- **Read-only references:** T601 storage contract; Gist memory/resource policy.

## Objective

Generalize silent persistence from human-only ambient text to every normalized channel message sender while retaining deterministic channel/thread identity and embedding behavior.

## Deliverables

- All-sender message persistence.
- Canonical sender/source metadata and available file/link metadata.
- Duplicate, conflict, retry, failure, and sender-class tests.

## Required procedure

Follow repository task workflow; use isolated worktree, declared scope, task log, explicit commits, and all verification checks.

## Implementation steps

1. Accept only T601 normalized capture records.
2. Persist all sender classes under the active channel resource.
3. Keep one deterministic row/vector per Slack message identity.
4. Preserve silent behavior: no response, typing, or workflow action.
5. Keep exact capture independent of generation/observation availability.

## Verification

```bash
npm run typecheck
npm test -- tests/ingestion/persistence
git diff --check
```

## Acceptance criteria

- [x] Human, Gist, Kilo, bot, and app fixtures persist.
- [x] Duplicate delivery creates no duplicate row/vector.
- [x] Capture invokes no response/post path.
- [x] Embedding/model failure cannot corrupt the canonical record.
- [x] Channel/thread/sender metadata is preserved.

## Completion record

- Implementation commit: `bdf4beb`
- Handoff commit: this handoff commit
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
