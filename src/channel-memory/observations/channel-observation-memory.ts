import type { MastraDBMessage } from '@mastra/core/agent';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import type { InputProcessor } from '@mastra/core/processors';
import type { ObservationalMemoryRecord } from '@mastra/core/storage';

import type {
  DerivedInvalidation,
  DerivedInvalidationSink,
} from '../../ingestion/mutations/index.js';

export type ChannelObservationOperation = 'consolidate' | 'refresh';

export interface ChannelObservationMetrics {
  lag(fields: {
    readonly operation: ChannelObservationOperation;
    readonly outcome: 'settled' | 'failed';
    readonly lagMs: number;
  }): void;
  failure(fields: {
    readonly operation: ChannelObservationOperation | 'observation' | 'reflection';
  }): void;
}

export interface ChannelObservationContext {
  readonly summary: string | null;
  readonly observations: string;
}

interface ChannelObservationEngine {
  readonly scope: 'resource' | 'thread';
  clear(threadId: string, resourceId?: string): Promise<void>;
  getRecord(
    threadId: string,
    resourceId?: string,
  ): Promise<ObservationalMemoryRecord | null>;
  observe(options: {
    readonly threadId: string;
    readonly resourceId?: string;
    readonly messages?: MastraDBMessage[];
  }): Promise<unknown>;
  settled(): Promise<void>;
}

export interface ChannelObservationMemoryOptions {
  readonly engine: () => Promise<ChannelObservationEngine>;
  readonly listMessages: (channelResource: string) => Promise<readonly MastraDBMessage[]>;
  readonly metrics?: ChannelObservationMetrics;
  readonly now?: () => number;
}

const NOOP_METRICS: ChannelObservationMetrics = {
  lag: () => undefined,
  failure: () => undefined,
};

const CHANNEL_RESOURCE = /^ch:[^:]+:[^:]+$/;
const SUMMARY_HEADING = /^## Channel summary\s*$/gim;
const MAX_FALLBACK_SUMMARY_CHARS = 1_200;

function isChannelResource(value: string | undefined): value is string {
  return value !== undefined && CHANNEL_RESOURCE.test(value);
}

