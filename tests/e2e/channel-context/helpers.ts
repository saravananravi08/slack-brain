import type { MastraDBMessage } from '@mastra/core/agent';
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import type { ObservationalMemoryRecord } from '@mastra/core/storage';
import { vi } from 'vitest';

import {
  ChannelContextProvider,
  type ChannelContext,
  type ChannelContextBudgets,
  type ChannelContextObservationReader,
} from '../../../src/channel-memory/context/index.js';
import type {
  ChannelHistoryPage,
  ChannelHistoryRecord,
  HistoryQuery,
} from '../../../src/channel-memory/history/index.js';
import {
  ChannelObservationMemory,
  type ChannelObservationMetrics,
} from '../../../src/channel-memory/observations/index.js';
import { channelContextSystemMessage } from '../../../src/mastra/agents/channel-context.js';
import { createGistAgent } from '../../../src/mastra/agents/gist.js';
import type { GistRetrievedCitation } from '../../../src/mastra/memory/gist-memory.js';
import {
  CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY,
  createChannelMemorySearchTool,
} from '../../../src/mastra/tools/channel-memory-search.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  type AuthorizationRequest,
} from '../../../src/security/index.js';

export const IDS = {
  workspace: 'T0CTX70601',
  channelA: 'C0CTX7060A',
  channelB: 'C0CTX7060B',
  user: 'U0CTX70601',
} as const;

export const ROOT = {
  A: '1767225600.000100',
  B: '1767225600.000200',
} as const;

export const BOUNDARY = {
  A: `ch:${IDS.workspace}:${IDS.channelA}`,
  B: `ch:${IDS.workspace}:${IDS.channelB}`,
} as const;

export const THREAD = {
  A: `${BOUNDARY.A}#${ROOT.A}`,
  B: `${BOUNDARY.B}#${ROOT.B}`,
} as const;

const BUDGETS: ChannelContextBudgets = {
  total_tokens: 1_000,
  current_thread: { records: 10, tokens: 250 },
  recent_channel_history: { records: 20, tokens: 350 },
  rolling_channel_summary_tokens: 150,
  channel_observations_tokens: 250,
};

export type ChannelAlias = keyof typeof BOUNDARY;

function channelFor(alias: ChannelAlias): string {
  return alias === 'A' ? IDS.channelA : IDS.channelB;
}

function rootFor(alias: ChannelAlias): string {
  return ROOT[alias];
}

export function authorization(alias: ChannelAlias): AuthorizationRequest {
  const channel = channelFor(alias);
  const boundary = BOUNDARY[alias];
  const thread = THREAD[alias];
  return {
    contract_version: AUTHORIZATION_CONTRACT_VERSION,
    gate: 'read_memory',
    event: {
      workspace_id: IDS.workspace,
      channel_id: channel,
      conversation_type: 'channel',
      sender_id: IDS.user,
      sender_type: 'human',
      sender_is_external: false,
      sender_is_guest: false,
      sender_is_deactivated: false,
    },
    identity: {
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      boundary_id: boundary,
      resource_id: boundary,
      thread_id: thread,
      conversation_type: 'channel',
    },
    policy: {
      approved_workspace_id: IDS.workspace,
      approved_channel_ids: [IDS.channelA, IDS.channelB],
      user_allowlist: [],
      dm_shared_knowledge: false,
    },
  };
}

export function requestContext(alias: ChannelAlias): RequestContext {
  const context = new RequestContext();
  context.setRaw(CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY, authorization(alias));
  context.setRaw(MASTRA_RESOURCE_ID_KEY, BOUNDARY[alias]);
  context.setRaw(MASTRA_THREAD_ID_KEY, THREAD[alias]);
  return context;
}

export function historyRecord(input: {
  readonly alias: ChannelAlias;
  readonly messageTs: string;
  readonly text: string;
  readonly senderName?: string;
  readonly threadRoot?: string;
  readonly editedAt?: string | null;
}): ChannelHistoryRecord {
  const channel = channelFor(input.alias);
  const boundary = BOUNDARY[input.alias];
  const threadRoot = input.threadRoot ?? rootFor(input.alias);
  const thread = `${boundary}#${threadRoot}`;
  return {
    contract_version: '1.0.0',
    message_key: `${IDS.workspace}/${channel}/${input.messageTs}`,
    boundary_id: boundary,
    thread_id: thread as ChannelHistoryRecord['thread_id'],
    workspace_id: IDS.workspace,
    channel_id: channel,
    message_ts: input.messageTs,
    thread_root_ts: threadRoot,
    is_thread_reply: threadRoot !== input.messageTs,
    sender: {
      sender_class: 'human',
      sender_id: IDS.user,
      sender_display_name: input.senderName ?? 'Synthetic Teammate',
      bot_id: null,
      app_id: null,
      username: null,
      is_gist_self: false,
      is_external: false,
      is_guest: false,
    },
    sent_at: '2026-01-01T00:00:00.000Z',
    edited_at: input.editedAt ?? null,
    text: input.text,
    files: [],
    links: [],
    capture_source: 'live_event',
    ingested_at: '2026-01-01T00:00:01.000Z',
    enrollment_epoch: 1,
    token_count: input.text.length,
  };
}

export function observationMessage(record: ChannelHistoryRecord): MastraDBMessage {
  return {
    id: record.message_key,
    role: 'user',
    createdAt: new Date(record.sent_at),
    resourceId: record.boundary_id,
    threadId: record.thread_id,
    content: {
      format: 2,
      parts: [{ type: 'text', text: record.text }],
      metadata: {
        sender_name: record.sender.sender_display_name,
        sender: { sender_class: record.sender.sender_class },
      },
    },
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
    token_count: records.reduce((total, record) => total + record.token_count, 0),
    next_cursor: null,
  };
}

