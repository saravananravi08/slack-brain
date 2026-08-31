import { LibSQLFactoryStorage } from '@mastra/libsql';
import type { Chat, StateAdapter, WebhookOptions } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JoinedChannelRegistry,
} from '../../../src/channel-memory/registry/index.js';
import type {
  ChannelMessageRecord,
  HandleMutationInput,
} from '../../../src/ingestion/index.js';
import {
  createLiveSlackChannel,
  type ChannelMemoryMetrics,
} from '../../../src/mastra/channels/slack.js';
import type { ChannelRequest } from '../../../src/mastra/channels/types.js';
import type { PolicySnapshot, SenderAttributes } from '../../../src/security/index.js';
import { makeMemoryState } from '../../channels/helpers.js';

const IDS = {
  workspace: 'T0CHANTEST',
  channelA: 'C0CHANTESTA',
  channelB: 'C0CHANTESTB',
  human: 'U0TESTUSER1',
  gistUser: 'U0GISTBOT01',
  gistBot: 'B0GISTBOT01',
  kiloBot: 'B0KILOBOT01',
  kiloApp: 'A0KILOAPP01',
  otherBot: 'B0OTHRBOT01',
  app: 'A0TESTAPP01',
  botToken: 'xoxb-synthetic-channel-memory',
  appToken: 'xapp-synthetic-channel-memory',
} as const;

const POLICY: PolicySnapshot = {
  approved_workspace_id: IDS.workspace,
  approved_channel_ids: [],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
  displayName: 'Synthetic Member',
};

interface AdapterInternals {
  _botUserId: string;
  chat: Chat;
  lookupUser(userId: string): Promise<unknown>;
  postMessage(threadId: string, body: unknown): Promise<unknown>;
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
  startTyping(threadId: string): Promise<void>;
  webClient: {
    conversations: {
      list(input: unknown): Promise<unknown>;
    };
  };
}

