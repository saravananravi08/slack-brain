import { isDeepStrictEqual } from 'node:util';

import type { MastraDBMessage } from '@mastra/core/agent';
import type { MemoryStorage } from '@mastra/core/storage';
import type { LibSQLStore } from '@mastra/libsql';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  type GistMemory,
} from '../../mastra/memory/gist-memory.js';
import {
  boundaryIdFor,
  messageKey,
  type ChannelBoundaryId,
  type MessageKey,
  type ThreadId,
} from '../../mastra/memory/resource-policy.js';
import { sentAtFrom } from '../events/normalize.js';

const MESSAGE_INDEX = 'memory_messages';
const PENDING_METADATA_KEY = 'channel_embedding_pending';
const DEFAULT_MAX_ATTEMPTS = 3;
const CONTRACT_VERSION = '1.0.0' as const;

export type ChannelSenderClass = 'human' | 'gist' | 'kilo' | 'bot' | 'app' | 'system';
export type CaptureSource = 'live_event' | 'outgoing_self';

export interface CanonicalSender {
  readonly sender_class: ChannelSenderClass;
  readonly sender_id: string;
  readonly sender_display_name: string;
  readonly bot_id: string | null;
  readonly app_id: string | null;
  readonly username: string | null;
  readonly is_gist_self: boolean;
  readonly is_external: boolean;
  readonly is_guest: boolean;
}

export interface FileRef {
  readonly file_id: string;
  readonly name: string;
  readonly mimetype: string;
  readonly size_bytes: number;
}

export interface LinkRef {
  readonly url: string;
  readonly domain: string;
}

/** Frozen channel-memory/message-record.md §3 shape. */
export interface ChannelMessageRecord {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly message_key: MessageKey;
  readonly boundary_id: ChannelBoundaryId;
  readonly thread_id: ThreadId;
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly message_ts: string;
  readonly thread_root_ts: string;
  readonly is_thread_reply: boolean;
  readonly sender: CanonicalSender;
  readonly sent_at: string;
  readonly edited_at: string | null;
  readonly text: string;
  readonly files: readonly FileRef[];
  readonly links: readonly LinkRef[];
  readonly capture_source: CaptureSource;
  readonly ingested_at: string;
  readonly enrollment_epoch: number;
}

export type ChannelMessagePersistenceResult =
  | {
      readonly outcome: 'inserted' | 'unchanged';
      readonly embedding: 'stored';
    }
  | {
      readonly outcome: 'inserted' | 'unchanged';
      readonly embedding: 'pending';
      readonly retryable: true;
    }
  | { readonly outcome: 'skipped'; readonly reason: 'invalid_record' }
  | {
      readonly outcome: 'failed';
      readonly reason: 'persistence_failed' | 'content_conflict';
      readonly retryable: boolean;
    };

export interface ChannelMessagePersistenceOptions {
  readonly memory: GistMemory;
  readonly storage: LibSQLStore;
  readonly maxAttempts?: number;
}

function recordMetadata(record: ChannelMessageRecord, pending: boolean): Record<string, unknown> {
  return {
    ...record,
    conversation_type: 'channel',
    sender_id: record.sender.sender_id,
    sender_name: record.sender.sender_display_name,
    source: 'live',
    ...(pending ? { [PENDING_METADATA_KEY]: true } : {}),
  };
}

function metadata(message: MastraDBMessage): Record<string, unknown> {
  return message.content.metadata ?? {};
}

