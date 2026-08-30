/**
 * T401 spike — what the pinned Slack adapter and Chat SDK actually do with
 * ordinary (non-mention) Slack events.
 *
 * Pinned versions: `chat@4.39.0`, `@chat-adapter/slack@4.39.0`.
 *
 * These are not tests of Gist code — no Gist module is imported. They are
 * executable evidence for `docs/spikes/slack-event-support.md`: every claim in
 * that document that says "the SDK does X" is asserted here, so a version bump
 * that changes the behaviour fails a test instead of silently changing what
 * P04 was designed against.
 *
 * The whole file is offline. Synthetic Slack envelopes go into the adapter's
 * shared dispatch; nothing connects a socket and nothing calls the Slack API.
 */

import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC,
  channelMessage,
  deleteEvent,
  directMessage,
  editEvent,
  envelope,
  makeHarness,
  mentionEvent,
} from './helpers.js';

function handlers(harness: ReturnType<typeof makeHarness>): string[] {
  return harness.log.calls.map((call) => call.handler);
}

describe('ordinary channel messages reach a handler without a reply', () => {
  it('routes an ambient root message to onNewMessage only', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));

    expect(handlers(harness)).toEqual(['onNewMessage']);
    expect(harness.log.calls[0]?.messageId).toBe(SYNTHETIC.rootTs);
    // INV-6 — capturing an ambient message costs no reply and no generation.
    expect(harness.log.posts).toEqual([]);
  });

  it('routes an ambient thread reply to onNewMessage', async () => {
    const harness = makeHarness();
    await harness.deliver(
      envelope(channelMessage({ ts: SYNTHETIC.replyTs, thread_ts: SYNTHETIC.rootTs })),
    );

    expect(handlers(harness)).toEqual(['onNewMessage']);
    expect(harness.log.calls[0]?.messageId).toBe(SYNTHETIC.replyTs);
  });

  it('drops the ambient message entirely when no pattern handler is registered', async () => {
    // Ambient capture is opt-in. Without `onNewMessage`, an ordinary message
    // reaches nothing — which is the current T104 behaviour.
    const harness = makeHarness({ registerAmbient: false });
    await harness.deliver(envelope(channelMessage()));

    expect(handlers(harness)).toEqual([]);
    expect(harness.log.posts).toEqual([]);
  });

  it('only fires the patterns that match', async () => {
    const harness = makeHarness({ ambientPattern: /^deploy/ });
    await harness.deliver(envelope(channelMessage({ text: 'unrelated chatter' })));
    expect(handlers(harness)).toEqual([]);

    await harness.deliver(
      envelope(channelMessage({ ts: SYNTHETIC.replyTs, text: 'deploy is done' })),
    );
    expect(handlers(harness)).toEqual(['onNewMessage']);
  });
});

describe('thread identity', () => {
  it('collapses both Slack root encodings onto one thread id', async () => {
    // identity.md §3 — `thread_ts` absent and `thread_ts === ts` are the same
    // root and must not split a conversation across two threads.
    const withoutThreadTs = makeHarness();
    await withoutThreadTs.deliver(envelope(channelMessage()));

    const withSelfThreadTs = makeHarness();
    await withSelfThreadTs.deliver(
      envelope(channelMessage({ thread_ts: SYNTHETIC.rootTs })),
    );

    expect(withoutThreadTs.log.calls[0]?.threadId).toBe(
      withSelfThreadTs.log.calls[0]?.threadId,
    );
    expect(withoutThreadTs.log.calls[0]?.threadId).toBe(
      `slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`,
    );
  });

  it('gives a reply the same thread id as its root', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(
      envelope(channelMessage({ ts: SYNTHETIC.replyTs, thread_ts: SYNTHETIC.rootTs })),
    );

    const [root, reply] = harness.log.calls;
    expect(root?.threadId).toBe(reply?.threadId);
  });

  it('keeps the Slack ts a verbatim string, so the precision pair stays distinct', async () => {
    // slack-event.md §2 — "1735689600.000200" and "1735689600.0002" are equal
    // as floats and must not converge.
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage({ ts: SYNTHETIC.precisionTsLong })));
    await harness.deliver(envelope(channelMessage({ ts: SYNTHETIC.precisionTsShort })));

    expect(harness.log.calls.map((call) => call.messageId)).toEqual([
      SYNTHETIC.precisionTsLong,
      SYNTHETIC.precisionTsShort,
    ]);
    expect(Number(SYNTHETIC.precisionTsLong)).toBe(Number(SYNTHETIC.precisionTsShort));
  });
});

