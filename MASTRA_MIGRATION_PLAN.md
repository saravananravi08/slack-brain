# Gist → Mastra Migration Plan

> Phase execution, task dependencies, parallel work, commit protocol, and progress logs are maintained in [`docs/implementation/`](./docs/implementation/README.md).

## 1. Decision

Rebuild **Gist** as a Mastra agent with Mastra's native Slack Channels integration.

- User-facing name: **Gist**
- Framework/runtime: **Mastra**
- Slack transport: `@chat-adapter/slack`
- Deployment mode: Socket Mode initially, matching current deployment
- Conversation state and retrieval: Mastra Memory
- Persistent state: Mastra storage
- Model execution: Mastra model provider, not Claude CLI

Gist will not expose or call custom tools. Remove ClickUp, the search CLI, SQLite FTS, shell-based retrieval, and Claude CLI process spawning.

## 2. Scope

### MVP includes

- Slack direct messages
- Slack `@Gist` mentions
- Threaded replies
- Native response streaming and typing state
- Persistent conversation memory across restarts
- Automatic semantic recall through Mastra Memory
- Shared context for users in the same Slack channel
- Private memory boundaries for DMs
- Existing Slack history import into Mastra Memory, if archive continuity is required
- Mastra tracing for model and memory behavior

### MVP excludes

- ClickUp integration
- `search.ts` and explicit search commands
- Agent-callable tools
- `better-sqlite3` FTS tables
- Claude CLI and MCP memory dependencies
- Custom file extraction/indexing
- Custom polls
- Proactive nudges, daily digests, greetings, and EOD posts
- Multi-workspace Slack OAuth

Excluded features can be reconsidered after the core Slack agent is stable. Do not carry them into the rewrite by default.

## 3. Important distinction: memory vs archive search

Mastra Channels automatically stores conversations routed through the agent. It does **not** automatically turn every historical Slack message into knowledge.

The replacement for Gist's custom search will be:

1. Mastra message history for recent thread context.
2. Mastra semantic recall for relevant older messages.
3. Optional one-time import of the existing Slack archive into Mastra Memory.
4. Optional live ingestion of ordinary channel messages if Gist must remember messages where it was not mentioned.

There will be no search command and no search tool visible to the model. Retrieval happens automatically before each model call.

If Gist only needs to remember conversations involving Gist, skip archive import and ordinary-message ingestion. If Gist must remain an all-channel knowledge bot, both are required.

## 4. Target architecture

```text
Slack
  ↓ Socket Mode
Mastra Slack Channel Adapter
  ↓
Gist Agent
  ├── instructions/persona
  ├── Mastra message history
  ├── Mastra semantic recall
  └── model provider
  ↓
Slack thread/DM response

Mastra Storage
  ├── channel state and event deduplication
  ├── thread subscriptions
  ├── message history
  ├── semantic embeddings
  └── traces
```

No Slack Bolt layer, child process, search CLI, ClickUp client, or custom FTS database remains in the request path.

## 5. Slack integration choice

Use the existing Slack app through the lower-level adapter:

```ts
createSlackAdapter({
  mode: "socket",
  appToken: process.env.SLACK_APP_TOKEN,
  botToken: process.env.SLACK_BOT_TOKEN,
})
```

Do not use `SlackProvider` initially. It is intended for Mastra-managed app provisioning, OAuth installation, token rotation, and multi-workspace products.

Required Slack behavior:

- DMs route directly to Gist.
- Mentions route to Gist and reply in the Slack thread.
- First mention in an existing thread loads recent Slack thread context.
- Later messages use persisted Mastra thread state.
- Slack retries are deduplicated through persistent channel state.
- Socket reconnects do not lose memory.

## 6. Memory design

### Storage

Use file-backed libSQL for local development and a persistent managed database for production if the service becomes multi-instance.

For the current single-process deployment:

- Mastra store: file-backed libSQL
- Mastra vector store: libSQL vector store
- Database file must live outside the Git repository or be ignored
- Take backups before importing Slack history

Do not reuse the current FTS schema. Let Mastra own its storage schema.

### Memory configuration

Start with:

- Recent history: approximately 20 messages
- Semantic recall: enabled
- Recall scope: `resource`
- Initial `topK`: 5
- Initial surrounding message range: 2
- Observational Memory: disabled for MVP
- Working memory: disabled for MVP

Tune these values using traces and retrieval tests rather than prompt guesses.

### Resource boundaries

Use deterministic ownership:

- Channel conversation resource: `slack-channel:<channelId>`
- DM resource: `slack-user:<userId>`
- Slack thread identity: `slack:<channelId>:<threadTs>`

