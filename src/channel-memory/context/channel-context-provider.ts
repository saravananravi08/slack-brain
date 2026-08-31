import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  type RequestContext,
} from '@mastra/core/request-context';

import type {
  ChannelHistoryPage,
  ChannelHistoryRecord,
  HistoryLimits,
  HistoryQuery,
} from '../history/index.js';
import type { ChannelObservationContext } from '../observations/index.js';
import {
  boundaryIdFor,
  type ResourceIdentity,
} from '../../mastra/memory/resource-policy.js';
import { CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY } from '../../mastra/tools/channel-memory-search.js';
import {
  authorize,
  type AuthorizationRequest,
} from '../../security/index.js';

export const CHANNEL_CONTEXT_CONTRACT_VERSION = '1.0.0' as const;

export type ChannelContextSectionId =
  | 'current_thread'
  | 'recent_channel_history'
  | 'rolling_channel_summary'
  | 'channel_observations';

export interface ChannelContextBudgets {
  readonly total_tokens: number;
  readonly current_thread: HistoryLimits;
  readonly recent_channel_history: HistoryLimits;
  readonly rolling_channel_summary_tokens: number;
  readonly channel_observations_tokens: number;
}

export interface ChannelContextMessage {
  readonly source: 'slack_message';
  readonly channel_id: string;
  readonly message_ts: string;
  readonly thread_root_ts: string;
  readonly is_thread_reply: boolean;
  readonly sender: ChannelHistoryRecord['sender'];
  readonly sent_at: string;
  readonly edited_at: string | null;
  readonly text: string;
  readonly files: ChannelHistoryRecord['files'];
  readonly links: ChannelHistoryRecord['links'];
  readonly capture_source: ChannelHistoryRecord['capture_source'];
  readonly token_count: number;
}

export interface ExactHistoryContextSection {
  readonly id: 'current_thread' | 'recent_channel_history';
  readonly label: 'Current Slack thread' | 'Recent channel history';
  readonly source: 'exact_channel_messages';
  readonly content_type: 'untrusted_slack_content';
  readonly status: 'available' | 'unavailable';
  readonly records: readonly ChannelContextMessage[];
  readonly record_count: number;
  readonly token_count: number;
  readonly budget: {
    readonly record_limit: number;
    readonly token_limit: number;
  };
}

export type DerivedContextStatus = 'available' | 'absent' | 'stale' | 'unavailable';

export interface DerivedContextSection {
  readonly id: 'rolling_channel_summary' | 'channel_observations';
  readonly label: 'Rolling channel summary' | 'Channel observations';
  readonly source: 'observation_memory';
  readonly content_type: 'untrusted_derived_content';
  readonly status: DerivedContextStatus;
  readonly text: string | null;
  readonly token_count: number;
  readonly token_limit: number;
  readonly truncated: boolean;
}

export type ChannelContextSections = readonly [
  ExactHistoryContextSection,
  ExactHistoryContextSection,
  DerivedContextSection,
  DerivedContextSection,
];

export interface ChannelContext {
  readonly contract_version: typeof CHANNEL_CONTEXT_CONTRACT_VERSION;
  readonly sections: ChannelContextSections;
  readonly token_count: number;
  readonly token_limit: number;
}

export interface ChannelContextHistoryReader {
  currentThread(query: HistoryQuery): Promise<ChannelHistoryPage>;
  recentChannel(query: HistoryQuery): Promise<ChannelHistoryPage>;
}

export interface ChannelObservationSnapshot extends ChannelObservationContext {
  /** Optional freshness signal for readers that can observe invalidation lag. */
  readonly stale?: boolean;
}

export interface ChannelContextObservationReader {
  context(channelResource: string, threadId: string): Promise<ChannelObservationSnapshot>;
}

export interface ChannelContextProviderOptions {
  readonly history: ChannelContextHistoryReader;
  readonly observations: ChannelContextObservationReader;
  readonly budgets: ChannelContextBudgets;
  readonly countTokens: (text: string) => number;
}

export class ChannelContextScopeError extends Error {
  readonly code = 'channel_context_scope_unavailable';

