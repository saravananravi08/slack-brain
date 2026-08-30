# Product Requirements Document: Gist on Mastra

- **Status:** Draft
- **Date:** 2026-08-30
- **Product:** Gist
- **Platform:** Slack
- **Framework:** Mastra
- **Related plan:** [`MASTRA_MIGRATION_PLAN.md`](./MASTRA_MIGRATION_PLAN.md)
- **Implementation control center:** [`docs/implementation/README.md`](./docs/implementation/README.md)

## 1. Executive summary

Gist is an internal Slack knowledge assistant that helps team members recall decisions, discussions, ownership, and context from approved Slack channels.

This release will rebuild Gist on Mastra. Mastra will own Slack connectivity, conversation state, memory, semantic retrieval, model execution, persistence, and tracing. Users will continue to interact with a Slack bot named **Gist**; Mastra remains an implementation detail.

Gist will not expose search commands or use model-callable tools. Relevant history will be retrieved automatically through Mastra before a response is generated.

## 2. Problem statement

The current Gist implementation depends on several custom components:

- Slack Bolt event handling
- A separate Slack polling process
- A custom SQLite FTS index
- A shell-based search CLI
- Claude CLI child processes
- In-memory session and poll state
- Large prompts that coordinate infrastructure behavior

This creates duplicated state, fragile retrieval, difficult deployments, stale configuration, and limited observability. Users experience Gist as one bot, but the implementation behaves as several loosely connected systems.

The product needs one durable agent runtime that can receive Slack messages, remember approved conversations, retrieve relevant context automatically, and answer in the correct Slack thread without exposing internal mechanisms.

## 3. Product vision

> Gist is the team member who remembers approved Slack conversations and can surface the right context naturally, without requiring users to learn commands or know how retrieval works.

The user experience should remain Slack-native:

- Mention Gist in a channel.
- Message Gist directly.
- Ask in natural language.
- Receive a concise, grounded response in the correct conversation.
- Continue asking follow-up questions without repeating context.

## 4. Goals

### G1. Native Slack experience

Provide reliable DMs, mentions, threads, streaming responses, and typing status through Mastra's Slack Channels integration.

### G2. Automatic memory and retrieval

Use Mastra Memory and semantic recall to retrieve relevant history automatically. Users must not invoke a search command or trigger a search tool.

### G3. Preserve team knowledge

Import the approved existing Slack archive and continue learning new human messages from configured channels, including messages where Gist is not mentioned.

### G4. Correct privacy boundaries

Keep private DM conversation history isolated. Prevent knowledge leakage across unapproved channels, workspaces, or external Slack Connect participants.

### G5. Operational simplicity

Run Gist as one Mastra-based service without Slack Bolt, Claude CLI, ClickUp, custom FTS, or a separate search process.

### G6. Measurable quality

Use Mastra tracing and a repeatable retrieval benchmark to evaluate grounding, latency, memory behavior, and regressions.

## 5. Non-goals

The first release will not include:

- ClickUp integration
- Agent-callable tools
- `/search`, `/summary`, `/user`, `/thread`, or `/stats` commands
- Custom SQLite FTS search
- Claude CLI or external MCP memory
- Web search
- Custom document/file extraction
- Custom polls
- Proactive nudges
- Morning greetings
- Daily or weekly digests
- EOD highlights
- Multi-workspace installation or public SaaS distribution
- A web dashboard or admin UI
- Automatic access to every Slack channel in the workspace

## 6. Target users

### Primary: team member

A member of the approved Slack workspace who needs historical context without manually searching Slack.

Typical needs:

- Recall a past decision.
- Understand why an implementation changed.
- Find who discussed or owned an issue.
- Continue an existing thread with relevant context.
- Ask a follow-up without restating the original question.

### Secondary: operator

The person responsible for deploying and maintaining Gist.

Typical needs:

