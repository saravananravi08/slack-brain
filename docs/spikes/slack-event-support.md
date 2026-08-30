# Spike — supported ordinary Slack event handling

- **Task:** [T401](../implementation/tasks/T401-ADAPTER-EVENT-SPIKE.md)
- **Date:** 2026-08-30
- **Pinned versions:** `chat@4.39.0`, `@chat-adapter/slack@4.39.0` (exact pins in `package.json`)
- **Executable evidence:** [`tests/spikes/slack-events/event-routing.spike.test.ts`](../../tests/spikes/slack-events/event-routing.spike.test.ts) — 31 assertions against the real SDK classes
- **Consumers:** T402 (normalization), T403 (silent persistence), T404 (mutation policy), T405 (live integration)

## 1. Question

P04 needs to ingest **ordinary channel messages** — the ones nobody addressed to Gist — and their edits and deletes, without replying and without invoking the model (INV-6, FR-MEM-001, D005). T104 wired only the three addressed handlers. This spike establishes what the pinned SDK actually supports for the ambient path, so P04 designs against measured behaviour rather than assumption.

## 2. Method

Two halves, one of which is blocked.

**Offline (done).** The spike drives the *real* `SlackAdapter` and `Chat` classes with synthetic Slack event envelopes, entering at `adapter.processEventPayload` — the shared dispatch both the Socket Mode and webhook paths funnel into (`@chat-adapter/slack/dist/index.js`: `routeSocketEvent` → `processEventPayload`; `handleWebhook` → `processEventPayload`). Nothing is faked except three seams, each of which only removes network:

| Seam | Why |
|---|---|
| `adapter.chat` assigned directly instead of `chat.initialize()` | `initialize()` opens a Socket Mode connection |
| `botUserId` supplied in adapter config | skips the `auth.test` call |
| `adapter.lookupUser` stubbed | skips `users.info` during author resolution |

`adapter.postMessage` is also replaced by a recorder, so a test can assert the ambient path posts *nothing* rather than merely assuming it.

The negative assertions were mutation-checked: feeding a normal user into the self-message case and an empty subtype into the ignored-subtype case both fail the suite, so "no handler fired" is a measurement rather than a race.

**Live (blocked).** See §8. The credentials available do not belong to the T003 development app, so the envelope shapes below are read from the adapter's parsing code and its published docs rather than confirmed against a live delivery.

## 3. Routing — what reaches which handler

`Chat.dispatchToHandlersWithSignal` evaluates in this order and **returns at the first match**:

1. DM **and** `onDirectMessage` registered → direct-message handlers.
2. Thread is subscribed → `onSubscribedMessage`.
3. Message is a mention → `onNewMention`.
4. Otherwise → every `onNewMessage(pattern)` whose regex matches.

Source: `chat/docs/handling-events.mdx` §"How routing works"; implementation in `chat/dist/index.js`.

| Slack event | Handler reached | Notes |
|---|---|---|
| Ordinary message, unsubscribed channel thread | `onNewMessage(pattern)` **only** | The ambient hook. A catch-all `/[\s\S]*/` captures every ordinary message. |
| Ordinary thread reply, unsubscribed | `onNewMessage(pattern)` | Same thread ID as its root. |
| Ordinary message, **subscribed** thread | `onSubscribedMessage` | **Hazard — see §5.** |
| `app_mention` | `onNewMention` | |
| `message` whose text contains the bot mention | `onNewMention` | Mention detection is text-based, so the `message.channels` copy of a mention is addressed traffic, not ambient. |
| Direct message | `onDirectMessage` | Thread ID is `slack:<D…>:` (empty thread ts). |
| `message_changed` | `onMessageUpdated(thread, message, previousMessage?)` | Never routes through the message handlers. |
| `message_deleted` | `onMessageDeleted(event)` | Never routes through the message handlers. |
| Bot's own message (`user === botUserId`) | none | Filtered centrally as `isMe`. |
| Another bot or app | `onNewMessage` with `author.isBot === true` | **The SDK filters only `isMe`.** FR-SLK-009 filtering stays the application's job. |
| `channel_join`, `channel_leave`, `channel_topic`, `tombstone`, and 13 other subtypes | none | Dropped in the adapter's `ignoredSubtypes` set. |

**Ambient capture is possible and it is opt-in.** With no `onNewMessage` registered — today's T104 state — an ordinary message reaches nothing at all. Registering the catch-all pattern captures it with no reply and no model call: asserted, including that `postMessage` is never invoked.

## 4. Answer to the task question

> Prove the pinned path for receiving ordinary channel messages without invoking or replying through the agent.

`bot.onNewMessage(/[\s\S]*/, handler)` is that path. It is a supported, documented API of the pinned SDK, it fires for ordinary non-mention messages and thread replies, it hands over a parsed `Message` plus the raw Slack event, and it does nothing else — the reply and the model call only happen if the handler chooses to make them. **No polling and no additional Slack API surface is required**, and the required `message.channels` subscription is already in the T003 manifest.

## 5. The subscribed-thread hazard (design constraint for T403/T405)

