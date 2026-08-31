import type { MastraDBMessage } from '@mastra/core/agent';
import type { MemoryStorage } from '@mastra/core/storage';
import type { LibSQLStore } from '@mastra/libsql';

import type { ChannelMessageRecord } from '../../ingestion/persistence/index.js';
import {
  boundaryIdFor,
  messageKey,
  type ChannelBoundaryId,
  type MessageKey,
  type ResourceIdentity,
  type ThreadId,
} from '../../mastra/memory/resource-policy.js';

export type HistorySection = 'current_thread' | 'recent_channel';

export interface HistoryLimits {
  readonly records: number;
  readonly tokens: number;
}

export interface HistoryCursor {
  readonly boundary_id: ChannelBoundaryId;
  readonly section: HistorySection;
  readonly thread_id: ThreadId | null;
  readonly message_ts: string;
  readonly message_key: MessageKey;
}

export interface ChannelHistoryRecord extends ChannelMessageRecord {
  readonly token_count: number;
}

export interface ChannelHistoryPage {
  readonly section: HistorySection;
  /** Oldest to newest within this page. */
  readonly records: readonly ChannelHistoryRecord[];
  readonly record_count: number;
  readonly token_count: number;
  /** Cursor for the next, older page. */
  readonly next_cursor: HistoryCursor | null;
}

export interface HistoryQuery {
  readonly identity: ResourceIdentity;
  readonly limits: HistoryLimits;
  readonly cursor?: HistoryCursor;
}

export interface ChannelHistoryProviderOptions {
  readonly storage: LibSQLStore;
  readonly countTokens: (text: string) => number;
  readonly maxRecords: number;
  readonly maxTokens: number;
}

export class HistoryBoundaryError extends Error {
  readonly code = 'history_boundary_invalid';

  constructor() {
    super('Channel history boundary is missing or invalid.');
    this.name = 'HistoryBoundaryError';
  }
}

export class HistoryCursorError extends Error {
  readonly code = 'history_cursor_invalid';

  constructor() {
    super('Channel history cursor is invalid for this query.');
    this.name = 'HistoryCursorError';
  }
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function messageText(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function metadataOf(message: MastraDBMessage): Record<string, unknown> {
  return message.content.metadata ?? {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function validSender(value: unknown): value is ChannelMessageRecord['sender'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const sender = value as Record<string, unknown>;
  return (
    ['human', 'gist', 'kilo', 'bot', 'app'].includes(String(sender.sender_class)) &&
    isNonEmptyString(sender.sender_id) &&
    isNonEmptyString(sender.sender_display_name) &&
    isNullableString(sender.bot_id) &&
    isNullableString(sender.app_id) &&
    isNullableString(sender.username) &&
    typeof sender.is_gist_self === 'boolean' &&
    sender.is_gist_self === (sender.sender_class === 'gist') &&
    typeof sender.is_external === 'boolean' &&
    typeof sender.is_guest === 'boolean'
  );
}

function validFiles(value: unknown): value is ChannelMessageRecord['files'] {
  return Array.isArray(value) && value.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const file = entry as Record<string, unknown>;
    return (
      isNonEmptyString(file.file_id) &&
      isNonEmptyString(file.name) &&
      isNonEmptyString(file.mimetype) &&
      Number.isSafeInteger(file.size_bytes) &&
      Number(file.size_bytes) >= 0
    );
  });
}

function validLinks(value: unknown): value is ChannelMessageRecord['links'] {
  return Array.isArray(value) && value.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const link = entry as Record<string, unknown>;
    return isNonEmptyString(link.url) && isNonEmptyString(link.domain);
  });
}

function boundaryParts(boundaryId: ChannelBoundaryId): {
  workspaceId: string;
  channelId: string;
} {
  const [, workspaceId, channelId, extra] = boundaryId.split(':');
  if (!workspaceId || !channelId || extra !== undefined) throw new HistoryBoundaryError();
  return { workspaceId, channelId };
}

function channelBoundary(identity: ResourceIdentity): ChannelBoundaryId {
  try {
    if (identity?.conversation_type !== 'channel') throw new HistoryBoundaryError();
    const boundaryId = boundaryIdFor(identity);
    if (!boundaryId.startsWith('ch:')) throw new HistoryBoundaryError();
    const channelBoundaryId = boundaryId as ChannelBoundaryId;
    boundaryParts(channelBoundaryId);
    return channelBoundaryId;
  } catch {
    throw new HistoryBoundaryError();
  }
}

