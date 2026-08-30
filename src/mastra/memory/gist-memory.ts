import type { MastraDBMessage } from '@mastra/core/agent';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import type { InputProcessor, InputProcessorOrWorkflow } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';
import { LibSQLVector, type LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

export const GIST_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const GIST_EMBEDDING_DIMENSIONS = 1_536;
export const GIST_RETRIEVAL_FAILED_SIGNAL = 'retrieval_failed' as const;

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

export class GistMemory extends Memory {
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
              ? { threadConfig: memoryContext.memoryConfig }
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

    const inherited = await super.getInputProcessors(
      [...configuredProcessors, citationRecall],
      context,
    );
    return [...inherited, citationRecall];
  }
}

export interface CreateGistMemoryOptions {
  readonly storage: LibSQLStore;
  readonly databaseUrl: string;
  readonly embeddingModel: string;
}

export function createGistMemory({
  storage,
  databaseUrl,
  embeddingModel,
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
  });
}
