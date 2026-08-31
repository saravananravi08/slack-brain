import type { MastraDBMessage } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import {
  parseMemoryRequestContext,
  type MemoryConfigInternal,
} from '@mastra/core/memory';
import type { InputProcessor, InputProcessorOrWorkflow } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';
import { LibSQLVector, type LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { ObservationalMemory } from '@mastra/memory/processors';

import {
  ChannelObservationMemory,
  type ChannelObservationMetrics,
} from '../../channel-memory/observations/index.js';

export const GIST_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const GIST_EMBEDDING_DIMENSIONS = 1_536;
export const GIST_RETRIEVAL_FAILED_SIGNAL = 'retrieval_failed' as const;
export const GIST_OBSERVATION_MODEL = 'openai/gpt-4.1-mini';

export const GIST_OBSERVATION_MEMORY_CONFIG = {
  model: GIST_OBSERVATION_MODEL,
  scope: 'resource',
  observation: {
    messageTokens: 12_000,
    bufferTokens: false,
    continuationHints: false,
    instruction: [
      'Maintain channel memory, not a private user profile.',
      'Start with a compact `## Channel summary` of at most 120 words.',
      'Then record decisions, ongoing work, unresolved questions, conventions, and outcomes.',
      'Preserve each relevant channel-source message_key, sender_class, sender_name, and sent_at.',
      'Never invent a source or quote wording absent from the supplied messages.',
    ].join(' '),
  },
  reflection: {
    observationTokens: 24_000,
    continuationHints: false,
    instruction: [
      'Keep one current `## Channel summary` of at most 120 words.',
      'Consolidate decisions, ongoing work, unresolved questions, conventions, and outcomes.',
      'Retain channel-source references and remove superseded wording.',
    ].join(' '),
  },
} as const;

export const GIST_MEMORY_DEFAULTS = {
  lastMessages: 20,
  semanticRecall: {
    topK: 5,
    messageRange: 2,
    scope: 'resource',
  },
  workingMemory: { enabled: false },
  observationalMemory: false,
  generateTitle: false,
} as const;

export interface GistRetrievedCitation {
  readonly message_key: string;
  readonly boundary_id: string;
  readonly thread_id: string;
  readonly sender_name: string;
  readonly sent_at: string;
  readonly channel_id: string;
  readonly message_ts: string;
  readonly text: string;
}

function messageText(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function slackTimestampToIso(messageTs: string): string | null {
  const match = /^(\d+)\.(\d{1,6})$/.exec(messageTs);
  if (!match) return null;

  const seconds = Number(match[1]);
  const milliseconds = Number(match[2]!.padEnd(3, '0').slice(0, 3));
  const date = new Date(seconds * 1_000 + milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function citationForMessage(message: MastraDBMessage): GistRetrievedCitation | null {
  const metadata = message.content.metadata;
  const channelId = metadata?.channel_id;
  const senderName = metadata?.sender_name;
  const messageTs = metadata?.message_ts;
  const text = messageText(message);

  if (
    typeof channelId !== 'string' ||
    !/^[CDG][A-Z0-9]{8,}$/.test(channelId) ||
    typeof senderName !== 'string' ||
    senderName.trim() === '' ||
    typeof messageTs !== 'string' ||
    !message.id.endsWith(`/${messageTs}`) ||
    !message.resourceId ||
    !message.threadId ||
    text.trim() === ''
  ) {
    return null;
  }

  const sentAt = slackTimestampToIso(messageTs);
  if (!sentAt) return null;

  return {
    message_key: message.id,
    boundary_id: message.resourceId,
    thread_id: message.threadId,
    sender_name: senderName,
    sent_at: sentAt,
    channel_id: channelId,
    message_ts: messageTs,
    text,
  };
}

function resourceScopedMemoryConfig(
  config: MemoryConfigInternal,
): MemoryConfigInternal {
  if (typeof config.semanticRecall !== 'object') return config;
  return {
    ...config,
    semanticRecall: { ...config.semanticRecall, scope: 'resource' },
  };
}

function citationContext(items: readonly GistRetrievedCitation[]): string {
  const evidence = items.map(({ sender_name, sent_at, channel_id, message_ts, text }) => ({
    sender_name,
    sent_at,
    channel_id,
    message_ts,
    text: text.replace(
      /<\/retrieved_slack_messages\s*>/gi,
      '[closing evidence tag removed]',
    ),
  }));

  return `Historical Slack evidence follows as JSON. Cite sender_name and sent_at for every historical claim.\n<retrieved_slack_messages>\n${JSON.stringify(evidence)}\n</retrieved_slack_messages>`;
}

const NOOP_OBSERVATION_METRICS: ChannelObservationMetrics = {
  lag: () => undefined,
  failure: () => undefined,
};

type GistMemoryConfig = ConstructorParameters<typeof Memory>[0];

export class GistMemory extends Memory {
  readonly channelObservations: ChannelObservationMemory;
  readonly #observationMetrics: ChannelObservationMetrics;
  #channelObservationEngine?: Promise<ObservationalMemory>;
  #mastra?: Mastra;

  constructor(
    config: GistMemoryConfig,
    observationMetrics: ChannelObservationMetrics = NOOP_OBSERVATION_METRICS,
  ) {
    super(config);
    this.#observationMetrics = observationMetrics;
    this.channelObservations = new ChannelObservationMemory({
      engine: () => this.#getChannelObservationEngine(),
      listMessages: async (channelResource) => (
        await this.listMessagesByResourceId({
          resourceId: channelResource,
          orderBy: { field: 'createdAt', direction: 'ASC' },
          perPage: false,
        })
      ).messages,
      metrics: observationMetrics,
    });
  }

  override __registerMastra(mastra: Mastra): void {
    super.__registerMastra(mastra);
    this.#mastra = mastra;
    if (this.#channelObservationEngine) {
      void this.#channelObservationEngine.then(
        (engine) => engine.__registerMastra(mastra),
        () => undefined,
      );
    }
  }

  override async settled(): Promise<void> {
    await Promise.all([super.settled(), this.channelObservations.settled()]);
  }

  async recallWithCitationMetadata(
    args: Parameters<Memory['recall']>[0],
    authorizedBoundaryIds?: ReadonlySet<string>,
  ): Promise<readonly GistRetrievedCitation[]> {
    const boundaries = authorizedBoundaryIds
      ?? new Set(args.resourceId ? [args.resourceId] : []);
    const result = await super.recall(args);
    return result.messages.flatMap((message) => {
      const citation = citationForMessage(message);
      return citation && boundaries.has(citation.boundary_id)
        ? [citation]
        : [];
    });
  }

  override async getInputProcessors(
    configuredProcessors: InputProcessorOrWorkflow[] = [],
    context?: RequestContext,
  ): Promise<InputProcessor[]> {
    const citationRecall: InputProcessor = {
      id: 'semantic-recall',
      name: 'GistCitationRecall',
      processInput: async ({ messageList, requestContext }) => {
        const memoryContext = parseMemoryRequestContext(requestContext);
        const threadId = memoryContext?.thread?.id;
        const resourceId = memoryContext?.resourceId;
        const query = messageList.getLatestUserContent();
        if (!threadId || !query) return messageList;
        if (!resourceId) {
          messageList.addSystem(
            GIST_RETRIEVAL_FAILED_SIGNAL,
            'gist-citation-recall',
          );
          return messageList;
        }

        try {
          const items = await this.recallWithCitationMetadata({
            threadId,
            vectorSearchString: query,
            perPage: 0,
            resourceId,
            ...(memoryContext.memoryConfig
              ? { threadConfig: resourceScopedMemoryConfig(memoryContext.memoryConfig) }
              : {}),
          }, new Set([resourceId]));
          if (items.length > 0) {
            messageList.addSystem(citationContext(items), 'gist-citation-recall');
          }
        } catch {
          messageList.addSystem(
            GIST_RETRIEVAL_FAILED_SIGNAL,
            'gist-citation-recall',
          );
        }
        return messageList;
      },
    };

    const channelObservations = this.channelObservations.processor;
    const inherited = await super.getInputProcessors(
      [...configuredProcessors, citationRecall, channelObservations],
      context,
    );
    return [...inherited, citationRecall, channelObservations];
  }

  async #getChannelObservationEngine(): Promise<ObservationalMemory> {
    this.#channelObservationEngine ??= (async () => {
      const store = await this.storage.getStore('memory');
      if (!store?.supportsObservationalMemory) {
        throw new Error('LibSQL Observation Memory storage unavailable.');
      }
      const metrics = this.#observationMetrics;
      const engine = new ObservationalMemory({
        storage: store,
        ...GIST_OBSERVATION_MEMORY_CONFIG,
        hooks: {
          onObservationEnd: ({ error }) => {
            if (error) metrics.failure({ operation: 'observation' });
          },
          onReflectionEnd: ({ error }) => {
            if (error) metrics.failure({ operation: 'reflection' });
          },
        },
      });
      if (this.#mastra) engine.__registerMastra(this.#mastra);
      return engine;
    })();
    return this.#channelObservationEngine;
  }
}

export interface CreateGistMemoryOptions {
  readonly storage: LibSQLStore;
  readonly databaseUrl: string;
  readonly embeddingModel: string;
  readonly observationMetrics?: ChannelObservationMetrics;
}

export function createGistMemory({
  storage,
  databaseUrl,
  embeddingModel,
  observationMetrics,
}: CreateGistMemoryOptions): GistMemory {
  if (embeddingModel !== GIST_EMBEDDING_MODEL) {
    throw new Error(`Gist memory requires ${GIST_EMBEDDING_MODEL}.`);
  }

  return new GistMemory({
    storage,
    vector: new LibSQLVector({
      id: 'gist-memory-vector',
      url: databaseUrl,
    }),
    embedder: embeddingModel,
    embedderOptions: {
      providerOptions: {
        openai: { dimensions: GIST_EMBEDDING_DIMENSIONS },
      },
    },
    options: GIST_MEMORY_DEFAULTS,
  }, observationMetrics);
}