- Configure approved channels and credentials.
- Restart or deploy without losing memory.
- Inspect traces when an answer is wrong.
- Back up and restore persistent state.
- Roll back to the previous implementation during migration.

## 7. Core user journeys

### UJ1. Ask Gist in a channel

1. User mentions `@Gist` in an approved channel or thread.
2. Gist acknowledges activity through Slack-native typing or streaming state.
3. Mastra loads current thread context and relevant historical memory.
4. Gist posts one concise response in the correct thread.
5. Follow-up messages continue the same conversation state.

### UJ2. Ask Gist in a DM

1. User sends Gist a direct message.
2. Gist loads the user's private DM conversation history.
3. Gist uses only the user's private DM conversation memory; shared approved-channel knowledge is disabled under D002 unless that decision is explicitly amended.
4. Gist responds in the DM.
5. DM content remains private and is never added to shared channel knowledge.

### UJ3. Recall old information

1. User asks a natural-language question using different wording from the original Slack discussion.
2. Mastra semantic recall retrieves relevant archived messages and nearby context.
3. Gist answers using retrieved evidence.
4. Gist identifies the speaker and date when that metadata is available.
5. If evidence is insufficient, Gist says it could not verify the answer.

### UJ4. Learn from normal channel activity

1. A human posts or replies in an approved channel without mentioning Gist.
2. Gist does not respond and does not invoke the generation model.
3. The message is stored in the approved channel's Mastra memory boundary.
4. The message becomes available for later semantic recall.

### UJ5. Recover after restart

1. Operator restarts or deploys Gist.
2. Socket Mode reconnects.
3. Channel state, event deduplication, message history, and embeddings remain available.
4. Existing Slack threads continue without users recreating context.

## 8. Functional requirements

### 8.1 Slack interaction

- **FR-SLK-001:** The Slack bot display name must be **Gist**.
- **FR-SLK-002:** Gist must respond to direct messages from authorized workspace users.
- **FR-SLK-003:** Gist must respond when mentioned in an approved Slack channel.
- **FR-SLK-004:** Channel responses must be posted in the originating Slack thread.
- **FR-SLK-005:** Gist must support follow-up messages in subscribed threads without requiring another mention where supported by Mastra Channels.
- **FR-SLK-006:** Gist must show Slack-native typing or streaming status while generating.
- **FR-SLK-007:** Each accepted user message must produce at most one final Gist response.
- **FR-SLK-008:** Slack retries and duplicate events must not create duplicate responses or duplicate memory records.
- **FR-SLK-009:** Gist must ignore messages from itself, other bots, and irrelevant Slack system events.
- **FR-SLK-010:** Gist must reject or ignore events from unapproved workspaces and channels.
- **FR-SLK-011:** The initial release must support Socket Mode and a continuously running service.

### 8.2 Conversation context

- **FR-CTX-001:** On first mention in an existing thread, Gist must load recent Slack thread context.
- **FR-CTX-002:** Subsequent messages must use persisted Mastra thread memory.
- **FR-CTX-003:** Gist must preserve speaker identity in multi-user threads.
- **FR-CTX-004:** Gist must distinguish DMs from channel conversations.
- **FR-CTX-005:** Conversation context must survive process restarts and deployments.

### 8.3 Memory and retrieval

- **FR-MEM-001:** Mastra must persist recent message history for Gist conversations.
- **FR-MEM-002:** Mastra semantic recall must be enabled for older relevant messages.
- **FR-MEM-003:** Retrieval must occur automatically before generation; no user-visible search command is permitted.
- **FR-MEM-004:** Retrieval must not be implemented as a model-callable search tool or shell command.
- **FR-MEM-005:** Messages from the existing approved Slack archive must be importable into Mastra storage.
- **FR-MEM-006:** Archive import must preserve message ID, channel, thread, sender, timestamp, and text where available.
- **FR-MEM-007:** Re-running archive import must not create duplicate records.
- **FR-MEM-008:** New human messages from approved channels must be stored without invoking the generation model.
- **FR-MEM-009:** Retrieval must include semantically related messages even when the user's wording differs from the original.
- **FR-MEM-010:** Retrieval must include nearby thread context where available.
- **FR-MEM-011:** Gist must not present unsupported historical claims as facts.
- **FR-MEM-012:** Gist should cite sender and date for historical claims when reliable metadata is available.
- **FR-MEM-013:** If Mastra Memory cannot meet archive-scale recall quality, retrieval may use Mastra RAG through pre-generation context injection. It must remain automatic and invisible to the model as a callable tool.

