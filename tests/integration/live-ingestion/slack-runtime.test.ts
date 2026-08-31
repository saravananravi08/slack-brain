import type { SlackAdapter } from '@chat-adapter/slack';
import type { Chat, WebhookOptions } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import type {
  AmbientPersistenceInput,
  ChannelMessageRecord,
  CheckOriginalInput,
  HandleMutationInput,
} from '../../../src/ingestion/index.js';
import type { ChannelContext } from '../../../src/channel-memory/context/index.js';
import { ProactiveActionGate } from '../../../src/mastra/channels/proactive.js';
import { createLiveSlackChannel } from '../../../src/mastra/channels/slack.js';
import type {
  ChannelAuthorizationDecision,
  ChannelRequest,
} from '../../../src/mastra/channels/types.js';
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
  routeSocketEvent(
    body: Record<string, unknown>,
    eventType: string,
    ack: () => Promise<void>,
  ): Promise<void>;
  startTyping(threadId: string): Promise<void>;
}

interface HarnessOptions {
  readonly p06?: boolean;
  readonly authorizeCaptured?: ChannelAuthorizationDecision;
  readonly mutationStatus?: 'unchanged' | 'updated';
  readonly proactiveAct?: boolean;
  readonly proactiveChannelIds?: readonly string[];
  readonly proactiveCooldownMs?: number;
  readonly proactiveError?: Error;
  readonly proactiveNow?: () => number;
  readonly proactiveEnrolled?: boolean;
}

function makeHarness(state = makeMemoryState(), options: HarnessOptions = {}) {
  const posts: Array<{ threadId: string; body: unknown }> = [];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const generation = vi.fn(async (_request: ChannelRequest) => 'Synthetic reply.');
  const resolveSender = vi.fn(async () => FULL_MEMBER);
  const persist = vi.fn(async (_input: AmbientPersistenceInput) => ({
    outcome: 'inserted' as const,
  }));
  const channelPersist = vi.fn(async (_record: ChannelMessageRecord) => ({
    outcome: 'inserted' as const,
    embedding: 'stored' as const,
  }));
  const shouldSuppressOriginal = vi.fn(async (_input: CheckOriginalInput) => ({
    status: 'allowed' as const,
    suppressed: false,
  }));
  const handleMutation = vi.fn(async (_input: HandleMutationInput) => ({
    status: options.mutationStatus ?? 'unchanged',
    message_key: `${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.rootTs}` as const,
  }));
  const classifyProactive = vi.fn(async () => {
    if (options.proactiveError) throw options.proactiveError;
    return { act: options.proactiveAct ?? false, reason: 'synthetic_relevance' };
  });
  const proactiveContext = vi.fn(async () => ({} as ChannelContext));
  const proactiveEnrollment = vi.fn(async () => options.proactiveEnrolled ?? true);
  const proactive = options.proactiveChannelIds === undefined
    ? undefined
    : new ProactiveActionGate({
        channelIds: options.proactiveChannelIds,
        cooldownMs: options.proactiveCooldownMs ?? 60_000,
        classifier: { classify: classifyProactive },
        contextFor: proactiveContext,
        isEnrolled: proactiveEnrollment,
        ...(options.proactiveNow === undefined ? {} : { now: options.proactiveNow }),
      });

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
    ...(options.p06 ? {
      enrollment: {
        applyMembershipFact: async () => ({ outcome: 'unchanged' as const, reason: null }),
        captureEligibilityFor: async () => ({
          capture: true as const,
          reason: null,
          enrollment_epoch: 1,
        }),
        enrollmentFor: async () => null,
      },
      channelPersistence: { persist: channelPersist },
      idempotencyLedger: {
        claim: (key: string, ttlMs: number) => state.setIfNotExists(key, true, ttlMs),
      },
      authorizeCaptured: async () => options.authorizeCaptured ?? {
        allowed: true as const,
        reason: null,
      },
    } : { ambientPersistence: { persist } }),
    mutations: {
      handle: handleMutation,
      shouldSuppressOriginal,
    },
    ...(proactive === undefined ? {} : { proactive }),
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

  function dispatch(payload: Record<string, unknown>): void {
    adapter.processEventPayload(payload, {
      waitUntil: (task) => pending.push(task),
    });
  }

  async function drain(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) await Promise.all(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (pending.length === 0 && round > 0) return;
    }
    throw new Error('Synthetic Slack delivery did not settle.');
  }

  async function deliver(...payloads: Array<Record<string, unknown>>): Promise<void> {
    payloads.forEach(dispatch);
    await drain();
  }

  return {
    adapter,
    channel,
    channelPersist,
    classifyProactive,
    dispatch,
    drain,
    generation,
    handleMutation,
    logger,
    persist,
    posts,
    proactiveContext,
    proactiveEnrollment,
    resolveSender,
    shouldSuppressOriginal,
    state,
    deliver,
  };
}