const stores: LibSQLFactoryStorage[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

function envelope(eventId: string, event: Record<string, unknown>) {
  return {
    type: 'event_callback',
    team_id: IDS.workspace,
    event_id: eventId,
    event,
  };
}

function join(channel: string, ts: string, eventId: string) {
  return envelope(eventId, {
    type: 'member_joined_channel',
    team: IDS.workspace,
    channel,
    channel_type: 'C',
    user: IDS.gistUser,
    event_ts: ts,
  });
}

function leave(channel: string, ts: string, eventId: string) {
  return envelope(eventId, {
    type: 'member_left_channel',
    team: IDS.workspace,
    channel,
    user: IDS.gistUser,
    event_ts: ts,
  });
}

function message(overrides: Record<string, unknown> = {}) {
  const ts = typeof overrides.ts === 'string' ? overrides.ts : '1767603601.000100';
  return {
    type: 'message',
    team: IDS.workspace,
    channel: IDS.channelA,
    channel_type: 'channel',
    user: IDS.human,
    text: 'synthetic channel-memory message',
    ts,
    event_ts: ts,
    ...overrides,
  };
}

async function createHarness(options: {
  state?: StateAdapter;
  registry?: JoinedChannelRegistry;
  records?: Map<string, ChannelMessageRecord>;
} = {}) {
  let storage: LibSQLFactoryStorage | undefined;
  let registry = options.registry;
  if (!registry) {
    storage = new LibSQLFactoryStorage({ id: 't606-runtime', url: ':memory:' });
    registry = storage.registerDomain(new JoinedChannelRegistry());
    await storage.init();
    stores.push(storage);
  }

  const records = options.records ?? new Map<string, ChannelMessageRecord>();
  const persist = vi.fn(async (record: ChannelMessageRecord) => {
    const outcome = records.has(record.message_key) ? 'unchanged' as const : 'inserted' as const;
    if (!records.has(record.message_key)) records.set(record.message_key, record);
    return { outcome, embedding: 'stored' as const };
  });
  const mutationInputs: HandleMutationInput[] = [];
  const metrics: ChannelMemoryMetrics = {
    capture: vi.fn(),
    edit: vi.fn(),
  };
  const generationOrder: string[] = [];
  const respond = vi.fn(async (_request: ChannelRequest) => {
    generationOrder.push('generate');
    return 'Synthetic Gist response.';
  });
  const handleMutation = vi.fn(async (input: HandleMutationInput) => {
    mutationInputs.push(input);
    return {
      status: input.event.mutation?.kind === 'delete' ? 'ignored' as const : 'updated' as const,
      message_key: `${input.event.workspace_id}/${input.event.channel_id}/${input.event.message_ts}` as const,
      derivedInvalidation: [],
    };
  });

  let runtime: ReturnType<typeof createLiveSlackChannel>;
  runtime = createLiveSlackChannel({
    credentials: { botToken: IDS.botToken, appToken: IDS.appToken },
    state: options.state ?? makeMemoryState(),
    policy: POLICY,
    enrollment: registry,
    channelPersistence: {
      persist: async (record) => {
        generationOrder.push(`persist:${record.capture_source}`);
        return persist(record);
      },
    },
    mutations: {
      handle: handleMutation,
      shouldSuppressOriginal: async () => ({ status: 'allowed', suppressed: false }),
    },
    metrics,
    kiloBotId: IDS.kiloBot,
    kiloAppId: IDS.kiloApp,
    resolveSender: async ({ senderId }) => senderId.startsWith('U') ? FULL_MEMBER : null,
    authorize: async () => ({ allowed: false, reason: 'unapproved_channel' }),
    authorizeCaptured: async () => ({ allowed: true, reason: null }),
    respond,
    now: () => new Date('2026-01-05T09:00:02.000Z'),
  });

  const posts: unknown[] = [];
  const adapter = runtime.adapter as unknown as AdapterInternals;
  adapter._botUserId = IDS.gistUser;
  adapter.lookupUser = async (userId) => ({
    displayName: `synthetic.${userId}`,
    realName: `Synthetic ${userId}`,
    isBot: userId !== IDS.human,
  });
  adapter.postMessage = async (threadId, body) => {
    posts.push(body);
    const ts = '1767603610.000100';
    return {
      id: ts,
      threadId,
      raw: {
        ok: true,
        ts,
        message: {
          ts,
          thread_ts: '1767603601.000100',
          text: 'Synthetic Gist response.',
          user: IDS.gistUser,
          bot_id: IDS.gistBot,
        },
      },
    };
  };
  adapter.startTyping = async () => undefined;
  adapter.chat = runtime.bot;

  const pending: Promise<unknown>[] = [];
  const chatInternals = runtime.bot as unknown as Record<string, (...args: never[]) => unknown>;
  for (const method of ['processMessage', 'processMessageUpdated', 'processMessageDeleted']) {
    const original = chatInternals[method];
    if (typeof original !== 'function') continue;
    const bound = original.bind(runtime.bot);
    chatInternals[method] = (...args: never[]) => {
      const result = Promise.resolve(bound(...args));
      pending.push(result);
      return result;
    };
  }

  async function deliver(...payloads: Record<string, unknown>[]) {
    for (const payload of payloads) {
      adapter.processEventPayload(payload, { waitUntil: (task) => pending.push(task) });
    }
    for (let round = 0; round < 10; round += 1) {
      const batch = pending.splice(0);
      if (batch.length > 0) await Promise.all(batch);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (pending.length === 0 && round > 0) return;
    }
    throw new Error('Synthetic T606 delivery did not settle.');
  }

  return {
    adapter,
    deliver,
    generationOrder,
    handleMutation,
    metrics,
    mutationInputs,
    persist,
    posts,
    records,
    registry,
    respond,
    runtime,
    state: options.state ?? undefined,
  };
}

describe('membership-authoritative live channel capture', () => {
  it('captures two joined channels independently and stops after a raw leave', async () => {
    const harness = await createHarness();
    await harness.deliver(
      join(IDS.channelA, '1767603600.000100', 'Ev0CHANTEST-JOIN-A'),
      join(IDS.channelB, '1767603600.000200', 'Ev0CHANTEST-JOIN-B'),
      envelope('Ev0CHANTEST-MSG-A', message()),
      envelope('Ev0CHANTEST-MSG-B', message({
        channel: IDS.channelB,
        ts: '1767603601.000200',
        event_ts: '1767603601.000200',
      })),
    );

    expect([...harness.records.values()].map((record) => record.boundary_id).sort()).toEqual([
      `ch:${IDS.workspace}:${IDS.channelA}`,
      `ch:${IDS.workspace}:${IDS.channelB}`,
    ]);

    await harness.deliver(
      leave(IDS.channelA, '1767603602.000100', 'Ev0CHANTEST-LEFT-A'),
      envelope('Ev0CHANTEST-AFTER-LEFT', message({
        ts: '1767603603.000100',
        event_ts: '1767603603.000100',
      })),
    );
    expect(harness.records).toHaveLength(2);
    expect(await harness.registry.enrollmentFor(
      `ch:${IDS.workspace}:${IDS.channelA}`,
    )).toMatchObject({ state: 'left', retention: 'retained' });
  });

  it('captures every content sender class but only addressed human input generates', async () => {
    const harness = await createHarness();
    await harness.deliver(join(IDS.channelA, '1767603600.000100', 'Ev0CHANTEST-JOIN'));

    const events = [
      message({ ts: '1767603601.000101', event_ts: '1767603601.000101' }),
      message({
        user: IDS.gistUser,
        bot_id: IDS.gistBot,
        ts: '1767603601.000102',
        event_ts: '1767603601.000102',
      }),
      message({
        user: undefined,
        bot_id: IDS.kiloBot,
        ts: '1767603601.000103',
        event_ts: '1767603601.000103',
      }),
      message({
        user: undefined,
        bot_id: IDS.otherBot,
        ts: '1767603601.000104',
        event_ts: '1767603601.000104',
      }),
      message({
        user: undefined,
        app_id: IDS.app,
        subtype: 'app_message',
        ts: '1767603601.000105',
        event_ts: '1767603601.000105',
      }),
    ];
    await harness.deliver(...events.map((event, index) =>
      envelope(`Ev0CHANTEST-SENDER-${index}`, event),
    ));

    expect([...harness.records.values()].map((record) => record.sender.sender_class).sort())
      .toEqual(['app', 'bot', 'gist', 'human', 'kilo']);
    expect(harness.respond).not.toHaveBeenCalled();

    await harness.deliver(envelope('Ev0CHANTEST-MENTION', {
      ...message({ ts: '1767603602.000100', event_ts: '1767603602.000100' }),
      type: 'app_mention',
      text: `<@${IDS.gistUser}> synthetic question`,
    }));
    expect(harness.respond).toHaveBeenCalledOnce();
    expect(harness.generationOrder.indexOf('persist:live_event')).toBeLessThan(
      harness.generationOrder.indexOf('generate'),
    );
  });

  it('persists outgoing_self once and converges a later Slack echo on message_key', async () => {
    const harness = await createHarness();
    await harness.deliver(
      join(IDS.channelA, '1767603600.000100', 'Ev0CHANTEST-JOIN'),
      envelope('Ev0CHANTEST-MENTION', {
        ...message(),
        type: 'app_mention',
        text: `<@${IDS.gistUser}> synthetic question`,
      }),
    );

    const outgoingKey = `${IDS.workspace}/${IDS.channelA}/1767603610.000100`;
    expect(harness.records.get(outgoingKey)).toMatchObject({
      capture_source: 'outgoing_self',
      sender: { sender_class: 'gist' },
    });

    await harness.deliver(envelope('Ev0CHANTEST-ECHO', message({
      user: IDS.gistUser,
      bot_id: IDS.gistBot,
      text: 'Synthetic Gist response.',
      thread_ts: '1767603601.000100',
      ts: '1767603610.000100',
      event_ts: '1767603610.000100',
    })));
    expect([...harness.records.keys()].filter((key) => key === outgoingKey)).toHaveLength(1);
  });

  it('routes edits through T605, ignores deletes there, and emits content-free metrics', async () => {
    const harness = await createHarness();
    await harness.deliver(join(IDS.channelA, '1767603600.000100', 'Ev0CHANTEST-JOIN'));
    await harness.deliver(
      envelope('Ev0CHANTEST-EDIT', message({
        subtype: 'message_changed',
        ts: '1767603602.000100',
        event_ts: '1767603602.000100',
        message: {
          user: IDS.human,
          text: 'synthetic edited content',
          ts: '1767603601.000100',
        },
        previous_message: {
          user: IDS.human,
          text: 'synthetic prior content',
          ts: '1767603601.000100',
        },
      })),
      envelope('Ev0CHANTEST-DELETE', message({
        subtype: 'message_deleted',
        ts: '1767603603.000100',
        event_ts: '1767603603.000100',
        deleted_ts: '1767603601.000100',
        previous_message: {
          user: IDS.human,
          text: 'synthetic prior content',
          ts: '1767603601.000100',
        },
      })),
    );

    expect(harness.mutationInputs.map((input) => input.event.mutation?.kind)).toEqual([
      'edit',
      'delete',
    ]);
    expect(harness.metrics.edit).toHaveBeenCalledWith({ outcome: 'updated' });
    const serializedMetrics = JSON.stringify(
      (harness.metrics.capture as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(serializedMetrics).not.toContain('synthetic channel-memory message');
    expect(serializedMetrics).not.toContain(IDS.channelA);
  });

  it('keeps delivery dedup across re-composition with durable state', async () => {
    const state = makeMemoryState();
    const first = await createHarness({ state });
    const replayed = envelope('Ev0CHANTEST-RETRY', message());
    await first.deliver(
      join(IDS.channelA, '1767603600.000100', 'Ev0CHANTEST-JOIN'),
      replayed,
    );

    const restarted = await createHarness({
      state,
      registry: first.registry,
      records: first.records,
    });
    await restarted.deliver(replayed);

    expect(restarted.persist).not.toHaveBeenCalled();
    expect(first.records).toHaveLength(1);
  });

  it('replays positive Slack memberships idempotently after restart', async () => {
    const harness = await createHarness();
    const list = vi.fn(async () => ({
      ok: true,
      channels: [
        { id: IDS.channelA, is_member: true, is_ext_shared: false },
        { id: IDS.channelB, is_member: true, is_ext_shared: false },
      ],
      response_metadata: { next_cursor: '' },
    }));
    harness.adapter.webClient.conversations.list = list;

    await harness.runtime.replayMembership();
    await harness.runtime.replayMembership();

    expect(await harness.registry.enrollmentFor(
      `ch:${IDS.workspace}:${IDS.channelA}`,
    )).toMatchObject({ state: 'enrolled', epoch: 1 });
    expect(await harness.registry.enrollmentFor(
      `ch:${IDS.workspace}:${IDS.channelB}`,
    )).toMatchObject({ state: 'enrolled', epoch: 1 });
    expect(list).toHaveBeenCalledTimes(2);
  });
});
