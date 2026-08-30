# Live ingestion validation report

- **Task:** T406
- **Branch:** `task/T406-validate-live-ingestion-end-to-end`
- **Date:** 2026-08-30
- **Gate:** **NO-GO pending live Socket Mode operator sequence**
- **Data posture:** Synthetic test content only; no real Slack content, identifiers, credentials, database rows, traces, prompts, or model output retained.

## Results matrix

| Case | Execution boundary | Persistence | Model calls | Slack posts | Result |
|---|---|---:|---:|---:|---|
| Approved ambient root | Real pinned Slack adapter/Chat, synthetic envelope, stub persistence | 1 | 0 | 0 | Pass |
| Approved ambient reply | Real pinned Slack adapter/Chat, synthetic envelope, stub persistence | 1 | 0 | 0 | Pass |
| Bot message exclusion | Real pinned Slack adapter/Chat, synthetic envelope | 0 | 0 | 0 | Pass |
| Unapproved-channel exclusion | Real pinned Slack adapter/Chat, synthetic envelope | 0 | 0 | 0 | Pass; no content-dedupe claim |
| Root/reply storage identity | Real OpenAI embeddings + temporary libSQL | 2 | 0 | 0 | Pass; one resource and root thread |
| Paraphrased recall and citation | Real OpenAI embeddings + `gpt-4.1` | n/a | 1 addressed call | 0 | Pass |
| Edit propagation | Real OpenAI embeddings + temporary libSQL | In-place update | 0 | 0 | Pass; one replacement embedding |
| Edit replay | Real OpenAI embeddings + temporary libSQL | No-op | 0 | 0 | Pass |
| Delete propagation | Temporary libSQL message/vector stores | Hard delete | 0 | 0 | Pass; content-free tombstone |
| Delete replay / late original | Temporary libSQL message/vector stores | No-op / suppressed | 0 | 0 | Pass |
| Channel boundary isolation | Real OpenAI retrieval over two synthetic channel resources | n/a | 1 addressed call | 0 | Pass; conflicting second-channel evidence excluded |
| Live human ambient delivery | Test workspace Socket Mode | Pending | Pending | Pending | Operator action required |
| Live Slack edit/delete delivery | Test workspace Socket Mode | Pending | Pending | Pending | Operator action required |
| Live addressed Slack recall/reply | Test workspace Socket Mode | Pending | Pending | Pending | Operator action required |

## Verification

- `npm run typecheck` — pass.
- `npm run test:ingestion` — 104/104 pass.
- `npm run test:e2e` — 4 runnable pass; 2 provider tests opt-in; 4 operator cases TODO.
- Opt-in real-provider suite — 2/2 pass.
- Full branch regression — 36 files / 538 tests pass; 2 provider tests skipped by default; 4 operator cases TODO.
- `git diff --check` — pass at recorded checkpoints.

## Limitations and remaining gate

Provider credentials are no longer blocked after accepted D012: generation and embeddings use OpenAI through the existing `OPENAI_API_KEY`.

The remaining gap is transport-level proof with an eligible human author. Bot-token posts are intentionally excluded as own/bot traffic and cannot stand in for an ambient human message. The operator must perform this sanitized sequence while the runtime is connected:

1. Post an ordinary root and unaddressed reply in the probe channel.
2. Edit the root, then ask a paraphrased addressed question.
3. Delete the root.

Final approval requires observing: one persisted root and reply, zero ambient model/post calls, one addressed generation/reply, edited recall replacing prior content, hard deletion of message/vector, and no cross-boundary retrieval. Until that sequence is recorded, P04 live ingestion remains **NO-GO** despite all offline and real-provider checks passing.