function mentionEdit(options: {
  readonly bot?: boolean;
  readonly previousMention?: boolean;
  readonly reply?: boolean;
} = {}): Record<string, unknown> {
  const targetTs = options.reply ? SYNTHETIC.replyTs : SYNTHETIC.rootTs;
  const sender = options.bot
    ? { bot_id: SYNTHETIC.otherBotId, username: 'Synthetic Bot' }
    : { user: SYNTHETIC.user, username: `synthetic.${SYNTHETIC.user}` };
  const thread = options.reply ? { thread_ts: SYNTHETIC.rootTs } : {};
  return editEvent({
    message: {
      type: 'message',
      ...sender,
      text: `<@${SYNTHETIC.botUserId}> synthetic edited question`,
      ts: targetTs,
      ...thread,
    },
    previous_message: {
      type: 'message',
      ...sender,
      text: options.previousMention
        ? `<@${SYNTHETIC.botUserId}> synthetic prior question`
        : 'synthetic prior statement',
      ts: targetTs,
      ...thread,
    },
  });
}

describe('D019/D020 edit-to-mention response trigger', () => {
  function p06Harness(authorizeCaptured?: ChannelAuthorizationDecision) {
    return makeHarness(makeMemoryState(), {
      p06: true,
      mutationStatus: 'updated',
      ...(authorizeCaptured === undefined ? {} : { authorizeCaptured }),
    });
  }

  it('responds exactly once when a human root edit newly adds a Gist mention', async () => {
    const harness = p06Harness();

    await harness.deliver(envelope(mentionEdit()));

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('responds exactly once in-thread when a human reply edit newly adds a Gist mention', async () => {
    const harness = p06Harness();

    await harness.deliver(envelope(mentionEdit({ reply: true })));

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.generation.mock.calls[0]?.[0]).toMatchObject({
      messageTs: SYNTHETIC.replyTs,
      threadId: `slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`,
    });
    expect(harness.posts).toEqual([
      expect.objectContaining({
        threadId: `slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`,
      }),
    ]);
  });

  it('does not respond to a bot reply edit that adds a Gist mention', async () => {
    const harness = p06Harness();

    await harness.deliver(envelope(mentionEdit({ bot: true, reply: true })));

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('does not respond twice when a qualifying reply edit is replayed', async () => {
    const harness = p06Harness();
    const replayed = envelope(mentionEdit({ reply: true }));

    await harness.deliver(replayed);
    await harness.deliver(replayed);

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('does not respond when the previous reply text already mentioned Gist', async () => {
    const harness = p06Harness();

    await harness.deliver(envelope(mentionEdit({ previousMention: true, reply: true })));

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('does not respond when reply-edit response authorization fails', async () => {
    const harness = p06Harness({ allowed: false, reason: 'guest_user' });

    await harness.deliver(envelope(mentionEdit({ reply: true })));

    expect(harness.handleMutation).toHaveBeenCalledOnce();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });
});

describe('D021 proactive action mode', () => {
  function proactiveHarness(options: HarnessOptions = {}) {
    return makeHarness(makeMemoryState(), {
      p06: true,
      proactiveChannelIds: [],
      ...options,
    });
  }

  it('routes an enrolled unaddressed human root through the default-all gate', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.proactiveEnrollment).toHaveBeenCalledWith(
      SYNTHETIC.workspace,
      SYNTHETIC.channel,
    );
    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
    expect(harness.logger.info).toHaveBeenCalledWith(
      'channel.proactive.gate.evaluated',
      { channelAlias: SYNTHETIC.channel, count: 1 },
    );
    const [, fields] = harness.logger.info.mock.calls.find(
      ([event]) => event === 'channel.proactive.gate.evaluated',
    )!;
    expect(Object.keys(fields as object).sort()).toEqual(['channelAlias', 'count']);
    expect(JSON.stringify(fields)).not.toContain('synthetic proactive candidate');
  });

  it('routes a real Socket Mode events_api delivery through ambient and gate stages', async () => {
    const harness = proactiveHarness({ proactiveAct: true });
    const ack = vi.fn(async () => undefined);

    await harness.adapter.routeSocketEvent(
      envelope(channelMessage()),
      'events_api',
      ack,
    );
    await harness.drain();

    expect(ack).toHaveBeenCalledOnce();
    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    const proactiveLogs = harness.logger.info.mock.calls.filter(
      ([event]) => event.startsWith('channel.proactive.'),
    );
    expect(proactiveLogs.map(([event]) => event)).toEqual(expect.arrayContaining([
      'channel.proactive.path.raw_received',
      'channel.proactive.candidate.eligible',
      'channel.proactive.path.capture_routed',
      'channel.proactive.path.ambient_received',
      'channel.proactive.gate.evaluated',
      'channel.proactive.gate.decided',
    ]));
    const serialized = JSON.stringify(proactiveLogs);
    expect(serialized).not.toContain('the rollout window moved to Tuesday');
    expect(serialized).not.toContain(SYNTHETIC.user);
  });

  it('responds in-thread when an unaddressed human reply is relevant', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(channelMessage({
      ts: SYNTHETIC.replyTs,
      event_ts: SYNTHETIC.replyTs,
      thread_ts: SYNTHETIC.rootTs,
    })));

    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.posts).toEqual([
      expect.objectContaining({
        threadId: `slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`,
      }),
    ]);
  });

  it('does nothing when an unaddressed human message is not relevant', async () => {
    const harness = proactiveHarness({ proactiveAct: false });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('excludes bot senders before proactive classification', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(channelMessage({
      user: undefined,
      bot_id: SYNTHETIC.otherBotId,
      username: 'Synthetic Bot',
    })));

    expect(harness.channelPersist).toHaveBeenCalledOnce();
    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.proactiveContext).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('excludes app senders before proactive classification', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(channelMessage({
      user: undefined,
      app_id: 'A0OTHERAPP',
      username: 'Synthetic App',
    })));

    expect(harness.channelPersist).toHaveBeenCalledOnce();
    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.proactiveContext).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('excludes Gist senders before proactive classification', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(channelMessage({
      user: SYNTHETIC.botUserId,
      text: 'synthetic urgent action request',
    })));

    expect(harness.channelPersist).toHaveBeenCalledOnce();
    expect(harness.channelPersist.mock.calls[0]?.[0].sender.sender_class).toBe('gist');
    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.proactiveContext).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('captures a proactive response echo without re-evaluation or a loop', async () => {
    const harness = proactiveHarness({ proactiveAct: true });
    await harness.deliver(envelope(channelMessage()));

    const echoed = envelope(channelMessage({
      user: SYNTHETIC.botUserId,
      text: 'Synthetic reply.',
      ts: '1735690300.000100',
      event_ts: '1735690300.000100',
      thread_ts: SYNTHETIC.rootTs,
    }));
    await harness.deliver(echoed);
    await harness.deliver(echoed);

    expect(harness.channelPersist).toHaveBeenCalledTimes(2);
    expect(harness.channelPersist.mock.calls[1]?.[0].sender.sender_class).toBe('gist');
    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('denies unauthorized candidates before context or classification', async () => {
    const harness = proactiveHarness({
      authorizeCaptured: { allowed: false, reason: 'guest_user' },
      proactiveAct: true,
    });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.proactiveContext).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('blocks a rapid second proactive action in the same channel', async () => {
    const harness = proactiveHarness({
      proactiveAct: true,
      proactiveCooldownMs: 60_000,
      proactiveNow: () => 1_000,
    });

    await harness.deliver(envelope(channelMessage()));
    await harness.deliver(envelope(channelMessage({
      ts: '1735690310.000100',
      event_ts: '1735690310.000100',
    })));

    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('deduplicates replayed proactive candidates', async () => {
    const harness = proactiveHarness({ proactiveAct: true });
    const replayed = envelope(channelMessage());

    await harness.deliver(replayed);
    await harness.deliver(replayed);

    expect(harness.classifyProactive).toHaveBeenCalledOnce();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('keeps a non-empty channel list restrictive', async () => {
    const harness = proactiveHarness({
      proactiveAct: true,
      proactiveChannelIds: ['C0OTHER001'],
    });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.channelPersist).toHaveBeenCalledOnce();
    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('fails closed with a content-free log when classification throws', async () => {
    const harness = proactiveHarness({
      proactiveError: new Error('synthetic classifier failure'),
    });

    await harness.deliver(envelope(channelMessage()));

    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
    expect(harness.logger.error).toHaveBeenCalledWith(
      'channel.proactive.classification.failed',
      { channelAlias: SYNTHETIC.channel, errorClass: 'model_unavailable' },
    );
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain('rollout window');
  });

  it('keeps addressed mentions out of proactive classification', async () => {
    const harness = proactiveHarness({ proactiveAct: true });

    await harness.deliver(envelope(mentionEvent()));

    expect(harness.classifyProactive).not.toHaveBeenCalled();
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });
});

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
      class: 'addressed',
      message_ts: SYNTHETIC.replyTs,
      addressed_to_gist: true,
    });
    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
  });

  it('keeps a mention on the response path with exactly one reply', async () => {
    const harness = makeHarness();

    await harness.deliver(envelope(mentionEvent()));

    expect(harness.generation).toHaveBeenCalledOnce();
    expect(harness.generation.mock.calls[0]?.[0]).toMatchObject({
      channelId: SYNTHETIC.channel,
      threadId: `slack:${SYNTHETIC.channel}:${SYNTHETIC.rootTs}`,
    });
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

  it('drops a same-thread ambient reply while its root is still being persisted', async () => {
    const harness = makeHarness();
    let releaseFirstPersist!: () => void;
    const firstPersist = new Promise<{ outcome: 'inserted' }>((resolve) => {
      releaseFirstPersist = () => resolve({ outcome: 'inserted' });
    });
    harness.persist.mockImplementationOnce(() => firstPersist);
    const root = envelope(channelMessage({ ts: SYNTHETIC.rootTs }));
    const reply = envelope(channelMessage({
      ts: SYNTHETIC.replyTs,
      event_ts: SYNTHETIC.replyTs,
      thread_ts: SYNTHETIC.rootTs,
    }));

    harness.dispatch(root);
    harness.dispatch(reply);

    await vi.waitFor(() => expect(harness.persist).toHaveBeenCalledOnce());
    releaseFirstPersist();
    await expect(harness.drain()).rejects.toMatchObject({ code: 'LOCK_FAILED' });

    expect(harness.persist.mock.calls.map(([input]) => input.event.message_ts))
      .toEqual([SYNTHETIC.rootTs]);
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
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

/**
 * F-19 instrumentation — the drop is counted, not just pinned.
 *
 * The design review accepted the concurrency drop and deferred the fix, because
 * the choice turns on how often it happens and nobody knows that number. These
 * assert that the number now exists and reaches the log.
 *
 * The counter hangs off the SDK's supported `onLockConflict` hook, which fires
 * on contention and must keep returning `'drop'` — instrumentation observes the
 * behaviour, it does not change it.
 */
describe('F-19: concurrency drops are counted and surfaced', () => {
  let dropSequence = 0;

  /**
   * Force exactly one thread-lock contention.
   *
   * Each call uses a fresh timestamp pair. Reusing them would let the content
   * dedupe (`dedupe:slack:<ts>`) discard the second delivery *before* it ever
   * reaches the lock, so the test would pass while measuring nothing.
   */
  async function forceOneDrop(harness: ReturnType<typeof makeHarness>): Promise<void> {
    dropSequence += 1;
    const rootTs = `173568${9000 + dropSequence}.000100`;
    const replyTs = `173568${9000 + dropSequence}.000200`;

    const persistCallsBefore = harness.persist.mock.calls.length;
    let release!: () => void;
    const held = new Promise<{ outcome: 'inserted' }>((resolve) => {
      release = () => resolve({ outcome: 'inserted' });
    });
    harness.persist.mockImplementationOnce(() => held);

    harness.dispatch(envelope(channelMessage({ ts: rootTs, event_ts: rootTs })));
    harness.dispatch(
      envelope(
        channelMessage({ ts: replyTs, event_ts: replyTs, thread_ts: rootTs }),
      ),
    );

    await vi.waitFor(() =>
      expect(harness.persist.mock.calls.length).toBe(persistCallsBefore + 1),
    );
    release();
    await expect(harness.drain()).rejects.toMatchObject({ code: 'LOCK_FAILED' });
  }

  it('counts a same-thread drop and warns with the reason and totals', async () => {
    const harness = makeHarness();
    expect(harness.channel.concurrencyDrops()).toMatchObject({
      total: 0,
      lastDropAt: null,
    });

    await forceOneDrop(harness);

    const counter = harness.channel.concurrencyDrops();
    expect(counter.total).toBe(1);
    expect(counter.lastDropAt).toEqual(expect.any(Number));

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'ingestion.concurrency.dropped',
      expect.objectContaining({
        reason: 'thread_lock_contention',
        total: 1,
        sinceLastWarning: 1,
      }),
    );

    // Behaviour unchanged: exactly one of the two messages persisted — the
    // root — and nothing generated or posted.
    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.generation).not.toHaveBeenCalled();
    expect(harness.posts).toEqual([]);
  });

  it('logs no drop warning when nothing contends', async () => {
    const harness = makeHarness();
    await harness.deliver(envelope(channelMessage()));

    expect(harness.channel.concurrencyDrops().total).toBe(0);
    expect(harness.logger.warn).not.toHaveBeenCalledWith(
      'ingestion.concurrency.dropped',
      expect.anything(),
    );
  });

  it('keeps counting while rate-limiting the warning', async () => {
    const harness = makeHarness();
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);

    try {
      await forceOneDrop(harness);
      await forceOneDrop(harness);

      // Two drops, one warning — the count is exact even when the log is not.
      expect(harness.channel.concurrencyDrops().total).toBe(2);
      const dropWarnings = harness.logger.warn.mock.calls.filter(
        ([event]) => event === 'ingestion.concurrency.dropped',
      );
      expect(dropWarnings).toHaveLength(1);

      now.mockReturnValue(2_060_000);
      await forceOneDrop(harness);

      const afterWindow = harness.logger.warn.mock.calls.filter(
        ([event]) => event === 'ingestion.concurrency.dropped',
      );
      expect(afterWindow).toHaveLength(2);
      expect(harness.channel.concurrencyDrops().total).toBe(3);
      // The second warning reports the drops accumulated while it was silent.
      expect(afterWindow[1]?.[1]).toMatchObject({ total: 3, sinceLastWarning: 2 });
    } finally {
      now.mockRestore();
    }
  });

  it('carries no message text, channel, or user in the warning', async () => {
    const harness = makeHarness();
    await forceOneDrop(harness);

    const [, fields] = harness.logger.warn.mock.calls.find(
      ([event]) => event === 'ingestion.concurrency.dropped',
    )!;
    expect(Object.keys(fields as object).sort()).toEqual([
      'likelyAddressed',
      'reason',
      'sinceLastWarning',
      'total',
    ]);
    const serialized = JSON.stringify(fields);
    for (const forbidden of [SYNTHETIC.channel, SYNTHETIC.user, 'rollout']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
