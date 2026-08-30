# Live ingestion validation report

- **Task:** T406
- **Branch:** `task/T406-validate-live-ingestion-end-to-end`
- **Date:** 2026-08-30
- **Gate:** **GO — Ready for Integration**
- **Data posture:** Live evidence records sanitized states and counts only; no real Slack content, identifiers, credentials, database rows, traces, prompts, or model output retained.

## Results matrix

| Case | Execution boundary | Persistence | Model calls | Slack posts | Result |
|---|---|---:|---:|---:|---|
| Approved ambient root | Real pinned Slack adapter/Chat, synthetic envelope, stub persistence | 1 | 0 | 0 | Pass |
| Approved ambient reply | Real pinned Slack adapter/Chat, synthetic envelope, stub persistence | 1 | 0 | 0 | Pass |
| Bot message exclusion | Real pinned Slack adapter/Chat, synthetic envelope | 0 | 0 | 0 | Pass |
| Live bot/app message exclusion | Test workspace Socket Mode | 0 | 0 | 0 | Pass; app-authored event filtered with no Gist post |
| Unapproved-channel exclusion | Real pinned Slack adapter/Chat, synthetic envelope | 0 | 0 | 0 | Pass; no content-dedupe claim |
| Root/reply storage identity | Real OpenAI embeddings + temporary libSQL | 2 | 0 | 0 | Pass; one resource and root thread |
| Paraphrased recall and citation | Real OpenAI embeddings + `gpt-4.1` | n/a | 1 addressed call | 0 | Pass |
| Edit propagation | Real OpenAI embeddings + temporary libSQL | In-place update | 0 | 0 | Pass; one replacement embedding |
| Edit replay | Real OpenAI embeddings + temporary libSQL | No-op | 0 | 0 | Pass |
| Delete propagation | Temporary libSQL message/vector stores | Hard delete | 0 | 0 | Pass; content-free tombstone |
| Delete replay / late original | Temporary libSQL message/vector stores | No-op / suppressed | 0 | 0 | Pass |
| Channel boundary isolation | Real OpenAI retrieval over two synthetic channel resources | n/a | 1 addressed call | 0 | Pass; conflicting second-channel evidence excluded |
| Live human ambient delivery | Test workspace Socket Mode | 1 | 0 | 0 | Pass; one exact row and one vector entry from a plain human root |
| Live Slack edit delivery | Test workspace Socket Mode + live OpenAI vector | In-place update | 0 | 0 | Pass; exact row replaced and single vector matches edited text |
| Live Slack delete delivery | Test workspace Socket Mode | Hard delete | 0 | 0 | Pass; target row/vector absent and content-free tombstone present |
| Older human message recall | Real live memory + temporary-snapshot `gpt-4.1` invocation | 0 matching rows | 1 validation call | 0 | Expected negative; zero evidence and exact unverified fallback |
| Live boundary isolation | Real live memory, source and alternate resource queries | 1 source / 0 alternate | 0 | 0 | Pass; persisted target recalled only in source with complete citation metadata |
| Live addressed Slack recall/reply | Test workspace Socket Mode + `gpt-4.1` | 1 cited source row | 1 | 1 | Pass; relevant grounded answer with sender/date citation |

## Verification