describe('an ambient catch-all does not swallow addressed traffic', () => {
  it('routes app_mention to onNewMention', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(mentionEvent()));

    expect(handlers(harness)).toEqual(['onNewMention']);
    expect(harness.log.calls[0]?.isMention).toBe(true);
  });

  it('routes a plain message containing the bot mention to onNewMention', async () => {
    // Mention detection is text-based in the Chat class, not event-type based,
    // so the `message.channels` copy of a mention is still addressed traffic.
    const harness = makeHarness();
    await harness.deliver(
      envelope(channelMessage({ text: `<@${SYNTHETIC.botUserId}> what changed?` })),
    );

    expect(handlers(harness)).toEqual(['onNewMention']);
  });

  it('collapses Slack duplicate delivery of message + app_mention into one call', async () => {
    // Slack sends both events for a mention in a joined channel; they share a
    // ts, and the Chat dedupe key is the ts.
    const harness = makeHarness();
    await harness.deliver(
      envelope(channelMessage({ text: `<@${SYNTHETIC.botUserId}> what changed?` })),
    );
    await harness.deliver(envelope(mentionEvent()));

    expect(handlers(harness)).toEqual(['onNewMention']);
  });

  it('routes a direct message to onDirectMessage', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(directMessage()));

    expect(handlers(harness)).toEqual(['onDirectMessage']);
    expect(harness.log.calls[0]?.threadId).toBe(`slack:${SYNTHETIC.dmConversation}:`);
  });
});

describe('the subscribed-thread hazard', () => {
  it('routes an ordinary message in a subscribed thread to onSubscribedMessage', async () => {
    // This is the finding P04 has to design around: once Gist subscribes to a
    // thread (T104 does this on first mention), an ordinary non-mention
    // message in that thread is no longer ambient. It arrives on the addressed
    // handler, which generates and replies.
    const harness = makeHarness();
    await harness.state.subscribe(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);

    await harness.deliver(
      envelope(
        channelMessage({
          ts: SYNTHETIC.replyTs,
          thread_ts: SYNTHETIC.rootTs,
          text: 'unrelated follow-up with no mention',
        }),
      ),
    );

    expect(handlers(harness)).toEqual(['onSubscribedMessage']);
    expect(handlers(harness)).not.toContain('onNewMessage');
    expect(harness.log.calls[0]?.isMention).toBe(false);
  });

  it('leaves messages in a sibling thread ambient', async () => {
    // Subscription is per thread, not per channel, so ambient capture in the
    // rest of the channel is unaffected.
    const harness = makeHarness();
    await harness.state.subscribe(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);

    await harness.deliver(envelope(channelMessage({ ts: '1735690000.000100' })));

    expect(handlers(harness)).toEqual(['onNewMessage']);
  });
});

describe('non-human senders', () => {
  it('drops the bot own messages before any handler', async () => {
    const harness = makeHarness();
    await harness.deliver(
      envelope(channelMessage({ user: SYNTHETIC.botUserId, username: 'Gist' })),
    );

    expect(handlers(harness)).toEqual([]);
  });

  it('delivers another bot message to the handler, flagged as a bot', async () => {
    // The SDK filters only `isMe`. FR-SLK-009 filtering of other bots and apps
    // stays the application's job — T104 already does it for addressed turns,
    // and the ambient path will need the same check.
    const harness = makeHarness();
    let sawBot: boolean | undefined;
    harness.bot.onNewMessage(/[\s\S]*/, async (_thread, message) => {
      sawBot = message.author.isBot === true;
    });

    await harness.deliver(
      envelope(
        channelMessage({
          user: undefined,
          bot_id: SYNTHETIC.otherBotId,
          username: 'Some Other Bot',
        }),
      ),
    );

    expect(handlers(harness)).toContain('onNewMessage');
    expect(sawBot).toBe(true);
  });

  it('ignores join and leave subtypes at the adapter', async () => {
    const harness = makeHarness();
    for (const subtype of ['channel_join', 'channel_leave', 'channel_topic', 'tombstone']) {
      await harness.deliver(envelope(channelMessage({ subtype, ts: `17356900.0001${subtype.length}` })));
    }

    expect(handlers(harness)).toEqual([]);
  });
});

