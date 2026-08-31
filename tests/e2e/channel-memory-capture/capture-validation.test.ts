import type { MastraDBMessage } from '@mastra/core/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_IDS,
  CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_MATRIX,
} from './acceptance-matrix.js';
import {
  IDS,
  TS,
  createCaptureHarness,
  envelope,
  joinChannel,
  leaveChannel,
  message,
  temporaryDatabase,
  vectorForText,
  type CaptureHarness,
  type TemporaryDatabase,
} from './helpers.js';

const resources: CaptureHarness[] = [];
const databases: TemporaryDatabase[] = [];

async function setup(database?: TemporaryDatabase): Promise<{
  readonly database: TemporaryDatabase;
  readonly harness: CaptureHarness;
}> {
  const resolvedDatabase = database ?? await temporaryDatabase();
  if (!database) databases.push(resolvedDatabase);
  const harness = await createCaptureHarness(resolvedDatabase.databaseUrl);
  resources.push(harness);
  return { database: resolvedDatabase, harness };
}

async function closeHarness(harness: CaptureHarness): Promise<void> {
  const index = resources.indexOf(harness);
  if (index >= 0) resources.splice(index, 1);
  await harness.close();
}

function byBoundary(messages: readonly MastraDBMessage[], channelId: string) {
  const boundary = `ch:${IDS.workspace}:${channelId}`;
  return messages.filter(({ resourceId }) => resourceId === boundary);
}

