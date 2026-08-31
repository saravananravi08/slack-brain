import { MessageList, type MastraDBMessage } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { ObservationalMemoryRecord } from '@mastra/core/storage';
import { describe, expect, it, vi } from 'vitest';

import {
  ChannelObservationMemory,
  type ChannelObservationMetrics,
} from '../../../src/channel-memory/observations/index.js';
import type { DerivedInvalidation } from '../../../src/ingestion/mutations/index.js';

const CHANNEL_A = 'ch:T0OBSERVE1:C0OBSERVEA';
const CHANNEL_B = 'ch:T0OBSERVE1:C0OBSERVEB';

function message(input: {
  resourceId: string;
  channelId: string;
  threadId: string;
  messageTs: string;
  senderClass: 'human' | 'bot' | 'app';
  senderName: string;
  text: string;
}): MastraDBMessage {
  return {
    id: `T0OBSERVE1/${input.channelId}/${input.messageTs}`,
    role: 'user',
    createdAt: new Date(`2026-01-01T00:00:${input.messageTs.slice(-2)}.000Z`),
    threadId: input.threadId,
    resourceId: input.resourceId,
    content: {
      format: 2,
      parts: [{ type: 'text', text: input.text }],
      metadata: {
        sender_name: input.senderName,
        sender: { sender_class: input.senderClass },
      },
    },
  };
}

function record(resourceId: string, observations: string): ObservationalMemoryRecord {
  return {
    id: `om:${resourceId}`,
    scope: 'resource',
    threadId: null,
    resourceId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    originType: 'initial',
    generationCount: 0,
    activeObservations: observations,
    totalTokensObserved: 0,
    observationTokenCount: 0,
    pendingMessageTokens: 0,
    isReflecting: false,
    isObserving: false,
    isBufferingObservation: false,
    isBufferingReflection: false,
    lastBufferedAtTokens: 0,
    lastBufferedAtTime: null,
    config: {},
  };
}

class FakeEngine {
  readonly scope = 'resource' as const;
  readonly calls: Array<{
    threadId: string;
    resourceId?: string;
    messages?: MastraDBMessage[];
  }> = [];
  readonly cleared: string[] = [];
  readonly records = new Map<string, ObservationalMemoryRecord>();
  failure: Error | null = null;
  wait: Promise<void> = Promise.resolve();

  async clear(_threadId: string, resourceId?: string): Promise<void> {
    if (resourceId) {
      this.cleared.push(resourceId);
      this.records.delete(resourceId);
    }
  }

  async getRecord(
    _threadId: string,
    resourceId?: string,
  ): Promise<ObservationalMemoryRecord | null> {
    return resourceId ? this.records.get(resourceId) ?? null : null;
  }

