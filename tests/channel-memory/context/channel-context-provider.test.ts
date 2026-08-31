import { readFile } from 'node:fs/promises';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';

import {
  ChannelContextProvider,
  ChannelContextScopeError,
  type ChannelContextBudgets,
  type ChannelObservationSnapshot,
} from '../../../src/channel-memory/context/index.js';
import type {
  ChannelHistoryPage,
  ChannelHistoryRecord,
  HistoryQuery,
} from '../../../src/channel-memory/history/index.js';
import { CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY } from '../../../src/mastra/tools/channel-memory-search.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  type AuthorizationRequest,
} from '../../../src/security/index.js';

const SYNTHETIC = {
  workspace: 'T0CONTEXT1',
  channel: 'C0CONTEXTA',
  otherChannel: 'C0CONTEXTB',
  user: 'U0CONTEXT1',
  resource: 'ch:T0CONTEXT1:C0CONTEXTA',
  otherResource: 'ch:T0CONTEXT1:C0CONTEXTB',
  thread: 'ch:T0CONTEXT1:C0CONTEXTA#1767225600.000100',
} as const;

const BUDGETS: ChannelContextBudgets = {
  total_tokens: 20,
  current_thread: { records: 2, tokens: 4 },
  recent_channel_history: { records: 3, tokens: 6 },
  rolling_channel_summary_tokens: 5,
  channel_observations_tokens: 5,
};

function authorizationRequest(
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return {
    contract_version: AUTHORIZATION_CONTRACT_VERSION,
    gate: 'read_memory',
    event: {
      workspace_id: SYNTHETIC.workspace,
      channel_id: SYNTHETIC.channel,
      conversation_type: 'channel',
      sender_id: SYNTHETIC.user,
      sender_type: 'human',
      sender_is_external: false,
      sender_is_guest: false,
      sender_is_deactivated: false,
    },
    identity: {
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      boundary_id: SYNTHETIC.resource,
      resource_id: SYNTHETIC.resource,
      thread_id: SYNTHETIC.thread,
      conversation_type: 'channel',
    },
    policy: {
      approved_workspace_id: SYNTHETIC.workspace,
      approved_channel_ids: [SYNTHETIC.channel],
      user_allowlist: [],
      dm_shared_knowledge: false,
    },
    ...overrides,
  };
}

function runtimeContext(options: {
  authorization?: unknown;
  resourceId?: unknown;
  threadId?: unknown;
} = {}): RequestContext {
  const context = new RequestContext();
  context.setRaw(
    CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY,
    'authorization' in options ? options.authorization : authorizationRequest(),
  );
  context.setRaw(
    MASTRA_RESOURCE_ID_KEY,
    'resourceId' in options ? options.resourceId : SYNTHETIC.resource,
  );
  context.setRaw(
    MASTRA_THREAD_ID_KEY,
    'threadId' in options ? options.threadId : SYNTHETIC.thread,
  );
  return context;
}

function record(input: {
  text: string;
  messageTs: string;
  resource?: typeof SYNTHETIC.resource | typeof SYNTHETIC.otherResource;
  channel?: typeof SYNTHETIC.channel | typeof SYNTHETIC.otherChannel;
  thread?: string;
}): ChannelHistoryRecord {
  const resource = input.resource ?? SYNTHETIC.resource;
  const channel = input.channel ?? SYNTHETIC.channel;
  const thread = input.thread ?? SYNTHETIC.thread;
  return {
    contract_version: '1.0.0',
    message_key: `${SYNTHETIC.workspace}/${channel}/${input.messageTs}`,
    boundary_id: resource,
    thread_id: thread as ChannelHistoryRecord['thread_id'],
    workspace_id: SYNTHETIC.workspace,
    channel_id: channel,
    message_ts: input.messageTs,
    thread_root_ts: thread.slice(thread.lastIndexOf('#') + 1),
    is_thread_reply: !thread.endsWith(input.messageTs),
    sender: {
      sender_class: 'human',
      sender_id: SYNTHETIC.user,
      sender_display_name: 'Synthetic Teammate',
      bot_id: null,
      app_id: null,
      username: null,
      is_gist_self: false,
      is_external: false,
      is_guest: false,
    },
    sent_at: '2026-01-01T00:00:00.000Z',
    edited_at: null,
    text: input.text,
    files: [],
    links: [],
    capture_source: 'live_event',
    ingested_at: '2026-01-01T00:00:01.000Z',
    enrollment_epoch: 1,
    token_count: input.text.length,
  };
}