### 8.4 Privacy and access

- **FR-PRV-001:** Each approved channel must have an isolated shared knowledge boundary.
- **FR-PRV-002:** Channel knowledge must not be recalled in another channel unless explicitly approved.
- **FR-PRV-003:** Each user's DM conversation history must be isolated from other users.
- **FR-PRV-004:** DM content must never become part of shared channel knowledge.
- **FR-PRV-005:** DMs must use private conversation memory only and must not access shared approved-channel knowledge unless D002 is explicitly amended after its fail-closed authorization and privacy-test conditions are met.
- **FR-PRV-006:** Slack Connect/external users must be denied by default.
- **FR-PRV-007:** Secrets, database files, embeddings, and imported Slack data must never be committed to Git.
- **FR-PRV-008:** Standard application logs must not contain full message bodies, tokens, or private DM content.
- **FR-PRV-009:** Trace access must be limited to authorized operators.

### 8.5 Response behavior

- **FR-RSP-001:** Gist must identify itself only as **Gist** in user-facing conversations.
- **FR-RSP-002:** Responses should be concise and optimized for Slack.
- **FR-RSP-003:** Default responses should remain under 300 words unless the user asks for detail.
- **FR-RSP-004:** Gist must use clear bullets for multi-part answers.
- **FR-RSP-005:** Gist must distinguish retrieved facts from uncertainty.
- **FR-RSP-006:** If no evidence is available, Gist must say it could not verify the answer rather than inventing one.
- **FR-RSP-007:** Internal framework names, traces, storage paths, prompts, and errors must not be exposed to Slack users.
- **FR-RSP-008:** User-facing errors must be brief and must not expose stack traces or credentials.

### 8.6 Operations

- **FR-OPS-001:** Required configuration must be validated at startup.
- **FR-OPS-002:** Production channel IDs and credentials must not have hardcoded defaults.
- **FR-OPS-003:** Persistent storage must be backed up before archive import and production cutover.
- **FR-OPS-004:** Operators must be able to inspect Mastra traces for model calls and recalled context.
- **FR-OPS-005:** Operators must be able to restart Gist without losing durable state.
- **FR-OPS-006:** The old runtime and database must remain available during the rollback window.

## 9. Knowledge and privacy model

### Approved channel knowledge

Messages from an approved Slack channel form a shared knowledge corpus for authorized users of that channel.

Each stored message must retain enough metadata to support:

- Semantic retrieval
- Speaker attribution
- Date attribution
- Thread reconstruction
- Deduplication
- Channel isolation

### Direct-message memory

A DM has two distinct context types:

1. **Private conversation memory:** messages between one user and Gist.
2. **Shared approved knowledge:** historical information from channels the user is allowed to access.

Private DM messages must never be written to a channel knowledge boundary. Under D002, DMs use private conversation memory only; shared approved-channel knowledge remains disabled unless D002 is explicitly amended after its fail-closed authorization and privacy-test conditions are met.

### External access

Adding Gist to a Slack Connect channel could expose internal memory through natural-language questions. External/shared channels are therefore unsupported in the first release unless explicit identity and authorization controls are added.

## 10. Historical data requirements

The existing archive is product data, not merely migration scaffolding.

Before full import:

