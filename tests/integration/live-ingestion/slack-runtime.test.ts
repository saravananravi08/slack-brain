import type { SlackAdapter } from '@chat-adapter/slack';
import type { Chat, WebhookOptions } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import type {
  AmbientPersistenceInput,
  CheckOriginalInput,
  HandleMutationInput,
} from '../../../src/ingestion/index.js';
import { createLiveSlackChannel } from '../../../src/mastra/channels/slack.js';
import type { PolicySnapshot, SenderAttributes } from '../../../src/security/index.js';
import { makeMessage, makeThread } from '../../channels/helpers.js';
import {
  SYNTHETIC,
  channelMessage,
  deleteEvent,
  editEvent,
  envelope,
  makeMemoryState,
  mentionEvent,
} from '../../spikes/slack-events/helpers.js';

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
};

const POLICY: PolicySnapshot = {
  approved_workspace_id: SYNTHETIC.workspace,
  approved_channel_ids: [SYNTHETIC.channel],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

interface AdapterInternals {
  _botUserId: string;
  chat: Chat;
  lookupUser(userId: string): Promise<unknown>;
  postMessage(threadId: string, body: unknown): Promise<unknown>;
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
  startTyping(threadId: string): Promise<void>;
}

function makeHarness(state = makeMemoryState()) {
  const posts: Array<{ threadId: string; body: unknown }> = [];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const generation = vi.fn(async () => 'Synthetic reply.');
  const resolveSender = vi.fn(async () => FULL_MEMBER);
  const persist = vi.fn(async (_input: AmbientPersistenceInput) => ({
    outcome: 'inserted' as const,
  }));
  const shouldSuppressOriginal = vi.fn(async (_input: CheckOriginalInput) => ({
    status: 'allowed' as const,
    suppressed: false,
  }));
  const handleMutation = vi.fn(async (_input: HandleMutationInput) => ({
    status: 'unchanged' as const,
    message_key: `${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.rootTs}` as const,
  }));

  let channel: ReturnType<typeof createLiveSlackChannel>;
  channel = createLiveSlackChannel({
    credentials: {
      botToken: SYNTHETIC.botToken,
      appToken: SYNTHETIC.appToken,
    },
    state,
    policy: POLICY,
    logger,
    resolveSender,
    ambientPersistence: { persist },
    mutations: {
      handle: handleMutation,
      shouldSuppressOriginal,
    },
    authorize: async (request) =>
      channel.adapter.getChannelVisibility(request.threadId) === 'external'
        ? { allowed: false, reason: 'external_user' }
        : { allowed: true, reason: null },
    respond: generation,
  });

  const adapter = channel.adapter as unknown as AdapterInternals;
  adapter._botUserId = SYNTHETIC.botUserId;
  adapter.lookupUser = async (userId) => ({
    displayName: `synthetic.${userId}`,
    realName: `Synthetic ${userId}`,
    isBot: false,
  });
  adapter.postMessage = async (threadId, body) => {
    posts.push({ threadId, body });
    return { id: 'synthetic-post', raw: {} };
  };
  adapter.startTyping = async () => undefined;
  adapter.chat = channel.bot;

  const pending: Array<Promise<unknown>> = [];
  const chatInternals = channel.bot as unknown as Record<string, (...args: never[]) => unknown>;
  for (const method of ['processMessage', 'processMessageUpdated', 'processMessageDeleted']) {
    const original = chatInternals[method];
    if (typeof original !== 'function') throw new Error(`Missing Chat.${method}`);
    const bound = original.bind(channel.bot);
    chatInternals[method] = (...args: never[]) => {
      const result = bound(...args);
      pending.push(Promise.resolve(result));
      return result;
    };
  }

  async function deliver(...payloads: Array<Record<string, unknown>>): Promise<void> {
    for (const payload of payloads) {
      adapter.processEventPayload(payload, {
        waitUntil: (task) => pending.push(task),
      });
    }
    for (let round = 0; round < 8; round += 1) {
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) await Promise.all(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (pending.length === 0 && round > 0) return;
    }
    throw new Error('Synthetic Slack delivery did not settle.');
  }

  return {
    adapter,
    channel,
    generation,
    handleMutation,
    logger,
    persist,
    posts,
    resolveSender,
    shouldSuppressOriginal,
    state,
    deliver,
  };
}

describe('live silent Slack ingestion', () => {
  it('persists an approved ambient message with zero generation calls and zero replies', async () => {
    const harness = makeHarness();
    const payload = envelope(channelMessage());

    await harness.deliver(payload);

    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.persist.mock.calls[0]?.[0]).toMatchObject({
      event: {
        class: 'ambient',
        event_id: payload.event_id,
        message_ts: SYNTHETIC.rootTs,
        addressed_to_gist: false,
      },
      sender_name: `synthetic.${SYNTHETIC.user}`,
    });
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('rate-limits warnings when the adapter delivery context is missing', async () => {
    const harness = makeHarness();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const thread = makeThread().thread;
    const message = makeMessage();

    try {
      await harness.channel.liveHandlers.onAmbientMessage(thread, message);
      await harness.channel.liveHandlers.onAmbientMessage(thread, message);
      now.mockReturnValue(1_059_999);
      await harness.channel.liveHandlers.onAmbientMessage(thread, message);

      expect(harness.logger.warn).toHaveBeenCalledOnce();
      expect(harness.logger.warn).toHaveBeenLastCalledWith(
        'ingestion.delivery_context.missing',
        { reason: 'missing_delivery_context' },
      );

      now.mockReturnValue(1_060_000);
      await harness.channel.liveHandlers.onAmbientMessage(thread, message);

      expect(harness.logger.warn).toHaveBeenCalledTimes(2);
      expect(harness.persist).not.toHaveBeenCalled();
      expect(harness.generation).not.toHaveBeenCalled();
      expect(harness.posts).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('persists subscribed-thread input once while the addressed path replies once', async () => {
    const harness = makeHarness();
    await harness.state.subscribe(`slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`);
    const payload = envelope(channelMessage({
      ts: SYNTHETIC.replyTs,
      thread_ts: SYNTHETIC.rootTs,
      text: 'synthetic subscribed follow-up',
    }));

    await harness.deliver(payload);

    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.persist.mock.calls[0]?.[0].event).toMatchObject({
      class: 'ambient',
      message_ts: SYNTHETIC.replyTs,
    });
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('keeps a mention on the response path with exactly one reply', async () => {
    const harness = makeHarness();

    await harness.deliver(envelope(mentionEvent()));

    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
    expect(harness.persist).not.toHaveBeenCalled();
  });

  it('deduplicates replayed mutations before storage and never replies', async () => {
    const harness = makeHarness();
    const replayed = envelope(deleteEvent());

    await harness.deliver(replayed);
    await harness.deliver(replayed);

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.handleMutation.mock.calls[0]?.[0].event.mutation?.kind).toBe('delete');
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('does not content-deduplicate distinct edits of the same message', async () => {
    const harness = makeHarness();

    await harness.deliver(envelope(editEvent()), envelope(editEvent()));

    expect(harness.handleMutation).toHaveBeenCalledTimes(2);
    expect(harness.handleMutation.mock.calls.every(
      ([input]) => input.event.mutation?.kind === 'edit',
    )).toBe(true);
  });

  it('keeps mutation retry claims across channel re-composition', async () => {
    const first = makeHarness();
    const replayed = envelope(deleteEvent());
    await first.deliver(replayed);

    const restarted = makeHarness(first.state);
    await restarted.deliver(replayed);

    expect(first.handleMutation).toHaveBeenCalledOnce();
    expect(restarted.handleMutation).not.toHaveBeenCalled();
    expect(restarted.generation).not.toHaveBeenCalled();
    expect(restarted.posts).toEqual([]);
  });

  it('routes edits and deletes through the idempotent mutation handler', async () => {
    const harness = makeHarness();

    await harness.deliver(envelope(editEvent()), envelope(deleteEvent()));

    expect(harness.handleMutation).toHaveBeenCalledTimes(2);
    expect(harness.handleMutation.mock.calls.map(([input]) => input.event.mutation?.kind).sort())
      .toEqual(['delete', 'edit']);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('ignores bot, system, and unapproved-channel events before persistence', async () => {
    const harness = makeHarness();
    const otherBot = envelope(channelMessage({
      user: undefined,
      bot_id: SYNTHETIC.otherBotId,
      username: 'Synthetic Bot',
      ts: '1735690000.000100',
    }));
    const system = envelope(channelMessage({
      subtype: 'channel_join',
      ts: '1735690001.000100',
    }));
    const unapproved = envelope(channelMessage({
      channel: 'C0UNAPPROV9',
      ts: '1735690002.000100',
    }));

    await harness.deliver(otherBot, system, unapproved);

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.handleMutation).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
    expect(await harness.state.get(
      `content:${SYNTHETIC.workspace}/C0UNAPPROV9/1735690002.000100`,
    )).toBeNull();
  });

  it.each([
    ['envelope', channelMessage(), { is_ext_shared_channel: true }],
    ['inner event', channelMessage({ is_ext_shared: true }), {}],
  ])('denies an externally shared channel signaled by the %s', async (_name, event, flags) => {
    const harness = makeHarness();

    await harness.deliver(envelope(event, flags));

    expect(harness.resolveSender).toHaveBeenCalledOnce();
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('denies externally shared-channel mentions before generation', async () => {
    const harness = makeHarness();

    await harness.deliver(envelope(mentionEvent({ is_ext_shared: true })));

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts.map(({ body }) => body)).toEqual(["I can't help with that here."]);
  });

  it('suppresses an original covered by a deletion tombstone', async () => {
    const harness = makeHarness();
    harness.shouldSuppressOriginal.mockResolvedValueOnce({
      status: 'allowed',
      suppressed: true,
    });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.shouldSuppressOriginal).toHaveBeenCalledOnce();
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('derives sender externality from team identity, not is_stranger', async () => {
    const { resolveSlackSender } = await import('../../../src/mastra/index.js');
    const usersInfo = vi.fn(async () => ({
      ok: true,
      user: {
        id: SYNTHETIC.user,
        team_id: SYNTHETIC.workspace,
        is_stranger: true,
        is_bot: false,
        deleted: false,
      },
    }));
    const adapter = {
      webClient: { users: { info: usersInfo } },
    } as unknown as SlackAdapter;

    await expect(resolveSlackSender(adapter, {
      workspaceId: SYNTHETIC.workspace,
      senderId: SYNTHETIC.user,
    })).resolves.toMatchObject({ isExternal: false });
  });

  it('keeps envelope IDs isolated when ambient deliveries resolve concurrently', async () => {
    const harness = makeHarness();
    let lookup = 0;
    harness.adapter.lookupUser = async (userId) => {
      lookup += 1;
      if (lookup === 1) await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        displayName: `synthetic.${userId}`,
        realName: `Synthetic ${userId}`,
        isBot: false,
      };
    };
    const first = envelope(channelMessage({ ts: '1735690100.000100' }));
    const second = envelope(channelMessage({ ts: '1735690101.000100' }));

    await harness.deliver(first, second);

    const identities = new Map(
      harness.persist.mock.calls.map(([input]) => [
        input.event.message_ts,
        input.event.event_id,
      ]),
    );
    expect(identities).toEqual(new Map([
      ['1735690100.000100', first.event_id],
      ['1735690101.000100', second.event_id],
    ]));
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });
});