describe('edits and deletes (D005)', () => {
  it('routes an edit to onMessageUpdated with the pre-edit text', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(editEvent()));

    expect(handlers(harness)).toEqual(['onMessageUpdated']);
    const call = harness.log.calls[0];
    expect(call?.messageId).toBe(SYNTHETIC.rootTs);
    expect(call?.text).toBe('the rollout window moved to Wednesday');
    expect(call?.previousText).toBe('the rollout window moved to Tuesday');
  });

  it('never routes an edit through the message handlers', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(editEvent()));

    expect(handlers(harness)).not.toContain('onNewMessage');
    expect(handlers(harness)).not.toContain('onNewMention');
    expect(handlers(harness)).not.toContain('onSubscribedMessage');
  });

  it('gives an edit the same thread id as the message it edits', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(envelope(editEvent()));

    const [original, edit] = harness.log.calls;
    expect(edit?.threadId).toBe(original?.threadId);
  });

  it('ignores a message_changed that carries no content change', async () => {
    const harness = makeHarness();
    await harness.deliver(
      envelope(
        editEvent({
          message: {
            type: 'message',
            user: SYNTHETIC.user,
            username: `synthetic.${SYNTHETIC.user}`,
            text: 'the rollout window moved to Tuesday',
            ts: SYNTHETIC.rootTs,
          },
        }),
      ),
    );

    expect(handlers(harness)).toEqual([]);
  });

  it('routes a delete to onMessageDeleted with the platform ids', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(deleteEvent()));

    expect(handlers(harness)).toEqual(['onMessageDeleted']);
    const call = harness.log.calls[0];
    expect(call?.messageId).toBe(SYNTHETIC.rootTs);
    expect(call?.threadId).toBe(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);
    expect(call?.previousText).toBe('the rollout window moved to Tuesday');
  });

  it('dispatches a mutation for a message it never saw', async () => {
    // slack-event.md §4 — a mutation for a never-stored message must be a
    // no-op success. The SDK hands it over regardless, so the decision is the
    // application's, which is what lets T404 deny before any storage lookup.
    const harness = makeHarness();
    await harness.deliver(envelope(deleteEvent({ deleted_ts: '1735000000.000100' })));

    expect(handlers(harness)).toEqual(['onMessageDeleted']);
  });

  it('does NOT deduplicate a replayed mutation', async () => {
    // Mutations bypass the dedupe and lock routing used for new messages, so
    // idempotency for edits and deletes is entirely T404's responsibility.
    const harness = makeHarness();
    const replayed = envelope(deleteEvent());
    await harness.deliver(replayed);
    await harness.deliver(replayed);

    expect(handlers(harness)).toEqual(['onMessageDeleted', 'onMessageDeleted']);
  });
});

describe('duplicate delivery', () => {
  it('processes one message once, however many envelopes carry it', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(envelope(channelMessage()));

    expect(handlers(harness)).toEqual(['onNewMessage']);
  });

  it('keys content dedupe on the Slack ts', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));

    expect(await harness.state.get(`dedupe:slack:${SYNTHETIC.rootTs}`)).not.toBeNull();
  });

  it('records an event-delivery marker keyed on the Slack event id', async () => {
    // The adapter consults this marker only on a retry (retry_num > 0), so a
    // first delivery pays no state read and an event that was never dispatched
    // is still recovered by the retry.
    const harness = makeHarness();
    const payload = envelope(channelMessage());
    await harness.deliver(payload);

    expect(await harness.state.get(`slack:event-delivered:${String(payload.event_id)}`)).toBe(
      true,
    );
  });

  it('treats two different messages as two messages', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(envelope(channelMessage({ ts: SYNTHETIC.replyTs })));

    expect(handlers(harness)).toEqual(['onNewMessage', 'onNewMessage']);
  });
});

describe('what the ambient path carries', () => {
  it('exposes the raw Slack event, so workspace and subtype survive', async () => {
    const harness = makeHarness();
    let raw: Record<string, unknown> | undefined;
    harness.bot.onNewMessage(/[\s\S]*/, async (_thread, message) => {
      raw = message.raw as Record<string, unknown>;
    });

    await harness.deliver(envelope(channelMessage()));

    expect(raw?.team).toBe(SYNTHETIC.workspace);
    expect(raw?.ts).toBe(SYNTHETIC.rootTs);
    expect(raw?.channel).toBe(SYNTHETIC.channel);
    expect(raw?.channel_type).toBe('channel');
  });

  it('carries no external, guest, or deactivated flag on the author', async () => {
    // The parsed author is {userId, userName, fullName, email?, isBot,
    // isSystem, isMe}. D006 needs external / guest / deactivated, so T203's
    // sender resolver has to make its own users.info call — the adapter's
    // cached user record does not answer those questions.
    const harness = makeHarness();
    let authorKeys: string[] = [];
    harness.bot.onNewMessage(/[\s\S]*/, async (_thread, message) => {
      authorKeys = Object.keys(message.author).sort();
    });

    await harness.deliver(envelope(channelMessage()));

    expect(authorKeys).not.toContain('isExternal');
    expect(authorKeys).not.toContain('isGuest');
    expect(authorKeys).not.toContain('isDeactivated');
    expect(authorKeys).toContain('isBot');
  });

  it('marks an externally shared channel on the adapter', async () => {
    // FR-PRV-006 — the envelope's `is_ext_shared_channel` is the only signal
    // available at dispatch time, and the adapter records it per channel.
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage(), { is_ext_shared_channel: true }));

    const visibility = (
      harness.adapter as unknown as { getChannelVisibility: (threadId: string) => string }
    ).getChannelVisibility(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);
    expect(visibility).toBe('external');
  });

  it('reports a normal public channel as workspace visibility', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));

    const visibility = (
      harness.adapter as unknown as { getChannelVisibility: (threadId: string) => string }
    ).getChannelVisibility(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);
    expect(visibility).toBe('workspace');
  });
});