  constructor() {
    super('Trusted channel context scope is unavailable.');
    this.name = 'ChannelContextScopeError';
  }
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function validatedBudgets(budgets: ChannelContextBudgets): ChannelContextBudgets {
  const resolved = {
    total_tokens: positiveInteger(budgets.total_tokens, 'budgets.total_tokens'),
    current_thread: {
      records: positiveInteger(
        budgets.current_thread.records,
        'budgets.current_thread.records',
      ),
      tokens: positiveInteger(
        budgets.current_thread.tokens,
        'budgets.current_thread.tokens',
      ),
    },
    recent_channel_history: {
      records: positiveInteger(
        budgets.recent_channel_history.records,
        'budgets.recent_channel_history.records',
      ),
      tokens: positiveInteger(
        budgets.recent_channel_history.tokens,
        'budgets.recent_channel_history.tokens',
      ),
    },
    rolling_channel_summary_tokens: positiveInteger(
      budgets.rolling_channel_summary_tokens,
      'budgets.rolling_channel_summary_tokens',
    ),
    channel_observations_tokens: positiveInteger(
      budgets.channel_observations_tokens,
      'budgets.channel_observations_tokens',
    ),
  };
  const sectionMaximum =
    resolved.current_thread.tokens +
    resolved.recent_channel_history.tokens +
    resolved.rolling_channel_summary_tokens +
    resolved.channel_observations_tokens;
  if (sectionMaximum > resolved.total_tokens) {
    throw new RangeError('Channel context section budgets exceed total token budget.');
  }
  return resolved;
}

function tokenCount(countTokens: (text: string) => number, text: string): number {
  if (text === '') return 0;
  const count = countTokens(text);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('countTokens must return a non-negative safe integer.');
  }
  return count;
}

function boundedText(
  text: string,
  limit: number,
  countTokens: (text: string) => number,
): { text: string; tokenCount: number; truncated: boolean } {
  const fullCount = tokenCount(countTokens, text);
  if (fullCount <= limit) return { text, tokenCount: fullCount, truncated: false };

  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = characters.slice(0, middle).join('');
    if (tokenCount(countTokens, candidate) <= limit) low = middle;
    else high = middle - 1;
  }

  let bounded = characters.slice(0, low).join('');
  let boundedCount = tokenCount(countTokens, bounded);
  while (boundedCount > limit && low > 0) {
    low -= 1;
    bounded = characters.slice(0, low).join('');
    boundedCount = tokenCount(countTokens, bounded);
  }
  return { text: bounded, tokenCount: boundedCount, truncated: true };
}

function resolveTrustedIdentity(requestContext: RequestContext): ResourceIdentity {
  try {
    const request = requestContext.getRaw(
      CHANNEL_MEMORY_AUTHORIZATION_CONTEXT_KEY,
    ) as AuthorizationRequest;
    const decision = authorize(request);
    const resourceId = requestContext.getRaw(MASTRA_RESOURCE_ID_KEY);
    const threadId = requestContext.getRaw(MASTRA_THREAD_ID_KEY);
    const identity = request.identity as ResourceIdentity;
    const boundaryId = boundaryIdFor(identity);

    if (
      !decision.allowed ||
      decision.gate !== 'read_memory' ||
      decision.scope.length !== 1 ||
      decision.scope[0] !== boundaryId ||
      identity.conversation_type !== 'channel' ||
      resourceId !== boundaryId ||
      threadId !== identity.thread_id
    ) throw new ChannelContextScopeError();
    return identity;
  } catch {
    throw new ChannelContextScopeError();
  }
}

function boundedMessages(
  page: ChannelHistoryPage,
  identity: ResourceIdentity,
  limits: HistoryLimits,
  currentThread: boolean,
  countTokens: (text: string) => number,
): readonly ChannelContextMessage[] {
  const selected: ChannelContextMessage[] = [];
  let usedTokens = 0;
  const newestFirst = [...page.records].reverse();

  for (const record of newestFirst) {
    if (
      record.boundary_id !== identity.boundary_id ||
      (currentThread && record.thread_id !== identity.thread_id)
    ) continue;
    const recordTokens = tokenCount(countTokens, record.text);
    if (usedTokens + recordTokens > limits.tokens) continue;
    selected.push({
      source: 'slack_message',
      channel_id: record.channel_id,
      message_ts: record.message_ts,
      thread_root_ts: record.thread_root_ts,
      is_thread_reply: record.is_thread_reply,
      sender: record.sender,
      sent_at: record.sent_at,
      edited_at: record.edited_at,
      text: record.text,
      files: record.files,
      links: record.links,
      capture_source: record.capture_source,
      token_count: recordTokens,
    });
    usedTokens += recordTokens;
    if (selected.length === limits.records || usedTokens === limits.tokens) break;
  }

  return selected.reverse();
}