export function contextProvider(input: {
  readonly records: readonly ChannelHistoryRecord[];
  readonly observations: ChannelContextObservationReader;
}): ChannelContextProvider {
  const recordsFor = (query: HistoryQuery, currentThread: boolean) => input.records.filter(
    (record) => record.boundary_id === query.identity.boundary_id &&
      (!currentThread || record.thread_id === query.identity.thread_id),
  );
  return new ChannelContextProvider({
    history: {
      currentThread: async (query) => page('current_thread', recordsFor(query, true)),
      recentChannel: async (query) => page('recent_channel', recordsFor(query, false)),
    },
    observations: input.observations,
    budgets: BUDGETS,
    countTokens: (text) => text.length,
  });
}

export class SyntheticObservationEngine {
  readonly scope = 'resource' as const;
  readonly records = new Map<string, ObservationalMemoryRecord>();
  readonly cleared: string[] = [];
  readonly observed: string[] = [];
  failObserve = false;
  failRead = false;

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
    if (this.failRead) throw new Error('synthetic observation read failure');
    return resourceId ? this.records.get(resourceId) ?? null : null;
  }

  async observe(options: {
    readonly threadId: string;
    readonly resourceId?: string;
    readonly messages?: MastraDBMessage[];
  }): Promise<void> {
    if (this.failObserve) throw new Error('synthetic observation generation failure');
    if (!options.resourceId) return;
    const text = options.messages?.flatMap((message) => message.content.parts)
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? '';
    this.observed.push(text);
    this.records.set(
      options.resourceId,
      observationRecord(
        options.resourceId,
        `## Channel summary\n${text}\n## Observations\n${text}`,
      ),
    );
  }

  async settled(): Promise<void> {}
}

export function observationRecord(
  resourceId: string,
  observations: string,
): ObservationalMemoryRecord {
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

export function observationMemory(input: {
  readonly engine: SyntheticObservationEngine;
  readonly messages: () => readonly MastraDBMessage[];
  readonly failure?: ChannelObservationMetrics['failure'];
}): ChannelObservationMemory {
  return new ChannelObservationMemory({
    engine: async () => input.engine,
    listMessages: async (resource) => input.messages().filter(
      (message) => message.resourceId === resource,
    ),
    metrics: {
      lag: () => undefined,
      failure: input.failure ?? vi.fn(),
    },
    now: () => 1_000,
  });
}

interface ModelCall {
  readonly prompt: unknown;
}

export interface DeterministicModel {
  readonly calls: ModelCall[];
  readonly specificationVersion: 'v2';
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]>;
  doGenerate(options: ModelCall): Promise<unknown>;
  doStream(options: ModelCall): Promise<unknown>;
}

function textStream(text: string): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'answer' });
      controller.enqueue({ type: 'text-delta', id: 'answer', delta: text });
      controller.enqueue({ type: 'text-end', id: 'answer' });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      controller.close();
    },
  });
}

function toolStream(query: string): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 't706-search-call',
        toolName: 'search_channel_memory',
        input: JSON.stringify({ query, limit: 1 }),
      });
      controller.enqueue({
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      controller.close();
    },
  });
}

export function deterministicModel(input: {
  readonly answer: string;
  readonly searchQuery?: string;
}): DeterministicModel {
  const calls: ModelCall[] = [];
  const respond = async (options: ModelCall) => {
    calls.push(options);
    const stream = input.searchQuery && calls.length === 1
      ? toolStream(input.searchQuery)
      : textStream(input.answer);
    return { stream, warnings: [] };
  };
  return {
    calls,
    specificationVersion: 'v2',
    provider: 't706-offline',
    modelId: 'deterministic-channel-context',
    supportedUrls: {},
    doGenerate: respond,
    doStream: respond,
  };
}

export interface AgentRun {
  readonly answer: string;
  readonly context: ChannelContext;
  readonly model: DeterministicModel;
  readonly recall: ReturnType<typeof vi.fn>;
  readonly toolExecutions: ReturnType<typeof vi.fn>;
}

export async function runAgent(input: {
  readonly alias: ChannelAlias;
  readonly provider: ChannelContextProvider;
  readonly question: string;
  readonly answer: string;
  readonly searchQuery?: string;
  readonly citations?: readonly GistRetrievedCitation[];
}): Promise<AgentRun> {
  const runtimeContext = requestContext(input.alias);
  const context = await input.provider.getChannelContext(runtimeContext);
  const recall = vi.fn(async () => input.citations ?? []);
  const tool = createChannelMemorySearchTool({
    memory: { recallWithCitationMetadata: recall as never },
  });
  const execute = tool.execute!.bind(tool);
  const toolExecutions = vi.fn((...args: Parameters<typeof execute>) => execute(...args));
  Object.defineProperty(tool, 'execute', { value: toolExecutions });

  const model = deterministicModel({
    answer: input.answer,
    ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
  });
  const agent = createGistAgent(model as never, undefined, tool);
  const response = await agent.stream(input.question, {
    requestContext: runtimeContext,
    system: channelContextSystemMessage(context),
    activeTools: ['search_channel_memory'],
    maxSteps: 2,
  });
  let answer = '';
  for await (const chunk of response.textStream) answer += chunk;

  return { answer, context, model, recall, toolExecutions };
}

export function serializedPrompt(call: ModelCall | undefined): string {
  return JSON.stringify(call?.prompt ?? null);
}
