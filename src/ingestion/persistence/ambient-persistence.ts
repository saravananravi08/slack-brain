import type { MastraDBMessage } from '@mastra/core/agent';
import type { MemoryStorage } from '@mastra/core/storage';
import type { LibSQLStore } from '@mastra/libsql';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  type GistMemory,
} from '../../mastra/memory/gist-memory.js';
import {
  messageKey,
  type MessageKey,
  type ResourceIdentity,
} from '../../mastra/memory/resource-policy.js';
import type {
  AuthorizationEvent,
  DenyReason,
} from '../../security/types.js';

const MESSAGE_INDEX = 'memory_messages';
const PENDING_METADATA_KEY = 'live_persistence_pending';
const DEFAULT_MAX_ATTEMPTS = 3;

export interface AmbientNormalizedEvent extends AuthorizationEvent {
  readonly contract_version: '1.0.0';
  readonly class: 'ambient' | 'addressed';
  readonly message_ts: string;
  readonly event_id: string;
  readonly thread_ts: string | null;
  readonly sent_at: string;
  readonly text: string;
  readonly addressed_to_gist: boolean;
}

export interface AmbientPersistenceInput {
  readonly event: AmbientNormalizedEvent;
  /** Resolved at ingestion time so historical citations remain attributable. */
  readonly sender_name: string;
}

export interface WriteAuthorizationRequest {
  readonly gate: 'write_memory';
  readonly event: AmbientNormalizedEvent;
  readonly identity: ResourceIdentity;
}

export interface WriteAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: DenyReason | null;
}

export type WriteAuthorizer = (
  request: WriteAuthorizationRequest,
) => Promise<WriteAuthorizationDecision> | WriteAuthorizationDecision;

export type AmbientPersistenceResult =
  | { readonly outcome: 'inserted' | 'unchanged' }
  | {
      readonly outcome: 'skipped';
      readonly reason: 'invalid_event' | DenyReason;
    }
  | {
      readonly outcome: 'failed';
      readonly reason: 'persistence_failed' | 'content_conflict';
      readonly retryable: boolean;
    };

export interface AmbientPersistenceOptions {
  readonly memory: GistMemory;
  readonly storage: LibSQLStore;
  readonly resolveIdentity: (event: AmbientNormalizedEvent) => ResourceIdentity;
  readonly authorizeWrite: WriteAuthorizer;
  readonly now?: () => Date;
  readonly maxAttempts?: number;
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

function isValidInput(input: AmbientPersistenceInput): boolean {
  const { event, sender_name: senderName } = input;
  return (
    event?.contract_version === '1.0.0' &&
    ((event.class === 'ambient' && event.addressed_to_gist === false) ||
      (event.class === 'addressed' && event.addressed_to_gist === true)) &&
    event.conversation_type === 'channel' &&
    event.sender_type === 'human' &&
    event.text.trim() !== '' &&
    senderName.trim() !== '' &&
    /^\d+\.\d+$/.test(event.message_ts) &&
    !Number.isNaN(Date.parse(event.sent_at))
  );
}

function canonicalMatches(
  existing: MastraDBMessage,
  input: AmbientPersistenceInput,
  identity: ResourceIdentity,
  key: MessageKey,
): boolean {
  const { event, sender_name: senderName } = input;
  const existingMetadata = metadata(existing);
  return (
    existing.id === key &&
    existing.resourceId === identity.resource_id &&
    existing.threadId === identity.thread_id &&
    existing.createdAt.toISOString() === event.sent_at &&
    messageText(existing) === event.text &&
    existingMetadata.contract_version === event.contract_version &&
    existingMetadata.message_key === key &&
    existingMetadata.boundary_id === identity.boundary_id &&
    existingMetadata.thread_id === identity.thread_id &&
    existingMetadata.conversation_type === event.conversation_type &&
    existingMetadata.sender_id === event.sender_id &&
    existingMetadata.sender_name === senderName &&
    existingMetadata.sent_at === event.sent_at &&
    existingMetadata.message_ts === event.message_ts &&
    existingMetadata.edited_at === null
  );
}

function toMastraMessage(
  input: AmbientPersistenceInput,
  identity: ResourceIdentity,
  key: MessageKey,
  ingestedAt: string,
  pending: boolean,
): MastraDBMessage {
  const { event, sender_name: senderName } = input;
  return {
    id: key,
    role: 'user',
    createdAt: new Date(event.sent_at),
    threadId: identity.thread_id,
    resourceId: identity.resource_id,
    content: {
      format: 2,
      parts: [{ type: 'text', text: event.text }],
      metadata: {
        contract_version: event.contract_version,
        message_key: key,
        boundary_id: identity.boundary_id,
        thread_id: identity.thread_id,
        conversation_type: event.conversation_type,
        sender_id: event.sender_id,
        sender_name: senderName,
        sent_at: event.sent_at,
        message_ts: event.message_ts,
        channel_id: event.channel_id,
        edited_at: null,
        source: 'live',
        ingested_at: ingestedAt,
        ...(pending ? { [PENDING_METADATA_KEY]: true } : {}),
      },
    },
  };
}

function positiveInteger(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError('maxAttempts must be a positive integer.');
  }
  return resolved;
}