function messageText(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function expectedRole(record: ChannelMessageRecord): 'user' | 'assistant' {
  return record.sender.sender_class === 'gist' ? 'assistant' : 'user';
}

function toMastraMessage(record: ChannelMessageRecord, pending: boolean): MastraDBMessage {
  return {
    id: record.message_key,
    role: expectedRole(record),
    createdAt: new Date(record.sent_at),
    threadId: record.thread_id,
    resourceId: record.boundary_id,
    content: {
      format: 2,
      parts: [{ type: 'text', text: record.text }],
      metadata: recordMetadata(record, pending),
    },
  };
}

function withoutPending(message: MastraDBMessage): MastraDBMessage {
  const { [PENDING_METADATA_KEY]: _, ...completedMetadata } = metadata(message);
  return {
    ...message,
    content: { ...message.content, metadata: completedMetadata },
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function validDate(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validSender(sender: CanonicalSender): boolean {
  return (
    sender !== null &&
    typeof sender === 'object' &&
    ['human', 'gist', 'kilo', 'bot', 'app'].includes(sender.sender_class) &&
    nonEmptyString(sender.sender_id) &&
    nonEmptyString(sender.sender_display_name) &&
    nullableString(sender.bot_id) &&
    nullableString(sender.app_id) &&
    nullableString(sender.username) &&
    typeof sender.is_gist_self === 'boolean' &&
    sender.is_gist_self === (sender.sender_class === 'gist') &&
    typeof sender.is_external === 'boolean' &&
    typeof sender.is_guest === 'boolean'
  );
}

function validFiles(files: readonly FileRef[]): boolean {
  return Array.isArray(files) && files.every((file) =>
    file !== null &&
    typeof file === 'object' &&
    nonEmptyString(file.file_id) &&
    nonEmptyString(file.name) &&
    nonEmptyString(file.mimetype) &&
    Number.isSafeInteger(file.size_bytes) &&
    file.size_bytes >= 0,
  );
}

function validLinks(links: readonly LinkRef[]): boolean {
  return Array.isArray(links) && links.every((link) =>
    link !== null &&
    typeof link === 'object' &&
    nonEmptyString(link.url) &&
    nonEmptyString(link.domain),
  );
}

function validIdentity(record: ChannelMessageRecord): boolean {
  try {
    if (messageKey(record) !== record.message_key) return false;
    if (sentAtFrom(record.message_ts) !== record.sent_at) return false;

    boundaryIdFor({
      contract_version: CONTRACT_VERSION,
      boundary_id: record.boundary_id,
      resource_id: record.boundary_id,
      thread_id: record.thread_id,
      conversation_type: 'channel',
    });

    const boundaryParts = record.boundary_id.split(':');
    if (
      boundaryParts.length !== 3 ||
      boundaryParts[1] !== record.workspace_id ||
      boundaryParts[2] !== record.channel_id
    ) return false;

    const separator = record.thread_id.lastIndexOf('#');
    if (separator < 0 || record.thread_id.slice(separator + 1) !== record.thread_root_ts) {
      return false;
    }
    return record.is_thread_reply === (record.thread_root_ts !== record.message_ts);
  } catch {
    return false;
  }
}

function isValidRecord(record: ChannelMessageRecord): boolean {
  return (
    record !== null &&
    typeof record === 'object' &&
    record.contract_version === CONTRACT_VERSION &&
    validIdentity(record) &&
    validSender(record.sender) &&
    validDate(record.sent_at) &&
    (record.edited_at === null || validDate(record.edited_at)) &&
    typeof record.text === 'string' &&
    validFiles(record.files) &&
    validLinks(record.links) &&
    (record.capture_source === 'live_event' ||
      (record.capture_source === 'outgoing_self' && record.sender.sender_class === 'gist')) &&
    validDate(record.ingested_at) &&
    Number.isSafeInteger(record.enrollment_epoch) &&
    record.enrollment_epoch >= 1
  );
}

/** `capture_source` and `ingested_at` are first-writer facts, not message identity. */
function canonicalMatches(existing: MastraDBMessage, record: ChannelMessageRecord): boolean {
  const existingMetadata = metadata(existing);
  return (
    existing.id === record.message_key &&
    existing.resourceId === record.boundary_id &&
    existing.threadId === record.thread_id &&
    existing.role === expectedRole(record) &&
    existing.createdAt.toISOString() === record.sent_at &&
    messageText(existing) === record.text &&
    existingMetadata.contract_version === record.contract_version &&
    existingMetadata.message_key === record.message_key &&
    existingMetadata.boundary_id === record.boundary_id &&
    existingMetadata.thread_id === record.thread_id &&
    existingMetadata.workspace_id === record.workspace_id &&
    existingMetadata.channel_id === record.channel_id &&
    existingMetadata.message_ts === record.message_ts &&
    existingMetadata.thread_root_ts === record.thread_root_ts &&
    existingMetadata.is_thread_reply === record.is_thread_reply &&
    isDeepStrictEqual(existingMetadata.sender, record.sender) &&
    existingMetadata.sender_id === record.sender.sender_id &&
    existingMetadata.sender_name === record.sender.sender_display_name &&
    existingMetadata.sent_at === record.sent_at &&
    existingMetadata.edited_at === record.edited_at &&
    existingMetadata.text === record.text &&
    isDeepStrictEqual(existingMetadata.files, record.files) &&
    isDeepStrictEqual(existingMetadata.links, record.links) &&
    existingMetadata.enrollment_epoch === record.enrollment_epoch &&
    existingMetadata.conversation_type === 'channel' &&
    existingMetadata.source === 'live' &&
    (existingMetadata.capture_source === 'live_event' ||
      existingMetadata.capture_source === 'outgoing_self') &&
    validDate(existingMetadata.ingested_at)
  );
}

function positiveInteger(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError('maxAttempts must be a positive integer.');
  }
  return resolved;
}

export class ChannelMessagePersistenceService {
  readonly #memory: GistMemory;
  readonly #storage: LibSQLStore;
  readonly #maxAttempts: number;

  constructor({ memory, storage, maxAttempts }: ChannelMessagePersistenceOptions) {
    this.#memory = memory;
    this.#storage = storage;
    this.#maxAttempts = positiveInteger(maxAttempts);
  }

  async persist(record: ChannelMessageRecord): Promise<ChannelMessagePersistenceResult> {
    if (!isValidRecord(record)) return { outcome: 'skipped', reason: 'invalid_record' };

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const store = await this.#storage.getStore('memory');
        if (!store) throw new Error('Memory storage unavailable.');
        return await this.#persistRecord(store, record);
      } catch (error) {
        if (error instanceof ContentConflictError) {
          return { outcome: 'failed', reason: 'content_conflict', retryable: false };
        }
        if (attempt === this.#maxAttempts) {
          return { outcome: 'failed', reason: 'persistence_failed', retryable: true };
        }
      }
    }

    return { outcome: 'failed', reason: 'persistence_failed', retryable: true };
  }

  async #persistRecord(
    store: MemoryStorage,
    record: ChannelMessageRecord,
  ): Promise<ChannelMessagePersistenceResult> {
    const existing = (await store.listMessagesById({
      messageIds: [record.message_key],
    })).messages[0];

    if (existing && !canonicalMatches(existing, record)) throw new ContentConflictError();

    const pending = existing ? metadata(existing)[PENDING_METADATA_KEY] === true : true;
    if (existing && !pending) return { outcome: 'unchanged', embedding: 'stored' };

    const thread = await this.#memory.getThreadById({ threadId: record.thread_id });
    if (thread && thread.resourceId !== record.boundary_id) throw new ContentConflictError();
    if (!thread) {
      await this.#memory.createThread({
        threadId: record.thread_id,
        resourceId: record.boundary_id,
        saveThread: true,
      });
    }

    const message = existing ?? toMastraMessage(record, true);
    if (!existing) await store.saveMessages({ messages: [message] });
    const outcome = existing ? 'unchanged' as const : 'inserted' as const;
    const existingMetadata = metadata(message);
    const embeddingRecord = existing
      ? {
          ...record,
          capture_source: existingMetadata.capture_source as CaptureSource,
          ingested_at: existingMetadata.ingested_at as string,
        }
      : record;

    if (!(await this.#storeEmbedding(embeddingRecord))) {
      return { outcome, embedding: 'pending', retryable: true };
    }

    await store.saveMessages({ messages: [withoutPending(message)] });
    return { outcome, embedding: 'stored' };
  }

  async #storeEmbedding(record: ChannelMessageRecord): Promise<boolean> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        if (!this.#memory.vector || !this.#memory.embedder) return false;
        const embedding = await this.#memory.embedder.doEmbed({ values: [record.text] });
        const vector = embedding.embeddings[0];
        if (!vector || vector.length !== GIST_EMBEDDING_DIMENSIONS) {
          throw new Error('Embedding dimension mismatch.');
        }

        await this.#memory.vector.createIndex({
          indexName: MESSAGE_INDEX,
          dimension: GIST_EMBEDDING_DIMENSIONS,
        });
        await this.#memory.vector.deleteVectors({
          indexName: MESSAGE_INDEX,
          filter: { message_id: record.message_key },
        });
        await this.#memory.vector.upsert({
          indexName: MESSAGE_INDEX,
          ids: [record.message_key],
          vectors: [vector],
          metadata: [{
            message_id: record.message_key,
            thread_id: record.thread_id,
            resource_id: record.boundary_id,
            boundary_id: record.boundary_id,
            channel_id: record.channel_id,
            message_ts: record.message_ts,
            thread_root_ts: record.thread_root_ts,
            sender_class: record.sender.sender_class,
            sender_id: record.sender.sender_id,
            sender_name: record.sender.sender_display_name,
            capture_source: record.capture_source,
            files: record.files,
            links: record.links,
            role: expectedRole(record),
            content: record.text,
            created_at: record.sent_at,
            model: GIST_EMBEDDING_MODEL,
            embedded_at: record.ingested_at,
          }],
        });
        return true;
      } catch {
        // Canonical message already exists. Deterministic vector ID makes retry safe.
      }
    }
    return false;
  }
}

class ContentConflictError extends Error {}