interface SlackTimestampParts {
  readonly seconds: bigint;
  readonly fraction: string;
}

function slackTimestampParts(value: string): SlackTimestampParts | null {
  const match = /^(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return { seconds: BigInt(match[1]!), fraction: match[2]! };
}

/** Numeric Slack-ts order; equal numeric forms are resolved by record tie-breaks. */
function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSlackTimestamp(left: string, right: string): number {
  const a = slackTimestampParts(left);
  const b = slackTimestampParts(right);
  if (!a || !b) return compareString(left, right);
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, '0');
  const bFraction = b.fraction.padEnd(width, '0');
  return aFraction < bFraction ? -1 : aFraction > bFraction ? 1 : 0;
}

function compareRecords(left: ChannelHistoryRecord, right: ChannelHistoryRecord): number {
  const timestampOrder = compareSlackTimestamp(left.message_ts, right.message_ts);
  if (timestampOrder !== 0) return timestampOrder;
  const keyOrder = compareString(left.message_key, right.message_key);
  if (keyOrder !== 0) return keyOrder;
  return compareString(left.thread_id, right.thread_id);
}

function recordFrom(
  message: MastraDBMessage,
  boundaryId: ChannelBoundaryId,
  countTokens: (text: string) => number,
): ChannelHistoryRecord | null {
  const metadata = metadataOf(message);
  const { workspaceId, channelId } = boundaryParts(boundaryId);
  const threadPrefix = `${boundaryId}#`;
  const messageTs = metadata.message_ts;
  const threadRootTs = metadata.thread_root_ts;
  const sender = metadata.sender;
  const text = messageText(message);

  if (
    message.resourceId !== boundaryId ||
    typeof message.threadId !== 'string' ||
    !message.threadId.startsWith(threadPrefix) ||
    metadata.contract_version !== '1.0.0' ||
    metadata.message_key !== message.id ||
    metadata.boundary_id !== boundaryId ||
    metadata.thread_id !== message.threadId ||
    metadata.workspace_id !== workspaceId ||
    metadata.channel_id !== channelId ||
    typeof messageTs !== 'string' ||
    !slackTimestampParts(messageTs) ||
    typeof threadRootTs !== 'string' ||
    threadRootTs !== message.threadId.slice(threadPrefix.length) ||
    !slackTimestampParts(threadRootTs) ||
    metadata.is_thread_reply !== (threadRootTs !== messageTs) ||
    !validSender(sender) ||
    typeof metadata.sent_at !== 'string' ||
    Number.isNaN(Date.parse(metadata.sent_at)) ||
    !isNullableString(metadata.edited_at) ||
    (typeof metadata.edited_at === 'string' && Number.isNaN(Date.parse(metadata.edited_at))) ||
    !validFiles(metadata.files) ||
    !validLinks(metadata.links) ||
    (metadata.capture_source !== 'live_event' && metadata.capture_source !== 'outgoing_self') ||
    typeof metadata.ingested_at !== 'string' ||
    Number.isNaN(Date.parse(metadata.ingested_at)) ||
    !Number.isSafeInteger(metadata.enrollment_epoch) ||
    Number(metadata.enrollment_epoch) < 1
  ) return null;

  let expectedKey: MessageKey;
  try {
    expectedKey = messageKey({ workspace_id: workspaceId, channel_id: channelId, message_ts: messageTs });
  } catch {
    return null;
  }
  if (message.id !== expectedKey) return null;

  const tokenCount = countTokens(text);
  if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
    throw new TypeError('countTokens must return a non-negative safe integer.');
  }

  return {
    contract_version: '1.0.0',
    message_key: expectedKey,
    boundary_id: boundaryId,
    thread_id: message.threadId as ThreadId,
    workspace_id: workspaceId,
    channel_id: channelId,
    message_ts: messageTs,
    thread_root_ts: threadRootTs,
    is_thread_reply: threadRootTs !== messageTs,
    sender,
    sent_at: metadata.sent_at,
    edited_at: metadata.edited_at,
    text,
    files: metadata.files,
    links: metadata.links,
    capture_source: metadata.capture_source,
    ingested_at: metadata.ingested_at,
    enrollment_epoch: Number(metadata.enrollment_epoch),
    token_count: tokenCount,
  };
}

