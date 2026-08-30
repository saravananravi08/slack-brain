import type { MastraDBMessage } from '@mastra/core/agent';
import type { MemoryStorage } from '@mastra/core/storage';
import type { LibSQLStore } from '@mastra/libsql';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  type GistMemory,
} from '../../mastra/memory/gist-memory.js';
import type {
  BoundaryId,
  MessageKey,
  ThreadId,
} from '../../mastra/memory/resource-policy.js';

const MESSAGE_INDEX = 'memory_messages';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 3;

const DELIVERY_METADATA_KEY = 'archive_import_delivery_key';
const PENDING_DELIVERY_METADATA_KEY = 'archive_import_pending_delivery_key';
const PENDING_OUTCOME_METADATA_KEY = 'archive_import_pending_outcome';

export interface StoredMessage {
  readonly contract_version: '1.0.0';
  readonly message_key: MessageKey;
  readonly boundary_id: BoundaryId;
  readonly thread_id: ThreadId;
  readonly conversation_type: 'channel' | 'dm';
  readonly sender_id: string;
  readonly sender_name: string;
  readonly sent_at: string;
  readonly message_ts: string;
  readonly text: string;
  readonly edited_at: string | null;
  readonly source: 'live' | 'import';
  readonly ingested_at: string;
}

export type ImportDeliveryKey = `import:${string}:${MessageKey}`;

export interface ArchiveWriterRecord {
  readonly delivery_key: ImportDeliveryKey;
  readonly message: StoredMessage;
}

export type ArchiveWriteOutcome = 'inserted' | 'updated' | 'unchanged';

export interface ArchiveWriterFailure {
  readonly record_index: number;
  readonly reason: 'writer_failed';
  readonly retryable: boolean;
}

export interface ArchiveWriterResult {
  readonly accepted: number;
  readonly rejected: number;
  readonly writer: {
    readonly inserted: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly failed: number;
  };
  readonly embeddings: {
    readonly written: number;
    readonly unchanged: number;
    readonly failed: number;
  };
  readonly failures: readonly ArchiveWriterFailure[];
}

export interface MastraMemoryWriterOptions {
  readonly memory: GistMemory;
  readonly storage: LibSQLStore;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
}

class InvalidWriterRecordError extends TypeError {}

type MutableCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
};

