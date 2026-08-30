# Spike — supported ordinary Slack event handling

- **Task:** [T401](../implementation/tasks/T401-ADAPTER-EVENT-SPIKE.md)
- **Date:** 2026-08-30
- **Pinned versions:** `chat@4.39.0`, `@chat-adapter/slack@4.39.0` (exact pins in `package.json`)
- **Executable evidence:** [`tests/spikes/slack-events/event-routing.spike.test.ts`](../../tests/spikes/slack-events/event-routing.spike.test.ts) — 31 assertions against the real SDK classes
- **Live probe:** re-run 2026-08-30 after the app reinstall; scopes and `users.info` confirmed, event delivery still **not** confirmed (§8)
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

**Live (partially done).** The probe has been run twice against the real workspace: once after B-04 cleared its tokens for development use, and again after the operator reinstalled the app with `chat:write` and `users:read`. Socket Mode connects end to end and `users.info` now works. No Slack event has been generated either time, because the app is still not a member of the probe channel — a membership problem, not a scope one. See §8. The envelope shapes in §6 therefore remain read from the adapter's parsing code and published docs, not confirmed against a live delivery.

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

1. **No external / guest / deactivated flag on the author.** The parsed author is `{userId, userName, fullName, email?, isBot, isSystem, isMe}`, and the adapter's cached user record (`lookupUser`) holds only `{avatarUrl, displayName, email, isBot, realName}`. D006 needs external, guest, and deactivated. T203's `SenderResolver` must therefore make its own `users.info` call, and it needs the `users:read` scope to do it — now granted and confirmed working (§8).

   **What `users.info` actually returns**, measured against the live workspace across 200 member records:

   | Field | Availability | Use |
   |---|---|---|
   | `deleted` | present on every record | `is_deactivated` — works as designed |
   | `is_restricted`, `is_ultra_restricted` | present on active records; **absent on deactivated ones**, whose records Slack trims | `is_guest` — works, and the trimming is harmless because a deactivated guest is denied either way |
   | `is_stranger` | **never returned** — absent on every record inspected, including active full members | intended `is_external` source, and it is not there |
   | `team_id` | present on every record, equal to the workspace's own team ID for internal users | the workable external check |

   **T405 must not build `is_external` on `is_stranger`.** Compare `user.team_id` against the approved workspace ID instead, and cross-check with the `is_ext_shared_channel` signal the adapter records per channel (§7.2). This is the one place where a missing field would fail *open* — an external user whose `is_stranger` is `undefined` reads as `false`, which is exactly the Slack Connect denial D006 and FR-PRV-006 require. Resolving `is_external` from `team_id` inequality keeps it fail-closed.
2. **Channel visibility is best-effort.** `adapter.getChannelVisibility(threadId)` returns `external` only for channels already seen carrying `is_ext_shared_channel`, and `unknown` before the first such event. It is a useful cross-check but **not** a sufficient basis for FR-PRV-006; the per-sender external flag remains authoritative.
3. **Other bots and apps are not filtered.** Only `isMe` is. The ambient handler needs the same `isBot`/`isSystem` check T104 applies to addressed turns.
4. **No message body is written to the state store.** The Slack adapter sets neither `persistThreadHistory` nor `persistMessageHistory`, so the Chat SDK's history append is skipped; what it does write is `slack:thread-participants:<threadId>` (user IDs) and `slack:user:<id>` (display name, real name, email). Relevant to T502: no Slack message text lands in the Chat state store, but user profile fields do.

## 8. Live probe — what ran, and what is still open

Run twice: first after **B-04** cleared the workspace's tokens for development use, then again on 2026-08-30 after the operator reinstalled the app with `chat:write` and `users:read` (**B-05**). The reinstall fixed both scope gaps. One thing still blocks event delivery, and it is not a scope.

### Confirmed live

- **The app-level token and Socket Mode work end to end.** `startSocketMode()` opens a connection to Slack, holds it, and disconnects cleanly. Socket Mode is the transport FR-SLK-011 requires, and it is proven against real Slack rather than inferred.
- **`auth.test` succeeds and the adapter's identity bootstrap works** — the adapter resolves its bot user ID and bot ID over the network, which is the `initialize()` path T106 depends on.
- **`chat:write` and `users:read` are granted.** The probe's preflight reports no missing required scope.
- **`users.info` succeeds.** This is the T203 unblock: the sender resolver now has a data source, and `deleted`, `is_restricted`, and `is_ultra_restricted` are all readable. See §7.1 for the one field that is *not* returned and what to use instead — that correction matters more than the scope fix itself.
- **`conversations.info` and `conversations.list` succeed.**

### Still blocked: the app is not in the probe channel

```
granted scopes: channels:history, channels:read, groups:history, groups:read,
                files:read, im:history, mpim:read, search:read.private,
                search:read.public, app_mentions:read, incoming-webhook,
                users:read, chat:write
missing required scopes: (none)
users.info (T203 sender resolver): { ok: true }
probe channel is_member: false
```

`conversations.info` for `GIST_DEV_CHANNEL_ID` reports `is_member: false`, `is_private: false`, `is_archived: false`. The consequences are both halves of what the probe exists to do:

- `chat.postMessage` returns **`not_in_channel`** — the probe cannot post the message it would then edit and delete.
- Slack delivers `message.channels` events only for channels an app has joined, so **no event would arrive even if someone else posted**.

The probe cannot fix this itself: `conversations.join` returns `missing_scope` with `needed: channels:join`, which is not granted.

### The remaining fix (operator, one step)

Either of these unblocks it, and neither needs a code change:

1. **Add the app to the probe channel from Slack** — open the channel, then Integrations → Add apps → add the Gist Dev app. No scope change, no reinstall.
2. **Grant `channels:join` and reinstall**, after which the probe can join the channel itself.

Option 1 is narrower and matches the T003 runbook §3, which has the operator add the app to `gist-dev-test` only. Note the granted set still differs from that manifest in other ways — `groups:*`, `files:read`, `mpim:read`, `search:read.*`, and `incoming-webhook` are present although the manifest excludes them, and `im:read` / `im:write` are absent — so DM delivery (`message.im`) is also unverified.

Then re-run:

```bash
node --env-file=.env --experimental-strip-types tests/spikes/slack-events/live-probe.ts
```

The probe preflights first, reporting granted scopes, missing scopes, `users.info` reachability, and channel membership, and exits without writing if the app cannot post. On a healthy install it posts one clearly-marked synthetic message, replies in thread, edits, deletes, and prints envelope *shapes* only — no token, no identifier, no message text.

### B-01 (open) — impact

**Unchanged for T402/T403/T404.** The handler contract in §9 rests on the offline evidence, which is complete. What stays unconfirmed is that Slack's live envelopes match the synthetic fixtures, and that `message.channels` is actually subscribed for this app — event subscriptions are not scopes and cannot be read back through the Web API without an app-configuration token. Both risks land on T405/T406, which need a live workspace regardless.

**The T203 half of this blocker is resolved.** `users:read` is granted and `users.info` works, so the sender resolver has its data source. The `is_stranger` finding in §7.1 replaces it with a sharper requirement rather than a blocker.

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