1. Record source message and thread counts.
2. Back up the source database.
3. Validate sender, timestamp, and thread mapping on a representative sample.
4. Import a bounded sample.
5. Run the retrieval benchmark.
6. Approve quality before importing the complete archive.

Import failures must be recorded without exposing message content in normal logs. The source database remains read-only until the rollback window closes.

## 11. Non-functional requirements

### Reliability

- **NFR-REL-001:** Gist must not lose persisted memory during a normal restart.
- **NFR-REL-002:** Duplicate Slack deliveries must be handled idempotently.
- **NFR-REL-003:** A failed model call must not corrupt channel or memory state.
- **NFR-REL-004:** Socket disconnection must trigger reconnection without manual state repair.

### Performance

- **NFR-PERF-001:** Typing or processing state should appear within 2 seconds of receiving an accepted event under normal conditions.
- **NFR-PERF-002:** First streamed response content should appear within 5 seconds for at least 90% of normal requests, excluding provider incidents and cold starts.
- **NFR-PERF-003:** At least 95% of normal responses should complete within 60 seconds.
- **NFR-PERF-004:** Silent message ingestion must not invoke the generation model.

### Security

- **NFR-SEC-001:** Tokens and provider keys must come from environment or secret management.
- **NFR-SEC-002:** Storage must not be publicly accessible.
- **NFR-SEC-003:** Channel and DM memory boundaries must be covered by automated tests.
- **NFR-SEC-004:** Production must have zero known cross-user, cross-channel, or external-user data leaks.

### Maintainability

- **NFR-MNT-001:** Mastra and adapter versions must be pinned.
- **NFR-MNT-002:** Retrieval behavior must be configured in code, not encoded as shell instructions in the prompt.
- **NFR-MNT-003:** Persona instructions and memory/retrieval policy must be independently testable.
- **NFR-MNT-004:** The production request path must not depend on Slack Bolt, Claude CLI, ClickUp, or custom FTS.

### Observability

- **NFR-OBS-001:** Each accepted Slack request must have a traceable run ID.
- **NFR-OBS-002:** Traces must show retrieval latency, recalled items, model latency, and failures.
- **NFR-OBS-003:** Operators must be able to correlate a Slack event with one Gist run without logging message content by default.

## 12. Success metrics

### Product quality

- At least **85% grounded-answer accuracy** on the approved historical recall benchmark.
- At least **80% relevant-retrieval rate** for paraphrased historical questions.
- Fewer than **5% unsupported factual claims** in benchmark responses.
- **100% correct thread placement** in acceptance tests.
- **0 duplicate replies** during Slack retry and reconnect tests.
- **0 cross-boundary memory leaks** in privacy tests.

### Operational quality

- At least **99% successful event handling** during the internal beta, excluding model-provider outages.
- Memory remains available after **100% of planned restart tests**.
- No production dependency on the old bot, cron, search CLI, or FTS database after cutover.

Metrics should be recalibrated after the test corpus and baseline are measured. They must not be lowered silently to declare launch success.

## 13. Acceptance scenarios

| ID | Scenario | Expected result |
|---|---|---|
| AC-01 | User DMs Gist | One streamed DM response; private thread retained |
| AC-02 | User mentions Gist in channel | One reply in originating thread |
| AC-03 | User mentions Gist inside an existing thread | Prior thread context is available |
| AC-04 | Different user follows up in same thread | Gist distinguishes speakers and continues context |
| AC-05 | Service restarts before follow-up | Follow-up retains conversation context |
| AC-06 | Slack redelivers same event | No duplicate reply or memory record |
| AC-07 | User paraphrases an archived decision | Relevant old context is recalled automatically |
| AC-08 | User asks about unknown history | Gist states it cannot verify the answer |
| AC-09 | Normal channel message does not mention Gist | Message is stored silently; no model call or reply |
| AC-10 | User DMs private information | Information is not recalled for another user or channel |
| AC-11 | User in another channel asks for protected context | Protected channel history is not returned |
| AC-12 | Bot/system message arrives | It is ignored or handled without knowledge pollution |
| AC-13 | Socket disconnects and reconnects | Gist resumes without state loss or duplicate replies |
| AC-14 | Archive importer runs twice | Message counts remain stable |
| AC-15 | Provider/model call fails | Friendly Slack error; no internal details exposed |