function messageKey(channelId: string, messageTs: string) {
  return `${IDS.workspace}/${channelId}/${messageTs}`;
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  await Promise.all(databases.splice(0).map((database) => database.remove()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('T607 offline acceptance matrix', () => {
  it('enumerates exactly CM-AC-01…07 and CM-AC-12 with offline and live evidence', () => {
    expect(Object.keys(CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_MATRIX).sort()).toEqual(
      [...CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_IDS].sort(),
    );
    for (const entry of Object.values(CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_MATRIX)) {
      expect(entry.offlineEvidence.length).toBeGreaterThan(0);
      expect(entry.liveEvidence.length).toBeGreaterThan(0);
    }
  });

  it('CM-AC-01/02/03: enrolls two isolated channels and silently captures roots, replies, Kilo, Gist, and another app', async () => {
    const { harness } = await setup();
    await harness.deliver(
      joinChannel(IDS.channelA, TS.joinA, 'Ev0T607-JOIN-A'),
      joinChannel(IDS.channelB, TS.joinB, 'Ev0T607-JOIN-B'),
      envelope('Ev0T607-HUMAN-A-ROOT', message()),
      envelope('Ev0T607-HUMAN-A-REPLY', message({
        thread_ts: TS.root,
        ts: TS.reply,
        event_ts: TS.reply,
        text: 'Synthetic channel A thread reply.',
      })),
      envelope('Ev0T607-HUMAN-B-ROOT', message({
        channel: IDS.channelB,
        text: 'Synthetic channel B root message.',
      })),
      envelope('Ev0T607-KILO-A', message({
        user: undefined,
        app_id: IDS.kiloApp,
        subtype: 'app_message',
        text: 'Synthetic Kilo app update.',
        ts: '1767603603.000100',
        event_ts: '1767603603.000100',
      })),
      envelope('Ev0T607-GIST-A', message({
        user: IDS.gistUser,
        bot_id: IDS.gistBot,
        text: 'Synthetic Gist-authored channel event.',
        ts: '1767603604.000100',
        event_ts: '1767603604.000100',
      })),
      envelope('Ev0T607-APP-B', message({
        channel: IDS.channelB,
        user: undefined,
        app_id: IDS.otherApp,
        subtype: 'app_message',
        thread_ts: TS.root,
        text: 'Synthetic other app reply.',
        ts: '1767603605.000100',
        event_ts: '1767603605.000100',
      })),
    );

    expect(await harness.enrollment.list({ state: 'enrolled' })).toHaveLength(2);
    const records = await harness.messages();
    expect(byBoundary(records, IDS.channelA)).toHaveLength(4);
    expect(byBoundary(records, IDS.channelB)).toHaveLength(2);
    expect(records.map(({ content }) =>
      (content.metadata?.sender as { sender_class?: string } | undefined)?.sender_class,
    ).sort()).toEqual([
      'app',
      'gist',
      'human',
      'human',
      'human',
      'kilo',
    ]);
    expect(byBoundary(records, IDS.channelA).map(({ id }) => id)).not.toContain(
      messageKey(IDS.channelB, TS.root),
    );
    expect(byBoundary(records, IDS.channelB).map(({ id }) => id)).not.toContain(
      messageKey(IDS.channelA, TS.root),
    );
    expect(records.find(({ id }) => id === messageKey(IDS.channelA, TS.reply)))
      .toMatchObject({
        threadId: `ch:${IDS.workspace}:${IDS.channelA}#${TS.root}`,
        content: { metadata: { is_thread_reply: true } },
      });
    expect(harness.respond).not.toHaveBeenCalled();
    expect(harness.posts).toHaveLength(0);
    expect(harness.typing).not.toHaveBeenCalled();
  });

  it('CM-AC-04/05: stores one outgoing response and converges its echo and Slack retries', async () => {
    const { harness } = await setup();
    const addressed = envelope('Ev0T607-ADDRESSED', {
      ...message(),
      type: 'app_mention',
      text: `<@${IDS.gistUser}> synthetic question`,
    });
    await harness.deliver(
      joinChannel(IDS.channelA, TS.joinA, 'Ev0T607-JOIN-A'),
      addressed,
    );
    await harness.deliver(envelope('Ev0T607-GIST-ECHO', message({
      user: IDS.gistUser,
      bot_id: IDS.gistBot,
      text: 'Synthetic Gist response.',
      thread_ts: TS.root,
      ts: TS.outgoing,
      event_ts: TS.outgoing,
    })));
    await harness.deliver(addressed);

    const records = await harness.messages();
    const outgoing = records.filter(({ id }) => id === messageKey(IDS.channelA, TS.outgoing));
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.content.metadata).toMatchObject({
      capture_source: 'outgoing_self',
      sender: { sender_class: 'gist' },
    });
    expect(records).toHaveLength(2);
    expect((await harness.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(2);
    expect(harness.respond).toHaveBeenCalledOnce();
    expect(harness.posts).toHaveLength(1);
    expect(harness.captureMetrics).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'skipped',
      reason: 'duplicate_delivery',
    }));
  });

  it('CM-AC-06/07: replaces the canonical row/vector on edit and leaves all stored state unchanged on delete', async () => {
    const { harness } = await setup();
    await harness.deliver(
      joinChannel(IDS.channelA, TS.joinA, 'Ev0T607-JOIN-A'),
      envelope('Ev0T607-ORIGINAL', message()),
    );

    const key = messageKey(IDS.channelA, TS.root);
    const store = await harness.storage.getStore('memory');
    if (!store) throw new Error('Synthetic memory store unavailable.');
    const original = (await store.listMessagesById({ messageIds: [key] })).messages[0]!;
    await harness.deliver(envelope('Ev0T607-EDIT', message({
      subtype: 'message_changed',
      ts: '1767603620.000100',
      event_ts: '1767603620.000100',
      message: {
        user: IDS.human,
        text: 'Synthetic edited channel A message.',
        ts: TS.root,
      },
      previous_message: {
        user: IDS.human,
        text: 'Synthetic original channel A message.',
        ts: TS.root,
      },
    })));

    const edited = (await store.listMessagesById({ messageIds: [key] })).messages[0]!;
    expect(edited.id).toBe(original.id);
    expect(edited.resourceId).toBe(original.resourceId);
    expect(edited.threadId).toBe(original.threadId);
    expect(edited.createdAt).toEqual(original.createdAt);
    expect(edited.content.parts).toEqual([
      { type: 'text', text: 'Synthetic edited channel A message.' },
    ]);
    expect(edited.content.metadata?.edited_at).toBe('2026-01-05T09:00:20.000Z');
    expect((await harness.vector.describeIndex({ indexName: 'memory_messages' })).count).toBe(1);
    const editedMatches = await harness.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorForText('Synthetic edited channel A message.'),
      topK: 5,
    });
    const staleMatches = await harness.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorForText('Synthetic original channel A message.'),
      topK: 5,
    });
    expect(editedMatches[0]?.metadata?.content).toBe('Synthetic edited channel A message.');
    expect(staleMatches[0]?.score).toBeLessThan(editedMatches[0]?.score ?? 0);

    const beforeDeleteMessage = structuredClone(edited);
    const beforeDeleteVectors = await harness.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorForText('Synthetic edited channel A message.'),
      topK: 5,
    });
    const beforeDeleteResource = await store.getResourceById({ resourceId: edited.resourceId! });
    await harness.deliver(envelope('Ev0T607-DELETE', message({
      subtype: 'message_deleted',
      ts: '1767603630.000100',
      event_ts: '1767603630.000100',
      deleted_ts: TS.root,
      previous_message: {
        user: IDS.human,
        text: 'Synthetic edited channel A message.',
        ts: TS.root,
      },
    })));

    const afterDeleteMessage = (await store.listMessagesById({ messageIds: [key] })).messages[0];
    const afterDeleteVectors = await harness.vector.query({
      indexName: 'memory_messages',
      queryVector: vectorForText('Synthetic edited channel A message.'),
      topK: 5,
    });
    const afterDeleteResource = await store.getResourceById({ resourceId: edited.resourceId! });
    expect(afterDeleteMessage).toEqual(beforeDeleteMessage);
    expect(afterDeleteVectors).toEqual(beforeDeleteVectors);
    expect(afterDeleteResource).toEqual(beforeDeleteResource);
    expect(JSON.stringify(afterDeleteResource?.metadata ?? {})).not.toContain(key);
    expect(harness.editMetrics).toHaveBeenCalledWith({ outcome: 'updated' });
    expect(harness.respond).not.toHaveBeenCalled();
    expect(harness.posts).toHaveLength(0);
  });

  it('CM-AC-01/05/12: preserves registry, dedup, and channel data across restart; leave stops only one channel', async () => {
    const first = await setup();
    const retried = envelope('Ev0T607-RESTART-RETRY', {
      ...message(),
      type: 'app_mention',
      text: `<@${IDS.gistUser}> synthetic restart question`,
    });
    await first.harness.deliver(
      joinChannel(IDS.channelA, TS.joinA, 'Ev0T607-JOIN-A'),
      joinChannel(IDS.channelB, TS.joinB, 'Ev0T607-JOIN-B'),
      retried,
      envelope('Ev0T607-B-BEFORE-RESTART', message({
        channel: IDS.channelB,
        text: 'Synthetic channel B before restart.',
      })),
    );
    expect(first.harness.respond).toHaveBeenCalledOnce();
    expect(first.harness.posts).toHaveLength(1);
    await closeHarness(first.harness);

    const restarted = (await setup(first.database)).harness;
    expect(await restarted.enrollment.list({ state: 'enrolled' })).toHaveLength(2);
    expect(await restarted.messages()).toHaveLength(3);
    await restarted.deliver(
      retried,
      { ...retried, event_id: 'Ev0T607-RESTART-REDELIVERY' },
    );
    expect(await restarted.messages()).toHaveLength(3);
    expect(restarted.captureMetrics).toHaveBeenCalledTimes(2);
    expect(restarted.captureMetrics).toHaveBeenNthCalledWith(1, expect.objectContaining({
      outcome: 'skipped',
      reason: 'duplicate_delivery',
    }));
    expect(restarted.captureMetrics).toHaveBeenNthCalledWith(2, expect.objectContaining({
      outcome: 'skipped',
      reason: 'duplicate_delivery',
    }));
    expect(restarted.respond).not.toHaveBeenCalled();
    expect(restarted.posts).toHaveLength(0);

    await restarted.deliver(
      leaveChannel(IDS.channelA, '1767603640.000100', 'Ev0T607-LEAVE-A'),
      envelope('Ev0T607-A-AFTER-LEAVE', message({
        text: 'Synthetic channel A after leave.',
        ts: '1767603641.000100',
        event_ts: '1767603641.000100',
      })),
      envelope('Ev0T607-B-AFTER-LEAVE', message({
        channel: IDS.channelB,
        text: 'Synthetic channel B after channel A leave.',
        ts: '1767603641.000200',
        event_ts: '1767603641.000200',
      })),
    );

    const records = await restarted.messages();
    expect(byBoundary(records, IDS.channelA)).toHaveLength(2);
    expect(byBoundary(records, IDS.channelB)).toHaveLength(2);
    expect(await restarted.enrollment.enrollmentFor(
      `ch:${IDS.workspace}:${IDS.channelA}`,
    )).toMatchObject({ state: 'left', retention: 'retained', epoch: 1 });
    expect(await restarted.enrollment.enrollmentFor(
      `ch:${IDS.workspace}:${IDS.channelB}`,
    )).toMatchObject({ state: 'enrolled', retention: 'retained', epoch: 1 });
    expect(restarted.captureMetrics).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'skipped',
      reason: 'channel_not_enrolled',
    }));
    expect(restarted.respond).not.toHaveBeenCalled();
    expect(restarted.posts).toHaveLength(0);
  });
});