This provides:

- Shared recall across threads in the same team channel.
- Isolation between different channels.
- Private DM memory per user.
- Stable mapping for archive import and restart recovery.

Never place DM content in a channel resource.

## 7. Historical Slack migration

Only perform this phase if Gist must retain its existing team-brain behavior.

### Import source

Use the current `slack_messages.db` as a temporary migration source. Do not keep it as a runtime dependency.

### Import mapping

- One Slack root message/thread → one Mastra memory thread.
- Resource ID → `slack-channel:<channelId>`.
- Thread ID → deterministic Slack channel/thread identifier.
- Preserve sender ID, sender name, timestamp, message text, and thread relationship.
- Keep imported message IDs deterministic so rerunning the migration is idempotent.
- Exclude bot messages that would create duplicate Gist context.
- Validate UTC/IST timestamps before import.

### Import verification

Test at least these queries through normal Slack conversation—not a search command:

- Paraphrased question about an old decision.
- Question mentioning a specific person.
- Question about an old URL or configuration.
- Follow-up question requiring surrounding thread context.
- Question with no matching history; Gist must say it does not know.

Do not delete the old database until recall quality is accepted.

### Archive-scale fallback

Mastra semantic recall is the first choice because it is automatic and tool-free. If it cannot reliably handle the full archive, use Mastra RAG through an input/context processor so retrieval still happens before the model call. Do not reintroduce a model-callable search tool or shell command.

## 8. Live message capture

Decide whether Gist must remember messages where it was not mentioned.

### Recommended for team-brain parity

Subscribe to channel message events and persist ordinary human messages into the same Mastra memory resources without running the agent for each message.

Requirements:

- Do not reply to ordinary messages.
- Do not invoke the model during ingestion.
- Ignore bot/system events.
- Preserve Slack event ID for deduplication.
- Store thread identity and sender identity.
- Keep ingestion idempotent.

Run an integration spike first: verify whether the current Mastra Channels/Chat SDK version exposes ordinary channel events through a supported handler. If not, add the smallest adapter-level event bridge. Do not restore the polling/FTS architecture.

### Minimal alternative

If all-channel memory is no longer required, store only DMs, mentions, and subscribed-thread messages. This removes the ingestion subsystem entirely.

## 9. Gist agent behavior

Move the useful parts of `DEFAULT_SYSTEM_PROMPT` into concise Mastra instructions:

- Identity is Gist.
- Slack-first, short responses.
- Do not claim facts absent from retrieved memory.
- Attribute historical claims to sender/date when metadata exists.
- Treat DM and channel context correctly.
- Keep Slack security boundaries explicit.

Remove from the prompt:

- Bash search commands
- ClickUp commands
- MCP memory instructions
- Poll JSON protocol
- Tool permission/error instructions
- Claude-specific identity suppression
- Duplicate formatting workarounds handled by the Slack adapter

Keep persona separate from retrieval policy so each can be tested independently.

## 10. Planned project structure

```text
src/
  mastra/
    index.ts             # Mastra instance, storage, tracing
    agents/
      gist.ts            # Gist instructions, model, memory, Slack channel
    memory/
      gist-memory.ts     # Memory/vector configuration and resource mapping
  migration/
    import-slack.ts      # One-time archive importer; remove after migration
  config.ts              # Required environment validation
```

Add live-ingestion code only if the team-brain parity requirement is confirmed.

## 11. Configuration

