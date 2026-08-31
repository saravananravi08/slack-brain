import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ChannelHistoryProvider,
  HistoryBoundaryError,
  HistoryCursorError,
  type HistoryCursor,
  type HistoryQuery,
} from '../../../src/channel-memory/history/index.js';
import type { ResourceIdentity } from '../../../src/mastra/memory/resource-policy.js';
import {
  SYNTHETIC_HISTORY,
  createHistoryHarness,
  identityFor,
  storedMessage,
} from './helpers.js';

const harnesses: Awaited<ReturnType<typeof createHistoryHarness>>[] = [];
const generousLimits = { records: 10, tokens: 1_000 } as const;

async function setup(countTokens: (text: string) => number = (text) => text.length) {
  const harness = await createHistoryHarness();
  harnesses.push(harness);
  const provider = new ChannelHistoryProvider({
    storage: harness.storage,
    countTokens,
    maxRecords: 10,
    maxTokens: 1_000,
  });
  return { ...harness, provider };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

describe('ChannelHistoryProvider', () => {
  it('returns channel-wide roots and replies chronologically while identifying current thread', async () => {
    const { provider, save } = await setup();
    await save(SYNTHETIC_HISTORY.messages);

    const channel = await provider.recentChannel({
      identity: identityFor(),
      limits: generousLimits,
    });
    expect(channel.section).toBe('recent_channel');
    expect(channel.records.map(({ text }) => text)).toEqual([
      'alpha',
      'reply',
      'tie-a',
      'tie-b',
      'edited-current',
    ]);
    expect(new Set(channel.records.map(({ thread_id }) => thread_id)).size).toBe(4);
    expect(channel.records.every(({ channel_id }) => channel_id === SYNTHETIC_HISTORY.channelA))
      .toBe(true);

    const thread = await provider.currentThread({
      identity: identityFor(SYNTHETIC_HISTORY.channelA, '1700000000.000100'),
      limits: generousLimits,
    });
    expect(thread).toMatchObject({ section: 'current_thread', record_count: 2 });
    expect(thread.records.map(({ text }) => text)).toEqual(['alpha', 'reply']);
    expect(thread.records.every(({ thread_id }) => thread_id === identityFor().thread_id)).toBe(true);
  });

  it('paginates recent history deterministically with Slack-ts and stable tie-break ordering', async () => {
    const { provider, save } = await setup();
    await save([...SYNTHETIC_HISTORY.messages].reverse());
    const identity = identityFor();

    const complete = await provider.recentChannel({ identity, limits: generousLimits });
    const newestToOldest: string[] = [];
    let cursor: HistoryCursor | undefined;
    do {
      const page = await provider.recentChannel({
        identity,
        limits: { records: 2, tokens: 1_000 },
        ...(cursor ? { cursor } : {}),
      });
      newestToOldest.push(...page.records.map(({ message_key }) => message_key).reverse());
      cursor = page.next_cursor ?? undefined;
    } while (cursor);

    expect(newestToOldest).toEqual(complete.records.map(({ message_key }) => message_key).reverse());
    const repeated = await provider.recentChannel({ identity, limits: generousLimits });
    expect(repeated.records.map(({ message_key }) => message_key))
      .toEqual(complete.records.map(({ message_key }) => message_key));
  });

  it('enforces record and token bounds without returning stale pre-edit text', async () => {
    const { provider, save } = await setup();
    await save(SYNTHETIC_HISTORY.messages);

    const page = await provider.recentChannel({
      identity: identityFor(),
      limits: { records: 3, tokens: 10 },
    });
    expect(page).toMatchObject({ record_count: 2, token_count: 10 });
    expect(page.records.map(({ text }) => text)).toEqual(['tie-a', 'tie-b']);
    expect(page.next_cursor).not.toBeNull();

    const edited = await provider.currentThread({
      identity: identityFor(SYNTHETIC_HISTORY.channelA, '1700000003.000100'),
      limits: generousLimits,
    });
    expect(edited.records[0]).toMatchObject({
      text: 'edited-current',
      edited_at: '2023-11-14T22:13:24.000Z',
      capture_source: 'live_event',
      sender: { sender_display_name: 'Synthetic User' },
    });
    expect(edited.records[0]?.text).not.toBe('stale-original');
  });

  it('returns zero records for cross-channel fixtures and rejects mismatched stored boundaries', async () => {
    const { provider, save, storage } = await setup();
    const crossChannel = SYNTHETIC_HISTORY.messages.filter(
      ({ channel_id }) => channel_id === SYNTHETIC_HISTORY.channelB,
    );
    await save(crossChannel);

    await expect(provider.recentChannel({
      identity: identityFor(),
      limits: generousLimits,
    })).resolves.toMatchObject({ records: [], record_count: 0, token_count: 0 });

    const crossChannelMessage = storedMessage(crossChannel[0]!);
    const poisoned = {
      ...crossChannelMessage,
      resourceId: SYNTHETIC_HISTORY.boundaryA,
      threadId: `${SYNTHETIC_HISTORY.boundaryA}#1700000004.000100`,
    };
    const store = await storage.getStore('memory');
    await store!.saveMessages({ messages: [poisoned] });

    await expect(provider.recentChannel({
      identity: identityFor(),
      limits: generousLimits,
    })).resolves.toMatchObject({ records: [], record_count: 0, token_count: 0 });
  });

  it('fails closed before reading storage when boundary is missing or mismatched', async () => {
    const { provider, storage } = await setup();
    const getStore = vi.spyOn(storage, 'getStore');
    const identity = identityFor();
    const mismatched = {
      ...identity,
      resource_id: SYNTHETIC_HISTORY.boundaryB,
    } as ResourceIdentity;

    await expect(provider.recentChannel({ identity: mismatched, limits: generousLimits }))
      .rejects.toBeInstanceOf(HistoryBoundaryError);
    await expect(provider.recentChannel({ limits: generousLimits } as unknown as HistoryQuery))
      .rejects.toBeInstanceOf(HistoryBoundaryError);
    expect(getStore).not.toHaveBeenCalled();
  });

  it('rejects out-of-bound limits and cursors from another channel or section', async () => {
    const { provider, save } = await setup();
    await save(SYNTHETIC_HISTORY.messages);
    const first = await provider.recentChannel({
      identity: identityFor(),
      limits: { records: 1, tokens: 1_000 },
    });
    expect(first.next_cursor).not.toBeNull();

    await expect(provider.recentChannel({
      identity: identityFor(),
      limits: { records: 11, tokens: 1_000 },
    })).rejects.toBeInstanceOf(RangeError);
    await expect(provider.currentThread({
      identity: identityFor(),
      limits: generousLimits,
      cursor: first.next_cursor!,
    })).rejects.toBeInstanceOf(HistoryCursorError);
    await expect(provider.recentChannel({
      identity: identityFor(SYNTHETIC_HISTORY.channelB, '1700000004.000100'),
      limits: generousLimits,
      cursor: first.next_cursor!,
    })).rejects.toBeInstanceOf(HistoryCursorError);
  });
});