export class AmbientPersistenceService {
  readonly #memory: GistMemory;
  readonly #storage: LibSQLStore;
  readonly #resolveIdentity: AmbientPersistenceOptions['resolveIdentity'];
  readonly #authorizeWrite: WriteAuthorizer;
  readonly #now: () => Date;
  readonly #maxAttempts: number;

  constructor({
    memory,
    storage,
    resolveIdentity,
    authorizeWrite,
    now = () => new Date(),
    maxAttempts,
  }: AmbientPersistenceOptions) {
    this.#memory = memory;
    this.#storage = storage;
    this.#resolveIdentity = resolveIdentity;
    this.#authorizeWrite = authorizeWrite;
    this.#now = now;
    this.#maxAttempts = positiveInteger(maxAttempts);
  }

  async persist(input: AmbientPersistenceInput): Promise<AmbientPersistenceResult> {
    if (!isValidInput(input)) return { outcome: 'skipped', reason: 'invalid_event' };

    let identity: ResourceIdentity;
    let key: MessageKey;
    try {
      identity = this.#resolveIdentity(input.event);
      key = messageKey(input.event);
    } catch {
      return { outcome: 'skipped', reason: 'identity_unresolved' };
    }

    const decision = await this.#authorizeWrite({
      gate: 'write_memory',
      event: input.event,
      identity,
    });
    if (!decision.allowed) {
      return {
        outcome: 'skipped',
        reason: decision.reason ?? 'malformed_request',
      };
    }

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const store = await this.#storage.getStore('memory');
        if (!store || !this.#memory.vector || !this.#memory.embedder) {
          throw new Error('Persistence dependencies unavailable.');
        }
        const outcome = await this.#persistAllowed(store, input, identity, key);
        await this.#memory.settled();
        return outcome;
      } catch {
        if (attempt === this.#maxAttempts) {
          return {
            outcome: 'failed',
            reason: 'persistence_failed',
            retryable: true,
          };
        }
      }
    }

    return { outcome: 'failed', reason: 'persistence_failed', retryable: true };
  }

  async #persistAllowed(
    store: MemoryStorage,
    input: AmbientPersistenceInput,
    identity: ResourceIdentity,
    key: MessageKey,
  ): Promise<AmbientPersistenceResult> {
    const existing = (await store.listMessagesById({ messageIds: [key] })).messages[0];
    const matches = existing ? canonicalMatches(existing, input, identity, key) : false;
    const pending = existing ? metadata(existing)[PENDING_METADATA_KEY] === true : false;

    if (existing && matches && !pending) return { outcome: 'unchanged' };
    if (existing && !matches) {
      return { outcome: 'failed', reason: 'content_conflict', retryable: false };
    }

    const thread = await this.#memory.getThreadById({ threadId: identity.thread_id });
    if (thread && thread.resourceId !== identity.resource_id) {
      return { outcome: 'failed', reason: 'content_conflict', retryable: false };
    }
    if (!thread) {
      await this.#memory.createThread({
        threadId: identity.thread_id,
        resourceId: identity.resource_id,
        saveThread: true,
      });
    }

    const embedding = await this.#memory.embedder!.doEmbed({ values: [input.event.text] });
    const vector = embedding.embeddings[0];
    if (!vector || vector.length !== GIST_EMBEDDING_DIMENSIONS) {
      throw new Error('Embedding dimension mismatch.');
    }

    const ingestedAt = existing
      ? String(metadata(existing).ingested_at)
      : this.#now().toISOString();
    const pendingMessage = toMastraMessage(input, identity, key, ingestedAt, true);
    const completedMessage = toMastraMessage(input, identity, key, ingestedAt, false);
    let mutationStarted = false;

    try {
      await store.saveMessages({ messages: [pendingMessage] });
      mutationStarted = true;
      await this.#memory.vector!.createIndex({
        indexName: MESSAGE_INDEX,
        dimension: GIST_EMBEDDING_DIMENSIONS,
      });
      await this.#memory.vector!.deleteVectors({
        indexName: MESSAGE_INDEX,
        filter: { message_id: key },
      });
      await this.#memory.vector!.upsert({
        indexName: MESSAGE_INDEX,
        ids: [key],
        vectors: [vector],
        metadata: [{
          message_id: key,
          thread_id: identity.thread_id,
          resource_id: identity.resource_id,
          boundary_id: identity.boundary_id,
          role: 'user',
          content: input.event.text,
          created_at: input.event.sent_at,
          model: GIST_EMBEDDING_MODEL,
          embedded_at: ingestedAt,
        }],
      });
      await store.saveMessages({ messages: [completedMessage] });
      return { outcome: 'inserted' };
    } catch (error) {
      if (mutationStarted) await this.#rollback(store, key, existing);
      throw error;
    }
  }

  async #rollback(
    store: MemoryStorage,
    key: MessageKey,
    existing: MastraDBMessage | undefined,
  ): Promise<void> {
    try {
      if ((await this.#memory.vector!.listIndexes()).includes(MESSAGE_INDEX)) {
        await this.#memory.vector!.deleteVectors({
          indexName: MESSAGE_INDEX,
          filter: { message_id: key },
        });
      }
    } catch {
      // Deterministic vector ID is replaced by a later retry.
    }

    try {
      if (existing) await store.saveMessages({ messages: [existing] });
      else await store.deleteMessages([key]);
    } catch {
      // Pending metadata lets a later retry repair interrupted compensation.
    }
  }
}