Subscription wins over pattern matching. T104 subscribes to a thread on first mention (FR-SLK-005), so **after Gist has been mentioned once in a thread, every later ordinary message in that thread arrives at `onSubscribedMessage`, not at the ambient handler** — with `isMention === false`. On the T104 path that handler authorizes, generates, and posts a reply.

Two consequences P04 must design for, rather than discover:

1. **INV-6 risk.** An ambient message in a subscribed thread would produce an unsolicited reply. T405 must decide the rule — the defensible one is that `onSubscribedMessage` continues to generate (that is FR-SLK-005's whole point: follow-ups need no second mention), while T403's silent persistence hooks *both* handlers so a subscribed-thread message is stored exactly once whichever way it arrives.
2. **Double storage.** Whatever T403 does must be idempotent across the two handlers, keyed on `messageKey`, since the same message can only reach one of them but the code paths differ.

This is the finding most likely to be missed by reading the docs alone: subscription state, not message content, decides whether an ordinary message is ambient.

## 6. Identity and acknowledgement

**Message identity.** `Message.id` is `event.ts` verbatim (`parseSlackMessage`), never parsed to a float. The precision pair `1735689600.000200` / `1735689600.0002` stays distinct through the SDK — asserted. `message.raw` is the untouched Slack event, so `team`, `channel`, `channel_type`, `thread_ts`, `subtype`, and `event_ts` all survive to the handler; `slack-event.md`'s `NormalizedEvent` can be built from it without a second API call.

**Thread identity.** `threadId = slack:<channel>:<thread_ts ?? ts>`; DMs use `slack:<channel>:` with an empty thread ts. Both Slack root encodings — `thread_ts` absent and `thread_ts === ts` — produce one thread ID, which is `identity.md` §3's convergence requirement satisfied at the transport layer. An edit or delete resolves to the same thread ID as the message it targets.

**Acknowledgement.** Socket Mode acks **before** processing: `routeSocketEvent` does `await ack()` and only then builds the payload and dispatches. Handler failure therefore never turns into a Slack retry, and slow handlers never delay the ack. The corollary is that at-least-once delivery is the SDK's problem to solve in state, not Slack's — which is what the two dedupe layers below are for.

**Two dedupe layers, both durable via the `StateAdapter`:**

| Layer | Key | TTL | Consulted |
|---|---|---|---|
| Delivery (adapter) | `slack:event-delivered:<event_id>` | 24 h | Only when `retry_num > 0`, so a first delivery pays no state read and an event never dispatched is still recovered by the retry |
| Content (Chat) | `dedupe:slack:<message.ts>` | `dedupeTtlMs`, default 10 min | Every message |

Both were asserted by reading the keys back out of the state adapter after a delivery. Content dedupe is what collapses Slack's habit of sending `message` **and** `app_mention` for the same mention into one handler call.

**Mutations bypass dedupe entirely.** `handleMessageUpdated`/`handleMessageDeleted` are documented as bypassing "subscription, mention, pattern, dedupe, and lock routing". A replayed delete fires the handler twice — asserted. **Idempotency for edits and deletes is entirely T404's responsibility**; there is no SDK layer under it.

## 7. Gaps the SDK does not cover

1. **No external / guest / deactivated flag on the author.** The parsed author is `{userId, userName, fullName, email?, isBot, isSystem, isMe}`, and the adapter's cached user record (`lookupUser`) holds only `{avatarUrl, displayName, email, isBot, realName}`. D006 needs external, guest, and deactivated. T203's `SenderResolver` must therefore make its own `users.info` call and read `is_restricted`, `is_ultra_restricted`, `is_stranger`, and `deleted` — and it needs the `users:read` scope to do it (see §8).
2. **Channel visibility is best-effort.** `adapter.getChannelVisibility(threadId)` returns `external` only for channels already seen carrying `is_ext_shared_channel`, and `unknown` before the first such event. It is a useful cross-check but **not** a sufficient basis for FR-PRV-006; the per-sender external flag remains authoritative.
3. **Other bots and apps are not filtered.** Only `isMe` is. The ambient handler needs the same `isBot`/`isSystem` check T104 applies to addressed turns.
4. **No message body is written to the state store.** The Slack adapter sets neither `persistThreadHistory` nor `persistMessageHistory`, so the Chat SDK's history append is skipped; what it does write is `slack:thread-participants:<threadId>` (user IDs) and `slack:user:<id>` (display name, real name, email). Relevant to T502: no Slack message text lands in the Chat state store, but user profile fields do.

## 8. Blocker — live confirmation not performed

**B-01 (open): the Slack credentials available are not the T003 development app's.**

Evidence, gathered read-only and without printing any token value:

- `auth.test` succeeds and Socket Mode connects, so the tokens are valid.
- The bot token's granted scopes are `channels:history, channels:read, groups:history, groups:read, files:read, im:history, mpim:read, search:read.private, search:read.public, app_mentions:read, incoming-webhook`.
- The T003 manifest specifies `im:write, app_mentions:read, channels:history, channels:read, chat:write, users:read, im:read, im:history`. **`chat:write`, `users:read`, `im:read`, and `im:write` are absent**; `groups:*`, `files:read`, `mpim:read`, `search:read.*`, and `incoming-webhook` are present but are not in the approved baseline, which explicitly excludes private channels, group DMs, file and search scopes, and incoming webhooks.
- `chat.postMessage` and `users.info` both return `missing_scope`.
- `conversations.info` for `GIST_DEV_CHANNEL_ID` reports `is_member: false`, and across 200 public channels the app is a member of **none** — so `message.channels` would deliver nothing from that channel even with a valid subscription.

The scope set matches the legacy Gist bot (search and incoming-webhook scopes), not `Gist Dev`. Two things follow, and both are the coordinator's to resolve:

1. **No live probe was run beyond read-only calls.** Nothing was posted, edited, or deleted in any workspace. Per mandatory procedure step 7 this is recorded rather than worked around — a spike that posts into what may be a production workspace to prove a point is not a spike worth having.
2. **`users:read` is missing from whatever app these credentials belong to.** T203's sender resolver cannot resolve external/guest/deactivated without it. This blocks T405 regardless of T401, so it needs to be fixed at the app, not worked around in code.

**Unblock condition:** issue credentials for the `Gist Dev` app installed per `docs/runbooks/slack-dev-environment.md` §1–§3, with the app added to `gist-dev-test`, and set `GIST_DEV_CHANNEL_ID` to that channel. Then run:

```bash
node --env-file=.env --experimental-strip-types tests/spikes/slack-events/live-probe.ts
```

The probe is committed and ready. It posts one clearly-marked synthetic message, replies in thread, edits, deletes, records the envelope *shapes* only, and prints no token, no identifier, and no message text. What it confirms is §6's envelope claims against a real delivery.

**This blocker does not block T402/T403/T404 from starting.** The handler contract in §9 is settled by the offline evidence. What stays unconfirmed is that Slack's live envelopes match the synthetic fixtures — a risk that lands on T405/T406, where a live workspace is required anyway.

## 9. Chosen handler contract

For T402/T403/T404 to implement, and for T405 to compose:

```ts
// Ambient ingestion — silent, no generation, no reply (INV-6).
bot.onNewMessage(/[\s\S]*/, async (thread, message) => { /* normalize → authorize → persist */ });

// Mutations — D005. Idempotency is ours; the SDK does not dedupe these.
bot.onMessageUpdated(async (thread, message, previousMessage) => { /* … */ });
bot.onMessageDeleted(async (event) => { /* … */ });
```

Rules that fall out of the measurements above:

1. **Authorize before any storage touch, on every one of the three.** INV-2 applies to the ambient path exactly as to the addressed one; a mutation from an unapproved channel must be denied before lookup so it cannot probe stored state (D005).
2. **Filter non-human senders in the handler.** `isMe` is handled; `isBot`, `isSystem`, and `isBot === 'unknown'` are not.
3. **Build `NormalizedEvent` from `message.raw`**, keeping `ts` a verbatim string. Everything `slack-event.md` §2 needs is present except the sender's external/guest/deactivated attributes, which need the `users.info` call of §7.1.
4. **Key content idempotency on `messageKey`**, not on the SDK's dedupe: the SDK's 10-minute window is a delivery convenience, not the durable identity FR-MEM-007 and AC-14 require, and it does not cover mutations at all.
5. **Persist from both the ambient and the subscribed handler**, idempotently, per §5.
6. **Do not add polling.** The event path is supported; if a future requirement is not covered by it, that is a blocker to raise, not a poll loop to add (T401 acceptance criterion 3).

## 10. Version sensitivity

Every claim here is version-specific. The spike suite is the guard: it runs against the pinned SDK on every `npm test`, so a bump to `chat` or `@chat-adapter/slack` that changes routing, dedupe keys, ack ordering, or mutation dispatch fails a named test rather than silently changing what P04 was designed against. Treat a failure in `tests/spikes/slack-events/` as a re-run of this spike, not as a test to update.

## 11. Sources

- `node_modules/chat/docs/handling-events.mdx` — routing order, `onNewMessage`, `onMessageUpdated`, `onMessageDeleted`, the Slack-only note on edit/delete support.
- `node_modules/chat/docs/concurrency.mdx`, `threads-messages-channels.mdx` — concurrency strategies and thread model.
- `node_modules/chat/dist/index.js` — `routeIncomingMessage` (isMe filter, dedupe), `dispatchToHandlersWithSignal` (routing order), `detectMention`, `handleMessageUpdated`, `handleMessageDeleted`.
- `node_modules/@chat-adapter/slack/dist/index.js` — `processEventPayload`, `handleMessageEvent` (ignored subtypes), `handleMessageChanged`, `handleMessageDeleted`, `parseSlackMessage`, `encodeThreadId`, `threadIdForMessageEvent`, `getChannelVisibility`, `markEventDelivered`, `isDuplicateEventDelivery`, `startSocketMode`.
- `docs/runbooks/slack-dev-environment.md` — the approved app manifest, scopes, and event subscriptions.
- Slack API reference: <https://docs.slack.dev/reference/events/message>, <https://docs.slack.dev/reference/events/message/message_changed>, <https://docs.slack.dev/reference/events/message/message_deleted>.
