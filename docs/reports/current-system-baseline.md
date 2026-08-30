# Current Gist system baseline

- **Source snapshot:** `11de93a6f1b1` on `integration/mastra-rewrite`
- **Captured:** 2026-08-30
- **Method:** read-only source inspection plus safe local checks
- **Data policy:** no production workspace, archive, external service, or private message was accessed

This report inventories observable legacy behavior before the Mastra migration. It is not a production service-level report: the isolated worktree has no archive or installed runtime dependencies, and live credentials were intentionally not used.

## Behavior inventory

### Direct messages

- `bot.ts` handles non-bot, subtype-free DM text. Blank messages and DM file-only messages are ignored.
- It posts a temporary thinking message, runs the agent, then updates that message with one answer. This is not streamed answer content.
- Conversation continuity uses one in-memory session per user with a one-hour idle expiry.
- The same per-user session map is used by DMs and top-level mentions. It does not encode a DM/channel boundary.
- On failure, the user receives a short generic retry message. Internal exception details remain in process output.

### Channel mentions

- `app_mention` removes user mentions from input and responds under `event.thread_ts || event.ts`.
- A temporary thinking message is posted and later updated, so the normal path emits one final answer message.
- Top-level mentions resume the in-memory per-user session. Mention replies inside existing threads use a fresh agent session.
- Attached files are downloaded to a temporary local path, summarized by the generation process, indexed, and removed. This path is outside migration MVP scope.
- Poll-specific state and interactive behavior are in memory and outside migration MVP scope.

### Threads and follow-ups

- On a mention inside an existing thread, the bot requests up to 200 Slack replies, labels speakers, and prepends returned history to the agent input.
- If the Slack replies request fails, it silently continues without thread history.
- Existing-thread mentions always start a fresh agent session; continuity comes from the fetched Slack text, not durable agent state.
- Ordinary channel follow-ups without another mention are routed only to proactive evaluation and do not continue the user conversation.
- Archive thread lookup selects records whose `thread_ts` equals the root timestamp. Root records are normally stored without that value, so CLI thread output may omit the root message.

### Restart and reconnect

- The SQLite archive, user cache rows, documents, and ingestion cursor persist on disk.
- User sessions, pending poll confirmations, votes, proactive cursors, timers, and rate-limit counters are process memory and are lost on restart.
- Startup reconnects through Slack Bolt Socket Mode, but no durable event-to-response deduplication state is present in the request handlers.
- A restart therefore preserves searchable archive rows but does not preserve active conversational sessions or interactive state.

### Retrieval

- The generation process is instructed to execute `search.ts` through a shell command for almost every non-social request.
- Message retrieval uses SQLite FTS5 relevance ranking. A failed multi-word AND search with at least three terms retries subsets with one term removed.
- If the CLI still has no result, it performs a broad case-insensitive `LIKE` OR search and orders matches newest first.
- Search can filter by partial speaker name and date. It does not filter retrieval by requesting user or channel boundary.
- For up to eight top search results, the CLI appends available nearby thread replies.
- Attribution and uncertainty are prompt instructions, not enforced output checks. Retrieval IDs, retrieval duration, and evidence-to-claim links are not captured.
- DM content is not added to the archive by the DM handler, but DM and channel conversational sessions share a per-user key.

### Normal channel ingestion

- `cron.ts` polls one configured channel, currently every 30 seconds, and persists messages by Slack timestamp.
- Initial ingestion starts at the saved cursor or a 30-day lookback. Thread replies are fetched for roots returned by the current history scan.
- `INSERT OR REPLACE` makes repeated writes for the same message timestamp stable at the row-count level.
- Ordinary text ingestion does not call the generation process. File extraction does call it.
- Join/leave events are skipped, but other bot/system records are not comprehensively filtered before archive insertion.
- Edit/delete propagation and event-level deduplication are not implemented.

### Failure cases

- Missing required Slack configuration stops bot startup with a concise configuration error.
- Agent calls default to a 120-second timeout. Non-zero child exit, malformed output, and reported provider errors reject the request.
- Mention and DM handlers convert those failures to the same generic Slack retry message.
- Search syntax errors are swallowed by the FTS layer and can fall through to broad matching, making malformed or difficult queries indistinguishable from genuine no-result cases.
- Ingestion retries rate limits, logs API failures, and continues future scheduled runs. There is no durable alert or reliability counter.

## Latency and reliability observations

| Signal | Current observation | Measurement method |
|---|---|---|
| User feedback | Thinking message is sent before generation, but only after user lookup and any file download. No timing is recorded. | Static request-path inspection in `bot.ts`. |
| First answer content | No answer streaming. First answer content appears only when the thinking message is updated after the agent finishes. | Static request-path inspection; unavailable as a numeric baseline. |
| Model completion | Agent JSON includes `duration_ms`; handlers print it per request. No durable samples, percentiles, or run IDs exist. | Static inspection of `agent.ts` and handler logging. Live sampling intentionally skipped. |
| Retrieval latency | Included inside child-process duration and not timed separately. | Static inspection of shell retrieval path. |
| Maximum request wait | Default agent timeout is 120,000 ms, above the PRD 60-second completion objective. | Configuration inspection in `agent.ts`. |
| Ingestion freshness | Poll interval is 30 seconds plus API pacing and thread pagination. Header/startup text still describes two minutes in places. | Static inspection in `cron.ts`; no live API calls. |
| Duplicate replies | No persistent event deduplication guard exists before posting a response. | Static handler inspection; retry test not safe without isolated Slack environment. |
| Automated reliability | Repository test command exits successfully after printing `No tests yet`. | `npm test` at source snapshot. |

No p50/p90 latency, success percentage, grounding percentage, or duplicate-delivery rate can be honestly calculated from the available safe inputs. Future runs must capture, per synthetic case: accepted-event time, first answer-content time, completion time, retrieval duration, retrieved IDs, final response count, and failure class. Aggregate p50/p90 latency and success rate without storing message bodies.

## Baseline gaps against migration goals

- No durable DM/thread conversation state across restart.
- No request-level channel authorization in retrieval.
- No event-level reply deduplication.
- No automatic semantic recall; retrieval is model-directed shell execution.
- No separated retrieval/model timing or trace correlation.
- No automated behavior or privacy tests.
- No reliable quantitative production baseline available under the safe measurement constraints.

## Synthetic comparison set

`benchmarks/baseline/synthetic-seed.json` supplies ten invented messages and eight cases covering paraphrase, exact values, attribution, thread context, unknown history, channel isolation, DM isolation, and restart recall. `benchmarks/baseline/README.md` defines deterministic scoring and latency capture. The corpus is intentionally small: it validates contracts and reviewer agreement, not archive-scale recall.