function page(
  section: ChannelHistoryPage['section'],
  records: readonly ChannelHistoryRecord[],
): ChannelHistoryPage {
  return {
    section,
    records,
    record_count: records.length,
    token_count: records.reduce((total, item) => total + item.token_count, 0),
    next_cursor: null,
  };
}

function setup(options: {
  current?: readonly ChannelHistoryRecord[];
  recent?: readonly ChannelHistoryRecord[];
  observation?: ChannelObservationSnapshot;
  currentFailure?: boolean;
  recentFailure?: boolean;
  observationFailure?: boolean;
} = {}) {
  const current = options.current ?? [record({ text: 'ct', messageTs: '1767225600.000100' })];
  const recent = options.recent ?? [record({ text: 'rh', messageTs: '1767225601.000100' })];
  const history = {
    currentThread: vi.fn(async (_query: HistoryQuery) => {
      if (options.currentFailure) throw new Error('synthetic current history failure');
      return page('current_thread', current);
    }),
    recentChannel: vi.fn(async (_query: HistoryQuery) => {
      if (options.recentFailure) throw new Error('synthetic channel history failure');
      return page('recent_channel', recent);
    }),
  };
  const observations = {
    context: vi.fn(async (_resource: string, _thread: string) => {
      if (options.observationFailure) throw new Error('synthetic observation failure');
      return options.observation ?? { summary: 'sum', observations: 'notes' };
    }),
  };
  const provider = new ChannelContextProvider({
    history,
    observations,
    budgets: BUDGETS,
    countTokens: (text) => Array.from(text).length,
  });
  return { provider, history, observations };
}