export class ChannelHistoryProvider {
  readonly #storage: LibSQLStore;
  readonly #countTokens: (text: string) => number;
  readonly #maxRecords: number;
  readonly #maxTokens: number;

  constructor({ storage, countTokens, maxRecords, maxTokens }: ChannelHistoryProviderOptions) {
    this.#storage = storage;
    this.#countTokens = countTokens;
    this.#maxRecords = positiveInteger(maxRecords, 'maxRecords');
    this.#maxTokens = positiveInteger(maxTokens, 'maxTokens');
  }

  async recentChannel(query: HistoryQuery): Promise<ChannelHistoryPage> {
    return this.#query(query, 'recent_channel');
  }

  async currentThread(query: HistoryQuery): Promise<ChannelHistoryPage> {
    return this.#query(query, 'current_thread');
  }

  async #query(query: HistoryQuery, section: HistorySection): Promise<ChannelHistoryPage> {
    const boundaryId = channelBoundary(query?.identity);
    const limits = this.#limits(query?.limits);
    const store = await this.#memoryStore();
    const result = section === 'recent_channel'
      ? await store.listMessagesByResourceId({ resourceId: boundaryId, perPage: false })
      : await store.listMessages({
          threadId: query.identity.thread_id,
          resourceId: boundaryId,
          perPage: false,
        });

    const records = result.messages
      .map((message) => recordFrom(message, boundaryId, this.#countTokens))
      .filter((record): record is ChannelHistoryRecord => record !== null)
      .sort(compareRecords);

    return this.#page(records, boundaryId, query.identity.thread_id, section, limits, query.cursor);
  }

  #limits(limits: HistoryLimits | undefined): HistoryLimits {
    if (!limits) throw new TypeError('History limits are required.');
    const records = positiveInteger(limits.records, 'limits.records');
    const tokens = positiveInteger(limits.tokens, 'limits.tokens');
    if (records > this.#maxRecords || tokens > this.#maxTokens) {
      throw new RangeError('History limits exceed provider bounds.');
    }
    return { records, tokens };
  }

  #page(
    chronological: readonly ChannelHistoryRecord[],
    boundaryId: ChannelBoundaryId,
    threadId: ThreadId,
    section: HistorySection,
    limits: HistoryLimits,
    cursor: HistoryCursor | undefined,
  ): ChannelHistoryPage {
    const newestFirst = [...chronological].reverse();
    let start = 0;
    if (cursor) {
      const expectedThread = section === 'current_thread' ? threadId : null;
      if (
        cursor.boundary_id !== boundaryId ||
        cursor.section !== section ||
        cursor.thread_id !== expectedThread
      ) throw new HistoryCursorError();
      const cursorIndex = newestFirst.findIndex(
        (record) => record.message_ts === cursor.message_ts && record.message_key === cursor.message_key,
      );
      if (cursorIndex < 0) throw new HistoryCursorError();
      start = cursorIndex + 1;
    }

    const selected: ChannelHistoryRecord[] = [];
    let tokenCount = 0;
    let lastScanned = start - 1;
    for (let index = start; index < newestFirst.length; index += 1) {
      const record = newestFirst[index]!;
      lastScanned = index;
      if (tokenCount + record.token_count > limits.tokens) continue;
      selected.push(record);
      tokenCount += record.token_count;
      if (selected.length === limits.records || tokenCount === limits.tokens) break;
    }

    const hasMore = lastScanned >= start && lastScanned < newestFirst.length - 1;
    const cursorRecord = hasMore ? newestFirst[lastScanned]! : null;
    return {
      section,
      records: selected.reverse(),
      record_count: selected.length,
      token_count: tokenCount,
      next_cursor: cursorRecord
        ? {
            boundary_id: boundaryId,
            section,
            thread_id: section === 'current_thread' ? threadId : null,
            message_ts: cursorRecord.message_ts,
            message_key: cursorRecord.message_key,
          }
        : null,
    };
  }

  async #memoryStore(): Promise<MemoryStorage> {
    const store = await this.#storage.getStore('memory');
    if (!store) throw new Error('Channel history storage is unavailable.');
    return store;
  }
}