  async observe(options: {
    threadId: string;
    resourceId?: string;
    messages?: MastraDBMessage[];
  }): Promise<void> {
    this.calls.push(options);
    await this.wait;
    if (this.failure) throw this.failure;
    if (options.resourceId) {
      const text = options.messages?.map((item) => item.content.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')).join('\n') ?? '';
      this.records.set(options.resourceId, record(
        options.resourceId,
        `## Channel summary\nCurrent synthetic summary.\n## Observations\n${text}`,
      ));
    }
  }

  async settled(): Promise<void> {}
}

function metrics() {
  return {
    lag: vi.fn((_fields: Parameters<ChannelObservationMetrics['lag']>[0]) => undefined),
    failure: vi.fn(
      (_fields: Parameters<ChannelObservationMetrics['failure']>[0]) => undefined,
    ),
  } satisfies ChannelObservationMetrics;
}

function makeService(
  engine: FakeEngine,
  messages: readonly MastraDBMessage[],
  observationMetrics = metrics(),
) {
  return {
    observationMetrics,
    service: new ChannelObservationMemory({
      engine: async () => engine,
      listMessages: async (resourceId) => messages.filter(
        (item) => item.resourceId === resourceId,
      ),
      metrics: observationMetrics,
      now: () => 1_000,
    }),
  };
}

function attributedText(call: FakeEngine['calls'][number]): string {
  return call.messages?.flatMap((item) => item.content.parts)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n') ?? '';
}

describe('channel Observation Memory', () => {
  it('isolates channels and preserves human/bot/app source attribution', async () => {
    const engine = new FakeEngine();
    const messages = [
      message({
        resourceId: CHANNEL_A,
        channelId: 'C0OBSERVEA',
        threadId: 'slack:C0OBSERVEA:1767225600.000101',
        messageTs: '1767225600.000101',
        senderClass: 'human',
        senderName: 'Synthetic Human',
        text: 'synthetic channel A decision',
      }),
      message({
        resourceId: CHANNEL_A,
        channelId: 'C0OBSERVEA',
        threadId: 'slack:C0OBSERVEA:1767225600.000102',
        messageTs: '1767225600.000102',
        senderClass: 'bot',
        senderName: 'Synthetic Bot',
        text: 'synthetic channel A automation outcome',
      }),
      message({
        resourceId: CHANNEL_B,
        channelId: 'C0OBSERVEB',
        threadId: 'slack:C0OBSERVEB:1767225600.000103',
        messageTs: '1767225600.000103',
        senderClass: 'app',
        senderName: 'Synthetic App',
        text: 'synthetic channel B app status',
      }),
    ];
    const { service, observationMetrics } = makeService(engine, messages);

    service.enqueue(CHANNEL_A, messages[0]!.threadId!);
    service.enqueue(CHANNEL_B, messages[2]!.threadId!);
    await service.settled();

    const channelA = engine.calls.find(({ resourceId }) => resourceId === CHANNEL_A);
    const channelB = engine.calls.find(({ resourceId }) => resourceId === CHANNEL_B);
    expect(channelA?.messages?.every(({ resourceId }) => resourceId === CHANNEL_A)).toBe(true);
    expect(channelB?.messages?.every(({ resourceId }) => resourceId === CHANNEL_B)).toBe(true);
    expect(attributedText(channelA!)).toContain('"sender_class":"human"');
    expect(attributedText(channelA!)).toContain('"sender_class":"bot"');
    expect(attributedText(channelA!)).not.toContain('synthetic channel B app status');
    expect(attributedText(channelB!)).toContain('"sender_class":"app"');
    expect(attributedText(channelB!)).not.toContain('synthetic channel A decision');

    const serializedMetrics = JSON.stringify([
      observationMetrics.lag.mock.calls,
      observationMetrics.failure.mock.calls,
    ]);
    expect(serializedMetrics).not.toContain(CHANNEL_A);
    expect(serializedMetrics).not.toContain('synthetic channel A decision');
  });

  it('returns processor context immediately while model work remains background-only', async () => {
    const engine = new FakeEngine();
    let finishObservation!: () => void;
    engine.wait = new Promise<void>((resolve) => {
      finishObservation = resolve;
    });
    engine.records.set(CHANNEL_A, record(
      CHANNEL_A,
      '## Channel summary\nSynthetic current work.\n## Decisions\nSynthetic decision.',
    ));
    const source = message({
      resourceId: CHANNEL_A,
      channelId: 'C0OBSERVEA',
      threadId: 'slack:C0OBSERVEA:1767225600.000101',
      messageTs: '1767225600.000101',
      senderClass: 'human',
      senderName: 'Synthetic Human',
      text: 'synthetic exact source',
    });
    const { service } = makeService(engine, [source]);
    const messageList = new MessageList({
      threadId: source.threadId!,
      resourceId: CHANNEL_A,
    }).add('synthetic addressed question', 'input');
    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', {
      thread: { id: source.threadId },
      resourceId: CHANNEL_A,
    });
    const postToSlack = vi.fn();

    await expect(service.processor.processInput!({
      messages: messageList.get.input.db(),
      messageList,
      requestContext,
      systemMessages: [],
      state: {},
      retryCount: 0,
      abort: (reason) => {
        throw new Error(reason);
      },
    })).resolves.toBe(messageList);

    expect(JSON.stringify(messageList.get.all.prompt())).toContain('<channel_summary>');
    expect(postToSlack).not.toHaveBeenCalled();
    expect(engine.calls).toHaveLength(1);

    finishObservation();
    await service.settled();
  });

  it('isolates observation failure from exact records and reports content-free metrics', async () => {
    const engine = new FakeEngine();
    engine.failure = new Error('synthetic observer unavailable');
    const exact = message({
      resourceId: CHANNEL_A,
      channelId: 'C0OBSERVEA',
      threadId: 'slack:C0OBSERVEA:1767225600.000101',
      messageTs: '1767225600.000101',
      senderClass: 'human',
      senderName: 'Synthetic Human',
      text: 'synthetic exact record remains',
    });
    const exactRecords = new Map([[exact.id, exact]]);
    const { service, observationMetrics } = makeService(engine, [...exactRecords.values()]);

    expect(() => service.enqueue(CHANNEL_A, exact.threadId!)).not.toThrow();
    await expect(service.settled()).resolves.toBeUndefined();

    expect(exactRecords.get(exact.id)).toBe(exact);
    expect(observationMetrics.failure).toHaveBeenCalledWith({ operation: 'consolidate' });
    expect(observationMetrics.lag).toHaveBeenCalledWith({
      operation: 'consolidate',
      outcome: 'failed',
      lagMs: 0,
    });
  });

  it('clears stale derived text and regenerates from edited exact content', async () => {
    const engine = new FakeEngine();
    engine.records.set(CHANNEL_A, record(
      CHANNEL_A,
      '## Channel summary\nKnowingly stale quotation.',
    ));
    const edited = message({
      resourceId: CHANNEL_A,
      channelId: 'C0OBSERVEA',
      threadId: 'slack:C0OBSERVEA:1767225600.000101',
      messageTs: '1767225600.000101',
      senderClass: 'human',
      senderName: 'Synthetic Human',
      text: 'synthetic edited canonical wording',
    });
    const { service } = makeService(engine, [edited]);
    const invalidation: DerivedInvalidation = {
      channelResource: CHANNEL_A as DerivedInvalidation['channelResource'],
      messageKey: edited.id as DerivedInvalidation['messageKey'],
      reason: 'message_edited',
    };

    expect(() => service.emit([invalidation])).not.toThrow();
    await service.settled();

    expect(engine.cleared).toEqual([CHANNEL_A]);
    expect(attributedText(engine.calls[0]!)).toContain('synthetic edited canonical wording');
    expect(attributedText(engine.calls[0]!)).not.toContain('Knowingly stale quotation');
    await expect(service.context(CHANNEL_A, edited.threadId!)).resolves.toMatchObject({
      summary: 'Current synthetic summary.',
    });
    expect((await service.context(CHANNEL_A, edited.threadId!)).observations)
      .not.toContain('Knowingly stale quotation');
  });
});