Target environment variables:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
GIST_MODEL=provider/model
MASTRA_DATABASE_URL=file:/absolute/path/to/mastra.db
EMBEDDING_MODEL=provider/model
```

Also provide the model provider API key required by `GIST_MODEL` and `EMBEDDING_MODEL`.

Rules:

- Validate configuration at startup.
- Do not silently default to a real Slack channel or team ID.
- Do not commit `.env`, database files, tokens, or imported Slack data.
- Remove stale variables such as `SLACK_USER_TOKEN`, `CLICKUP_API_TOKEN`, `CLICKUP_TEAM_ID`, `DATABASE_PATH`, `CLAUDE_MODEL`, and `CLAUDE_API_KEY` when no longer used.

## 12. Implementation phases

### Phase 0 — Baseline and safety

1. Unstage/remove `test_secrets.js` before any commit.
2. Add database files to `.gitignore`.
3. Snapshot the existing Slack database.
4. Record current production behavior and Slack scopes.
5. Create a separate development Slack app/channel to avoid duplicate replies.

**Exit:** no secrets or Slack archive data can be committed; rollback data exists.

### Phase 1 — Minimal Mastra Slack agent

1. Initialize a clean Mastra TypeScript project structure.
2. Configure persistent storage.
3. Create agent ID `gist`, display name `Gist`.
4. Attach `createSlackAdapter()` in Socket Mode.
5. Configure one model through Mastra.
6. Verify DM, mention, thread reply, streaming, and reconnect behavior.

**Exit:** Gist answers in Slack without Bolt or Claude CLI.

### Phase 2 — Native memory

1. Add Mastra Memory.
2. Configure deterministic resource/thread mapping.
3. Enable persistent message history.
4. Enable semantic recall and embeddings.
5. Verify channel sharing and DM isolation.
6. Inspect traces to confirm which messages are recalled.

**Exit:** memory survives restart and retrieval is automatic.

### Phase 3 — Historical continuity

1. Build an idempotent one-time importer.
2. Import a small representative sample.
3. Run retrieval quality tests.
4. Import the full archive only after sample acceptance.
5. Record counts and failed rows.
6. Keep the old database read-only until final sign-off.

**Exit:** normal Gist conversations can recall accepted historical facts without a search tool.

### Phase 4 — Live knowledge capture

1. Confirm whether non-mention channel history is still required.
2. If required, persist ordinary channel events into Mastra Memory without model calls.
3. Verify deduplication, edits, thread replies, and bot-event filtering.
4. If not required, omit this phase completely.

**Exit:** new knowledge coverage matches the chosen product scope.

### Phase 5 — Cutover and deletion

1. Run the Mastra version in a test channel.
2. Complete acceptance tests.
3. Stop old `bot.ts` and `cron.ts` processes.
4. Start the Mastra Gist service with the production Slack app.
5. Monitor duplicate events, memory retrieval, latency, and model cost.
6. After the rollback window, delete replaced modules.

Delete when no longer referenced:

```text
agent.ts
bot.ts
clickup.ts
cron.ts
db.ts
files.ts
proactive.ts
search.ts
```

Also remove obsolete dependencies and regenerate the lockfile.

**Exit:** production Gist runs only through Mastra.

## 13. Acceptance criteria

### Slack

- DM receives one streamed response.
- Mention receives one response in the correct thread.
- Existing thread context is available on first mention.
- Follow-up messages continue the same memory thread.
- Restart does not erase context.
- Duplicate Slack events do not create duplicate replies.

### Memory

- Same channel users share channel knowledge.
- Different channels do not leak knowledge.
- DMs remain private to the sender.
- Semantic paraphrases retrieve relevant old context.
- Unrelated questions do not inject irrelevant history.
- Gist admits uncertainty when recall returns no evidence.

### Operations

- No `claude` child process is spawned.
- No shell command performs retrieval.
- No ClickUp request is possible.
- No custom FTS database is required at runtime.
- Storage survives restart and is backed up.
- Traces expose memory retrieval and model latency.

## 14. Rollback

- Keep the old code and database unchanged during migration.
- Run migration in a separate branch and test Slack app.
- Cut over by stopping one runtime before starting the other.
- If the Mastra runtime fails, stop it and restart the old bot/cron processes.
- Do not mutate or delete the old archive during the rollback window.

## 15. Main risks

1. **Assuming Mastra ingests all Slack traffic:** it only remembers messages routed or explicitly stored.
2. **Wrong memory ownership:** per-user defaults would prevent shared channel recall; configure resource mapping.
3. **DM leakage:** never use channel resource IDs for direct messages.
4. **Recall quality:** semantic similarity may not preserve exact URLs, dates, or names without careful import metadata and testing.
5. **Socket lifecycle:** Socket Mode needs a continuously running process.
6. **Local database path:** relative paths can differ between Mastra runtime and Studio; use an absolute path.
7. **Framework API changes:** Mastra Channels and schedules are evolving; pin versions and review release notes before upgrades.

## 16. Recommended first release

Ship only:

- Gist Slack agent
- Socket Mode
- DMs and mentions
- Thread context
- Persistent Mastra Memory
- Semantic recall
- Optional archive import

Do not add tools, polls, proactive behavior, or scheduled content until this path is stable and measurable.

## References

- [Mastra Slack Channels](https://mastra.ai/docs/capabilities/channels/slack)
- [Mastra Channels](https://mastra.ai/docs/channels)
- [Mastra Channels reference](https://mastra.ai/reference/agents/channels)
- [Chat SDK Slack adapter](https://chat-sdk.dev/adapters/official/slack)
- [Mastra Memory](https://mastra.ai/docs/memory/overview)
- [Mastra semantic recall](https://mastra.ai/docs/memory/semantic-recall)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra RAG](https://mastra.ai/reference/rag/overview)