function messageText(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function attributedMessage(message: MastraDBMessage): MastraDBMessage {
  const metadata = message.content.metadata ?? {};
  const sender = typeof metadata.sender === 'object' && metadata.sender !== null
    ? metadata.sender as Record<string, unknown>
    : {};
  const attribution = {
    message_key: message.id,
    sender_class: typeof sender.sender_class === 'string'
      ? sender.sender_class
      : 'unknown',
    sender_name: typeof metadata.sender_name === 'string'
      ? metadata.sender_name
      : 'unknown',
    sent_at: message.createdAt.toISOString(),
  };

  return {
    ...message,
    content: {
      ...message.content,
      parts: [
        { type: 'text', text: `[channel-source ${JSON.stringify(attribution)}]` },
        { type: 'text', text: messageText(message) },
      ],
    },
  };
}

function rollingSummary(observations: string): string | null {
  let latestHeading: RegExpExecArray | null = null;
  for (const match of observations.matchAll(SUMMARY_HEADING)) latestHeading = match;

  if (latestHeading?.index !== undefined) {
    const afterHeading = observations.slice(latestHeading.index + latestHeading[0].length).trim();
    const nextSection = afterHeading.search(/^## /m);
    const summary = (nextSection === -1 ? afterHeading : afterHeading.slice(0, nextSection)).trim();
    if (summary !== '') return summary;
  }

  const compact = observations.trim();
  if (compact === '') return null;
  return compact.length <= MAX_FALLBACK_SUMMARY_CHARS
    ? compact
    : `${compact.slice(0, MAX_FALLBACK_SUMMARY_CHARS)}…`;
}

function safeMetric(call: () => void): void {
  try {
    call();
  } catch {
    // Metrics cannot affect capture, observation, or response behavior.
  }
}

function observationSystemContext(context: ChannelObservationContext): string {
  const safeSummary = context.summary?.replace(/<\/channel_summary\s*>/gi, '[tag removed]');
  const safeObservations = context.observations.replace(
    /<\/channel_observations\s*>/gi,
    '[tag removed]',
  );
  return [
    safeSummary
      ? `<channel_summary>\n${safeSummary}\n</channel_summary>`
      : null,
    safeObservations
      ? `<channel_observations>\n${safeObservations}\n</channel_observations>`
      : null,
  ].filter((value): value is string => value !== null).join('\n\n');
}

/**
 * Resource-scoped Observation Memory access, scheduling, and edit invalidation.
 * Model work is always detached from exact capture and serialized per channel.
 */
export class ChannelObservationMemory implements DerivedInvalidationSink {
  readonly processor: InputProcessor;
  readonly #engine: ChannelObservationMemoryOptions['engine'];
  readonly #listMessages: ChannelObservationMemoryOptions['listMessages'];
  readonly #metrics: ChannelObservationMetrics;
  readonly #now: () => number;
  readonly #queues = new Map<string, Promise<void>>();
  readonly #pending = new Set<Promise<void>>();

  constructor({
    engine,
    listMessages,
    metrics = NOOP_METRICS,
    now = Date.now,
  }: ChannelObservationMemoryOptions) {
    this.#engine = engine;
    this.#listMessages = listMessages;
    this.#metrics = metrics;
    this.#now = now;
    this.processor = {
      id: 'channel-observational-memory',
      name: 'ChannelObservationalMemory',
      processInput: async ({ messageList, requestContext }) => {
        const memoryContext = parseMemoryRequestContext(requestContext);
        const threadId = memoryContext?.thread?.id;
        const channelResource = memoryContext?.resourceId;
        if (!threadId || !isChannelResource(channelResource)) return messageList;

        try {
          const context = await this.context(channelResource, threadId);
          const systemContext = observationSystemContext(context);
          if (systemContext !== '') {
            messageList.addSystem(systemContext, 'channel-observational-memory');
          }
        } catch {
          safeMetric(() => this.#metrics.failure({ operation: 'consolidate' }));
        }

        this.enqueue(channelResource, threadId);
        return messageList;
      },
    };
  }

  async context(channelResource: string, threadId: string): Promise<ChannelObservationContext> {
    if (!isChannelResource(channelResource) || threadId === '') {
      return { summary: null, observations: '' };
    }
    const engine = await this.#resourceEngine();
    const record = await engine.getRecord(threadId, channelResource);
    const observations = record?.activeObservations ?? '';
    return { summary: rollingSummary(observations), observations };
  }

  /** Schedule consolidation after exact message persistence; never returns model work. */
  enqueue(channelResource: string, threadId: string): void {
    if (!isChannelResource(channelResource) || threadId === '') return;
    this.#schedule(channelResource, threadId, 'consolidate');
  }

  /** P06 synchronous handoff. Invalidations are content-free and model work is detached. */
  emit(invalidations: readonly DerivedInvalidation[]): void {
    const channels = new Map<string, string>();
    for (const invalidation of invalidations) {
      if (!isChannelResource(invalidation.channelResource)) continue;
      channels.set(invalidation.channelResource, invalidation.messageKey);
    }
    for (const [channelResource, threadId] of channels) {
      this.#schedule(channelResource, threadId, 'refresh');
    }
  }

  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.all([...this.#pending]);
    }
    try {
      await (await this.#resourceEngine()).settled();
    } catch {
      safeMetric(() => this.#metrics.failure({ operation: 'consolidate' }));
    }
  }

  #schedule(
    channelResource: string,
    threadId: string,
    operation: ChannelObservationOperation,
  ): void {
    const queuedAt = this.#now();
    const previous = this.#queues.get(channelResource) ?? Promise.resolve();
    const work = previous.then(async () => {
      const engine = await this.#resourceEngine();
      if (operation === 'refresh') await engine.clear(threadId, channelResource);

      const messages = await this.#listMessages(channelResource);
      if (messages.some((message) => message.resourceId !== channelResource)) {
        throw new Error('Observation source crossed its channel boundary.');
      }
      if (messages.length === 0) return;

      const observationThread = messages[0]?.threadId ?? threadId;
      await engine.observe({
        threadId: observationThread,
        resourceId: channelResource,
        messages: messages.map(attributedMessage),
      });
    });
    const settled = work.then(
      () => safeMetric(() => this.#metrics.lag({
        operation,
        outcome: 'settled',
        lagMs: Math.max(0, this.#now() - queuedAt),
      })),
      () => {
        safeMetric(() => this.#metrics.failure({ operation }));
        safeMetric(() => this.#metrics.lag({
          operation,
          outcome: 'failed',
          lagMs: Math.max(0, this.#now() - queuedAt),
        }));
      },
    );

    this.#queues.set(channelResource, settled);
    this.#pending.add(settled);
    void settled.finally(() => {
      this.#pending.delete(settled);
      if (this.#queues.get(channelResource) === settled) this.#queues.delete(channelResource);
    });
  }

  async #resourceEngine(): Promise<ChannelObservationEngine> {
    const engine = await this.#engine();
    if (engine.scope !== 'resource') {
      throw new Error('Channel Observation Memory must use resource scope.');
    }
    return engine;
  }
}