function historySection(
  id: ExactHistoryContextSection['id'],
  outcome: PromiseSettledResult<ChannelHistoryPage>,
  identity: ResourceIdentity,
  limits: HistoryLimits,
  countTokens: (text: string) => number,
): ExactHistoryContextSection {
  const records = outcome.status === 'fulfilled'
    ? boundedMessages(
        outcome.value,
        identity,
        limits,
        id === 'current_thread',
        countTokens,
      )
    : [];
  return {
    id,
    label: id === 'current_thread' ? 'Current Slack thread' : 'Recent channel history',
    source: 'exact_channel_messages',
    content_type: 'untrusted_slack_content',
    status: outcome.status === 'fulfilled' ? 'available' : 'unavailable',
    records,
    record_count: records.length,
    token_count: records.reduce((total, record) => total + record.token_count, 0),
    budget: { record_limit: limits.records, token_limit: limits.tokens },
  };
}

function derivedSection(
  id: DerivedContextSection['id'],
  value: string | null,
  status: DerivedContextStatus,
  limit: number,
  countTokens: (text: string) => number,
): DerivedContextSection {
  const bounded = value === null
    ? { text: null, tokenCount: 0, truncated: false }
    : boundedText(value, limit, countTokens);
  return {
    id,
    label: id === 'rolling_channel_summary'
      ? 'Rolling channel summary'
      : 'Channel observations',
    source: 'observation_memory',
    content_type: 'untrusted_derived_content',
    status,
    text: bounded.text,
    token_count: bounded.tokenCount,
    token_limit: limit,
    truncated: bounded.truncated,
  };
}

export class ChannelContextProvider {
  readonly #history: ChannelContextHistoryReader;
  readonly #observations: ChannelContextObservationReader;
  readonly #budgets: ChannelContextBudgets;
  readonly #countTokens: (text: string) => number;

  constructor({
    history,
    observations,
    budgets,
    countTokens,
  }: ChannelContextProviderOptions) {
    this.#history = history;
    this.#observations = observations;
    this.#budgets = validatedBudgets(budgets);
    this.#countTokens = countTokens;
  }

  async getChannelContext(requestContext: RequestContext): Promise<ChannelContext> {
    const identity = resolveTrustedIdentity(requestContext);
    const [currentThread, recentChannel, observationContext] = await Promise.allSettled([
      this.#history.currentThread({
        identity,
        limits: this.#budgets.current_thread,
      }),
      this.#history.recentChannel({
        identity,
        limits: this.#budgets.recent_channel_history,
      }),
      this.#observations.context(identity.boundary_id, identity.thread_id),
    ]);

    const threadSection = historySection(
      'current_thread',
      currentThread,
      identity,
      this.#budgets.current_thread,
      this.#countTokens,
    );
    const channelSection = historySection(
      'recent_channel_history',
      recentChannel,
      identity,
      this.#budgets.recent_channel_history,
      this.#countTokens,
    );

    let summaryStatus: DerivedContextStatus = 'unavailable';
    let observationStatus: DerivedContextStatus = 'unavailable';
    let summary: string | null = null;
    let observations: string | null = null;
    if (observationContext.status === 'fulfilled') {
      if (observationContext.value.stale === true) {
        summaryStatus = 'stale';
        observationStatus = 'stale';
      } else {
        summary = observationContext.value.summary;
        observations = observationContext.value.observations || null;
        summaryStatus = summary === null ? 'absent' : 'available';
        observationStatus = observations === null ? 'absent' : 'available';
      }
    }

    const summarySection = derivedSection(
      'rolling_channel_summary',
      summary,
      summaryStatus,
      this.#budgets.rolling_channel_summary_tokens,
      this.#countTokens,
    );
    const observationsSection = derivedSection(
      'channel_observations',
      observations,
      observationStatus,
      this.#budgets.channel_observations_tokens,
      this.#countTokens,
    );
    const sections: ChannelContextSections = [
      threadSection,
      channelSection,
      summarySection,
      observationsSection,
    ];

    return {
      contract_version: CHANNEL_CONTEXT_CONTRACT_VERSION,
      sections,
      token_count: sections.reduce((total, section) => total + section.token_count, 0),
      token_limit: this.#budgets.total_tokens,
    };
  }
}