function invalidRecord(): never {
  throw new InvalidWriterRecordError('Invalid archive writer record.');
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function validateRecord(record: ArchiveWriterRecord): void {
  const message = record?.message;
  if (!message || message.contract_version !== '1.0.0') invalidRecord();
  if (message.conversation_type !== 'channel' || !message.boundary_id.startsWith('ch:')) {
    invalidRecord();
  }

  const boundary = /^ch:([^:]+):([^:]+)$/.exec(message.boundary_id);
  if (!boundary) invalidRecord();
  const expectedMessageKey = `${boundary[1]}/${boundary[2]}/${message.message_ts}`;
  if (message.message_key !== expectedMessageKey) invalidRecord();
  if (!/^\d{10}\.\d{1,6}$/.test(message.message_ts)) invalidRecord();

  const threadPrefix = `${message.boundary_id}#`;
  if (!message.thread_id.startsWith(threadPrefix)) invalidRecord();
  if (!/^\d{10}\.\d{1,6}$/.test(message.thread_id.slice(threadPrefix.length))) {
    invalidRecord();
  }

  const deliverySuffix = `:${message.message_key}`;
  if (!record.delivery_key.startsWith('import:') || !record.delivery_key.endsWith(deliverySuffix)) {
    invalidRecord();
  }
  const runId = record.delivery_key.slice('import:'.length, -deliverySuffix.length);
  if (!runId || /[\s/]/.test(runId)) invalidRecord();

  if (
    !message.sender_id.trim() ||
    !message.sender_name.trim() ||
    !message.text.trim() ||
    message.source !== 'import' ||
    !isUtcTimestamp(message.sent_at) ||
    !isUtcTimestamp(message.ingested_at) ||
    (message.edited_at !== null && !isUtcTimestamp(message.edited_at))
  ) {
    invalidRecord();
  }
}

function messageText(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function metadata(message: MastraDBMessage): Record<string, unknown> {
  return message.content.metadata ?? {};
}

function canonicalMatches(existing: MastraDBMessage, desired: StoredMessage): boolean {
  const existingMetadata = metadata(existing);
  return (
    existing.id === desired.message_key &&
    existing.threadId === desired.thread_id &&
    existing.resourceId === desired.boundary_id &&
    existing.createdAt.toISOString() === desired.sent_at &&
    messageText(existing) === desired.text &&
    existingMetadata.contract_version === desired.contract_version &&
    existingMetadata.message_key === desired.message_key &&
    existingMetadata.boundary_id === desired.boundary_id &&
    existingMetadata.thread_id === desired.thread_id &&
    existingMetadata.conversation_type === desired.conversation_type &&
    existingMetadata.sender_id === desired.sender_id &&
    existingMetadata.sender_name === desired.sender_name &&
    existingMetadata.sent_at === desired.sent_at &&
    existingMetadata.message_ts === desired.message_ts &&
    existingMetadata.edited_at === desired.edited_at
  );
}

function channelId(message: StoredMessage): string {
  return message.message_key.split('/')[1]!;
}

function withCompletedDelivery(
  existing: MastraDBMessage,
  deliveryKey: string,
): MastraDBMessage {
  const nextMetadata = { ...metadata(existing) };
  delete nextMetadata[PENDING_DELIVERY_METADATA_KEY];
  delete nextMetadata[PENDING_OUTCOME_METADATA_KEY];
  nextMetadata[DELIVERY_METADATA_KEY] = deliveryKey;
  return {
    ...existing,
    content: { ...existing.content, metadata: nextMetadata },
  };
}

function toMastraMessage(
  record: ArchiveWriterRecord,
  state: { delivery?: string; pending?: string; outcome?: Exclude<ArchiveWriteOutcome, 'unchanged'> },
  existingMetadata: Record<string, unknown> = {},
): MastraDBMessage {
  const message = record.message;
  const nextMetadata: Record<string, unknown> = {
    ...existingMetadata,
    contract_version: message.contract_version,
    message_key: message.message_key,
    boundary_id: message.boundary_id,
    thread_id: message.thread_id,
    conversation_type: message.conversation_type,
    sender_id: message.sender_id,
    sender_name: message.sender_name,
    sent_at: message.sent_at,
    message_ts: message.message_ts,
    channel_id: channelId(message),
    edited_at: message.edited_at,
    source: message.source,
    ingested_at: message.ingested_at,
  };

  delete nextMetadata[DELIVERY_METADATA_KEY];
  delete nextMetadata[PENDING_DELIVERY_METADATA_KEY];
  delete nextMetadata[PENDING_OUTCOME_METADATA_KEY];
  if (state.delivery) nextMetadata[DELIVERY_METADATA_KEY] = state.delivery;
  if (state.pending) nextMetadata[PENDING_DELIVERY_METADATA_KEY] = state.pending;
  if (state.outcome) nextMetadata[PENDING_OUTCOME_METADATA_KEY] = state.outcome;

  return {
    id: message.message_key,
    role: 'user',
    createdAt: new Date(message.sent_at),
    threadId: message.thread_id,
    resourceId: message.boundary_id,
    content: {
      format: 2,
      parts: [{ type: 'text', text: message.text }],
      metadata: nextMetadata,
    },
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError('Writer limits must be positive integers.');
  }
  return resolved;
}

export class MastraMemoryWriter {
  readonly #memory: GistMemory;
  readonly #storage: LibSQLStore;
  readonly #batchSize: number;
  readonly #maxAttempts: number;

  constructor({
    memory,
    storage,
    batchSize,
    maxAttempts,
  }: MastraMemoryWriterOptions) {
    this.#memory = memory;
    this.#storage = storage;
    this.#batchSize = positiveInteger(batchSize, DEFAULT_BATCH_SIZE);
    this.#maxAttempts = positiveInteger(maxAttempts, DEFAULT_MAX_ATTEMPTS);
  }

  async write(records: readonly ArchiveWriterRecord[]): Promise<ArchiveWriterResult> {
    const writer: MutableCounts = { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
    const embeddings = { written: 0, unchanged: 0, failed: 0 };
    const failures: ArchiveWriterFailure[] = [];

    const store = await this.#storage.getStore('memory');
    if (!store || !this.#memory.vector || !this.#memory.embedder) {
      throw new Error('Mastra memory writer dependencies are unavailable.');
    }

    for (let offset = 0; offset < records.length; offset += this.#batchSize) {
      const batch = records.slice(offset, offset + this.#batchSize);
      for (let index = 0; index < batch.length; index += 1) {
        const recordIndex = offset + index;
        const result = await this.#writeWithRetry(store, batch[index]!);
        if ('outcome' in result) {
          writer[result.outcome] += 1;
          if (result.outcome === 'unchanged') embeddings.unchanged += 1;
          else embeddings.written += 1;
        } else {
          writer.failed += 1;
          embeddings.failed += 1;
          failures.push({
            record_index: recordIndex,
            reason: 'writer_failed',
            retryable: result.retryable,
          });
        }
      }
      await this.#memory.settled();
    }

    return {
      accepted: writer.inserted + writer.updated + writer.unchanged,
      rejected: writer.failed,
      writer,
      embeddings,
      failures,
    };
  }

  async #writeWithRetry(
    store: MemoryStorage,
    record: ArchiveWriterRecord,
  ): Promise<{ outcome: ArchiveWriteOutcome } | { retryable: boolean }> {
    try {
      validateRecord(record);
    } catch (error) {
      if (error instanceof InvalidWriterRecordError) return { retryable: false };
      throw error;
    }

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return { outcome: await this.#writeRecord(store, record) };
      } catch {
        if (attempt === this.#maxAttempts) return { retryable: true };
      }
    }
    return { retryable: true };
  }

  async #writeRecord(
    store: MemoryStorage,
    record: ArchiveWriterRecord,
  ): Promise<ArchiveWriteOutcome> {
    const message = record.message;
    const existing = (await store.listMessagesById({ messageIds: [message.message_key] }))
      .messages[0];
    const existingMetadata = existing ? metadata(existing) : {};
    const completedDelivery = existingMetadata[DELIVERY_METADATA_KEY];
    const pendingDelivery = existingMetadata[PENDING_DELIVERY_METADATA_KEY];
    const pendingOutcome = existingMetadata[PENDING_OUTCOME_METADATA_KEY];
    const matches = existing ? canonicalMatches(existing, message) : false;

    if (completedDelivery === record.delivery_key && !pendingDelivery) {
      if (!matches) invalidRecord();
      return 'unchanged';
    }

    if (matches && !pendingDelivery) {
      await store.saveMessages({
        messages: [withCompletedDelivery(existing!, record.delivery_key)],
      });
      return 'unchanged';
    }

    const outcome =
      pendingOutcome === 'inserted' || pendingOutcome === 'updated'
        ? pendingOutcome
        : existing
          ? 'updated'
          : 'inserted';

    const thread = await this.#memory.getThreadById({ threadId: message.thread_id });
    if (thread && thread.resourceId !== message.boundary_id) invalidRecord();
    if (!thread) {
      await this.#memory.createThread({
        threadId: message.thread_id,
        resourceId: message.boundary_id,
        saveThread: true,
      });
    }

    const embedding = await this.#memory.embedder!.doEmbed({
      values: [message.text],
    });
    const vector = embedding.embeddings[0];
    if (!vector || vector.length !== GIST_EMBEDDING_DIMENSIONS) {
      throw new Error('Embedding dimension mismatch.');
    }

    let mutationStarted = false;
    try {
      await store.saveMessages({
        messages: [
          toMastraMessage(
            record,
            { pending: record.delivery_key, outcome },
            existingMetadata,
          ),
        ],
      });
      mutationStarted = true;

      await this.#memory.vector!.createIndex({
        indexName: MESSAGE_INDEX,
        dimension: GIST_EMBEDDING_DIMENSIONS,
      });
      await this.#memory.vector!.deleteVectors({
        indexName: MESSAGE_INDEX,
        filter: { message_id: message.message_key },
      });
      await this.#memory.vector!.upsert({
        indexName: MESSAGE_INDEX,
        ids: [message.message_key],
        vectors: [vector],
        metadata: [{
          message_id: message.message_key,
          thread_id: message.thread_id,
          resource_id: message.boundary_id,
          boundary_id: message.boundary_id,
          role: 'user',
          content: message.text,
          created_at: message.sent_at,
          model: GIST_EMBEDDING_MODEL,
          embedded_at: message.ingested_at,
        }],
      });

      await store.saveMessages({
        messages: [
          toMastraMessage(
            record,
            { delivery: record.delivery_key },
            existingMetadata,
          ),
        ],
      });
      return outcome;
    } catch (error) {
      if (mutationStarted) await this.#rollback(store, message.message_key, existing);
      throw error;
    }
  }

  async #rollback(
    store: MemoryStorage,
    messageKey: MessageKey,
    existing: MastraDBMessage | undefined,
  ): Promise<void> {
    try {
      if ((await this.#memory.vector!.listIndexes()).includes(MESSAGE_INDEX)) {
        await this.#memory.vector!.deleteVectors({
          indexName: MESSAGE_INDEX,
          filter: { message_id: messageKey },
        });
      }
    } catch {
      // A later retry replaces the deterministic vector ID.
    }

    try {
      if (existing) await store.saveMessages({ messages: [existing] });
      else await store.deleteMessages([messageKey]);
    } catch {
      // Pending metadata lets a later retry resume after failed compensation.
    }
  }
}