describe('ChannelContextProvider', () => {
  it('resolves trusted runtime scope and emits the fixed CM-PRD section order', async () => {
    const { provider, history, observations } = setup();

    const context = await provider.getChannelContext(runtimeContext());

    expect(context.sections.map(({ id }) => id)).toEqual([
      'current_thread',
      'recent_channel_history',
      'rolling_channel_summary',
      'channel_observations',
    ]);
    expect(context.sections.map(({ source }) => source)).toEqual([
      'exact_channel_messages',
      'exact_channel_messages',
      'observation_memory',
      'observation_memory',
    ]);
    expect(context.sections.every(({ content_type }) => content_type.startsWith('untrusted_')))
      .toBe(true);
    expect(context.sections.map(({ label }) => label)).toEqual([
      'Current Slack thread',
      'Recent channel history',
      'Rolling channel summary',
      'Channel observations',
    ]);
    expect(context.sections).toHaveLength(4);
    expect(JSON.stringify(context)).not.toMatch(/semantic|search_channel_memory/i);

    const expectedIdentity = authorizationRequest().identity;
    expect(history.currentThread).toHaveBeenCalledWith({
      identity: expectedIdentity,
      limits: BUDGETS.current_thread,
    });
    expect(history.recentChannel).toHaveBeenCalledWith({
      identity: expectedIdentity,
      limits: BUDGETS.recent_channel_history,
    });
    expect(observations.context).toHaveBeenCalledWith(
      SYNTHETIC.resource,
      SYNTHETIC.thread,
    );
  });

  it('applies deterministic record, section-token, and total-token budgets', async () => {
    const messages = [
      record({ text: 'aa', messageTs: '1767225600.000100' }),
      record({ text: 'bb', messageTs: '1767225601.000100' }),
      record({ text: 'cc', messageTs: '1767225602.000100' }),
    ];
    const { provider } = setup({
      current: messages,
      recent: messages,
      observation: { summary: 'summary-long', observations: 'observations-long' },
    });

    const first = await provider.getChannelContext(runtimeContext());
    const second = await provider.getChannelContext(runtimeContext());

    expect(second).toEqual(first);
    expect(first.token_count).toBeLessThanOrEqual(first.token_limit);
    expect(first.sections[0]).toMatchObject({ record_count: 2, token_count: 4 });
    expect(first.sections[0].records.map(({ text }) => text)).toEqual(['bb', 'cc']);
    expect(first.sections[1]).toMatchObject({ record_count: 3, token_count: 6 });
    expect(first.sections[2]).toMatchObject({ text: 'summa', token_count: 5, truncated: true });
    expect(first.sections[3]).toMatchObject({ text: 'obser', token_count: 5, truncated: true });
  });

  it('keeps exact history when observation state fails, is absent, or is stale', async () => {
    const failed = await setup({ observationFailure: true }).provider
      .getChannelContext(runtimeContext());
    expect(failed.sections[0].records.map(({ text }) => text)).toEqual(['ct']);
    expect(failed.sections[1].records.map(({ text }) => text)).toEqual(['rh']);
    expect(failed.sections.slice(2).map(({ status }) => status))
      .toEqual(['unavailable', 'unavailable']);

    const absent = await setup({ observation: { summary: null, observations: '' } }).provider
      .getChannelContext(runtimeContext());
    expect(absent.sections.slice(2).map(({ status }) => status)).toEqual(['absent', 'absent']);

    const stale = await setup({
      observation: {
        summary: 'stale derived summary',
        observations: 'stale derived observations',
        stale: true,
      },
    }).provider.getChannelContext(runtimeContext());
    expect([stale.sections[2].status, stale.sections[3].status]).toEqual(['stale', 'stale']);
    expect([stale.sections[2].text, stale.sections[3].text]).toEqual([null, null]);
    expect(JSON.stringify(stale)).not.toContain('stale derived');
  });

  it('fetches independently so one history failure does not remove other context', async () => {
    const { provider, history, observations } = setup({ currentFailure: true });

    const context = await provider.getChannelContext(runtimeContext());

    expect(context.sections[0]).toMatchObject({ status: 'unavailable', records: [] });
    expect(context.sections[1]).toMatchObject({ status: 'available', record_count: 1 });
    expect(context.sections[2]).toMatchObject({ status: 'available', text: 'sum' });
    expect(history.recentChannel).toHaveBeenCalledOnce();
    expect(observations.context).toHaveBeenCalledOnce();
  });

  it('filters cross-channel fixture records and exposes no storage identifiers', async () => {
    const foreign = record({
      text: 'foreign',
      messageTs: '1767225603.000100',
      resource: SYNTHETIC.otherResource,
      channel: SYNTHETIC.otherChannel,
      thread: `${SYNTHETIC.otherResource}#1767225603.000100`,
    });
    const local = record({ text: 'ok', messageTs: '1767225604.000100' });
    const { provider } = setup({ current: [foreign, local], recent: [foreign, local] });

    const context = await provider.getChannelContext(runtimeContext());
    expect(context.sections[0].records.map(({ text }) => text)).toEqual(['ok']);
    expect(context.sections[1].records.map(({ text }) => text)).toEqual(['ok']);
    expect(JSON.stringify(context)).not.toContain('foreign');
    expect(Object.keys(context.sections[0].records[0]!)).not.toEqual(
      expect.arrayContaining(['boundary_id', 'resource_id', 'thread_id', 'message_key']),
    );

    const source = await readFile(
      new URL('../../../src/channel-memory/context/channel-context-provider.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/LibSQL|MemoryStorage|getStore\s*\(/);
  });

  it('fails closed before readers run when trusted runtime scope is missing or mismatched', async () => {
    const cases = [
      runtimeContext({ authorization: undefined }),
      runtimeContext({ authorization: {} }),
      runtimeContext({ resourceId: undefined }),
      runtimeContext({ resourceId: SYNTHETIC.otherResource }),
      runtimeContext({ threadId: undefined }),
      runtimeContext({ threadId: `${SYNTHETIC.resource}#1767225699.000100` }),
      runtimeContext({ authorization: authorizationRequest({ gate: 'write_memory' }) }),
    ];

    for (const runtime of cases) {
      const { provider, history, observations } = setup();
      await expect(provider.getChannelContext(runtime))
        .rejects.toBeInstanceOf(ChannelContextScopeError);
      expect(history.currentThread).not.toHaveBeenCalled();
      expect(history.recentChannel).not.toHaveBeenCalled();
      expect(observations.context).not.toHaveBeenCalled();
    }
  });

  it('rejects incoherent budgets at construction', () => {
    const { history, observations } = setup();
    expect(() => new ChannelContextProvider({
      history,
      observations,
      budgets: { ...BUDGETS, total_tokens: 19 },
      countTokens: (text) => text.length,
    })).toThrow(RangeError);
  });
});