- `npm run typecheck` — pass on final tree.
- `npm run test:ingestion` — 104/104 pass at recorded checkpoint.
- `npm run test:e2e` — ambient 4/4 and opt-in real-provider 2/2 pass at recorded checkpoints.
- Opt-in real-provider suite — 2/2 pass; rerun on latest integration after live runtime launch.
- Final full regression — 37 files passed, 1 skipped; 550 tests passed, 2 provider tests skipped; zero TODOs.
- `git diff --check` — pass at recorded checkpoints.
- Live runtime preflight — Socket Mode ready; isolated live database remained at zero messages through a 30-second post-connect observation window.
- Live bot/app exclusion — exact event persisted 0 rows and produced 0 Gist posts.
- Older human event recall — 0 source citations; real `gpt-4.1` Gist returned the exact unverified fallback from a temporary live-DB snapshot.
- Older pre-connection alternate-boundary query — 0 citations; not credited because source storage was also 0.
- Live human addressed probe before token rotation — history saw an eligible mention; runtime recorded 0 state entries, spans, messages, or replies.
- Live human ambient probe after token rotation — 1 message envelope, 1 exact row, 1 vector entry, 0 generation calls, 0 Slack posts.
- Live persisted-source recall — exactly 1 target citation with sender/date metadata in source boundary; 0 target citations in alternate boundary.
- Pre-fix live Slack addressed attempts — real mention handler entered, but generation/post counts remained 0 due encoded/raw channel identity mismatch.
- Encoded-channel regression — focused foundation suite 4/4 pass; typecheck pass.
- Live edited source — same exact row, non-null edit timestamp, one replacement vector matching current Slack text.
- Post-fix live recall — mention received through Socket Mode; target present in 5 source citations; sender/date citation present; non-fallback grounded response posted once; all source citations remained in boundary; alternate target count 0.
- Live deletion — 2 `message_deleted` envelopes observed; exact ambient target row count 0; exact target vector count 0; target tombstone present with valid date and content-free key/date-only structure.
- Residual vector count after target deletion — 8, all from addressed validation conversation rows; exact deleted target filter returned 0.

## Live execution notes

Provider credentials are no longer blocked after accepted D012: generation and embeddings use OpenAI through the existing `OPENAI_API_KEY`.

The remaining gap is transport-level proof with an eligible human author. Bot-token posts are intentionally excluded as own/bot traffic and cannot stand in for an ambient human message. The first supplied operator message was posted before any Gist Socket Mode process was active; after the runtime connected, no retry arrived during the observed 30-second window and storage remained empty. A supplied fresh event arrived while connected, but Slack history identifies it as app-authored (`bot_id` and `app_id` present, no `client_msg_id`), so FR-SLK-009 correctly excluded it. A separately nominated older event is eligible human ambient traffic, but it is a thread reply that predates runtime readiness by 3,849 seconds and has zero matching persisted rows. Replaying Web API history through the adapter would fabricate the transport evidence, so it was not done.

The operator sequence completed all four steps:

1. Fresh ordinary root persisted silently — pass.
2. Paraphrased addressed question recalled/cited the source — pass after channel-ID normalization.
3. Root edit replaced the row and embedding — pass.
4. Root deletion hard-deleted the exact row/vector and left a content-free tombstone — pass.

A subsequent app-authored event was correctly excluded with zero persistence and zero Gist posts, providing a successful live negative case. Querying the older eligible human event against live memory returned zero citations; a real Gist invocation over a temporary live-database snapshot returned the exact unverified fallback. Alternate-boundary retrieval also returned zero, but that is not credited as boundary isolation because the source record is absent globally.

A newer eligible human message was posted after runtime readiness. It mentioned Gist, making it addressed rather than ambient. Slack history and `users.info` confirm an eligible active full member, but the runtime recorded no incoming-event evidence, state, spans, messages, or reply. App and bot tokens are paired to the same Slack app; the app is a probe-channel member and has the required `channels:history`, `app_mentions:read`, `users:read`, and `chat:write` scopes; Socket Mode remains connected without logged warnings/errors. An operator-provided app-configuration screenshot confirms both `app_mention` and `message.channels` bot event subscriptions. To eliminate a competing Socket Mode consumer, the operator rotated/revoked the old app-level token and the validation runtime restarted successfully with the new same-app token. A fresh post-rotation plain human root then traversed real Socket Mode, created one exact message row and one vector entry, and invoked zero generation calls and zero Slack posts. Positive live silent ingestion is confirmed.

Positive live silent ingestion, edit re-embedding, addressed recall/citation, grounded generation, and non-vacuous boundary isolation now pass. The operator-authorized source fix normalizes pinned Chat's adapter-qualified `thread.channelId` to the raw Slack channel before security policy and identity resolution; mismatched third values still fail closed.

All T406 runtime gates now pass: eligible live ambient persistence, bot/app exclusion, zero ambient generation/posts, edit re-embedding, addressed recall with citation, grounded response, channel isolation, and target-scoped hard deletion with content-free tombstone. Temporary live storage, runtime logs, and instrumentation were deleted after recording sanitized evidence. T406 is **GO — Ready for Integration**.