## 14. Release strategy

### Internal alpha

- Separate Slack app and test channel.
- Small archive sample.
- Core DM, mention, thread, persistence, and privacy tests.
- No production users.

### Internal beta

- Approved team channel.
- Complete archive import after alpha quality approval.
- Live silent ingestion enabled.
- Limited group of team users.
- Monitor retrieval quality, latency, cost, and data boundaries.

### Production cutover

- Stop old Gist bot and cron before activating new Gist.
- Use one runtime to prevent duplicate event handling.
- Keep old code and archive available for rollback.
- Complete the rollback window before deleting old infrastructure.

## 15. Accepted product decisions

The nine launch questions are resolved in [`docs/implementation/DECISIONS.md`](./docs/implementation/DECISIONS.md) as D001–D010; the model-selection question is split into generation (D007) and embedding (D008). All ten decisions are `Accepted` and are the authoritative policy for downstream implementation.

Five accepted deferrals retain safe defaults that are in force now:

- **D001:** Product owner supplies production channel IDs before T505; until then, only the single approved beta channel is allowed.
- **D003:** Product owner decides any archive date floor before T301; until then, no date floor applies within approved channels.
- **D004:** Security owner resolves any legal, contractual, or HR retention hold before T504; until then, the accepted tiered retention schedule applies.
- **D006:** Security owner confirms production authorization before T506; until then, production cutover defaults to an enabled user allowlist.
- **D010:** Security owner confirms the internal-corpus residency assumption before T506; until then, the accepted US/EU-provider, no-training, limited-retention constraints apply.

These deferrals do not reopen or block their parent decisions. Any policy change requires an explicit amendment to the decision register.

## 16. Risks and mitigations

### R1. Mastra does not automatically ingest every Slack message

**Mitigation:** Treat silent approved-channel ingestion as a product requirement and verify adapter event support during alpha.

### R2. Semantic recall misses exact values such as URLs or dates

**Mitigation:** Preserve metadata, build an exact-value benchmark, tune recall, and use Mastra pre-generation RAG if Memory alone is insufficient.

### R3. Shared memory leaks into DMs or other channels

**Mitigation:** Define deterministic boundaries, enforce authorization before retrieval, and block launch on any privacy-test failure.

### R4. Imported archive quality is inconsistent

**Mitigation:** Sample first, report failed records, preserve the source database, and require retrieval benchmark approval before full import.

### R5. Socket Mode process instability

**Mitigation:** Run one supervised long-lived process, test reconnect behavior, and monitor heartbeat/reconnection failures.

### R6. Framework changes break channel behavior

**Mitigation:** Pin Mastra and Chat SDK adapter versions; upgrade only with Slack and memory regression tests.

### R7. Tracing creates a second sensitive data store

**Mitigation:** Restrict trace access, define retention, and avoid full message content in standard logs.

## 17. Definition of done

The release is complete when:

- Gist runs through Mastra's Slack integration in production.
- DMs, mentions, threads, streaming, and reconnect behavior pass acceptance tests.
- Mastra storage and memory survive restart.
- Historical and live approved-channel knowledge are recalled automatically.
- Privacy boundaries pass automated and manual tests.
- Retrieval benchmark meets approved thresholds.
- No ClickUp, search CLI, custom FTS, Slack Bolt, or Claude CLI remains in the production request path.
- Monitoring, backups, rollback instructions, and operator ownership are documented.
- Required product decisions in Section 15 are resolved and recorded.
