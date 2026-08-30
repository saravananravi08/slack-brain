import type { MastraDBMessage } from '@mastra/core/agent';
import type { MemoryStorage } from '@mastra/core/storage';
import type { LibSQLStore } from '@mastra/libsql';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  type GistMemory,
} from '../../mastra/memory/gist-memory.js';
import type { BoundaryId, MessageKey } from '../../mastra/memory/resource-policy.js';
import type { DeleteResult, MutationStorage } from './types.js';

const MESSAGE_INDEX = 'memory_messages';
const TOMBSTONES_METADATA_KEY = 'gist_message_tombstones';
/**
 * Marks a row whose embedding has not yet been brought in line with its text.
 *
 * Mirrors `live_persistence_pending` in `ambient-persistence.ts`: an interrupted
 * mutation is repairable because the row itself says it is unfinished, rather
 * than leaving a mismatch nothing can detect (design review F-02).
 */
const MUTATION_PENDING_METADATA_KEY = 'gist_mutation_pending';

type Tombstones = Readonly<Record<string, string>>;

export interface MastraMutationStorageOptions {
  readonly memory: GistMemory;
  readonly storage: LibSQLStore;
}

function textOf(message: MastraDBMessage): string {
  if (typeof message.content.content === 'string') return message.content.content;
  return message.content.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function tombstonesFrom(value: unknown): Tombstones {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    ([key, deletedAt]) => key.length > 0 && typeof deletedAt === 'string',
  );
  return Object.fromEntries(entries);
}

function metadataOf(message: MastraDBMessage): Record<string, unknown> {
  return message.content.metadata ?? {};
}

function newerOrEqual(existing: unknown, candidate: string): boolean {
  return typeof existing === 'string' && Date.parse(existing) >= Date.parse(candidate);
}

export class MastraMutationStorage implements MutationStorage {
  readonly #memory: GistMemory;
  readonly #storage: LibSQLStore;
  #pendingMutation: Promise<void> = Promise.resolve();

  constructor({ memory, storage }: MastraMutationStorageOptions) {
    this.#memory = memory;
    this.#storage = storage;
  }

  async editMessage(
    messageKey: MessageKey,
    newText: string,
    editedAt: string,
  ): Promise<'updated' | 'unchanged'> {
    return this.#exclusive(async () => {
      const store = await this.#memoryStore();
      const existing = await this.#message(store, messageKey);
      if (!existing) return 'unchanged';
      const metadata = metadataOf(existing);
      if (newerOrEqual(metadata.edited_at, editedAt)) return 'unchanged';

      const oldText = textOf(existing);
      const [newVector, oldVector] = await Promise.all([
        this.#embed(newText),
        this.#embed(oldText),
      ]);

      // Written before the embedding is replaced, so a crash in between leaves
      // a row that announces its own inconsistency. `reconcileTombstones`
      // re-embeds it; without the marker the stale pre-edit embedding would
      // survive undetected, which slack-event.md §4 forbids outright.
      const pending = this.#withMetadata(existing, newText, {
        ...metadata,
        edited_at: editedAt,
        [MUTATION_PENDING_METADATA_KEY]: true,
      });
      const updated = this.#withMetadata(existing, newText, {
        ...metadata,
        edited_at: editedAt,
      });

      await store.saveMessages({ messages: [pending] });
      try {
        await this.#replaceVector(updated, newText, newVector, editedAt);
        await store.saveMessages({ messages: [updated] });
      } catch (error) {
        await store.saveMessages({ messages: [existing] });
        await this.#replaceVector(existing, oldText, oldVector, editedAt);
        throw error;
      }
      return 'updated';
    });
  }

  async deleteMessages(
    keys: readonly MessageKey[],
    deletedAt: string,
  ): Promise<DeleteResult> {
    return this.#exclusive(async () => {
      const deleted: MessageKey[] = [];
      const tombstoned: MessageKey[] = [];
      const missing: MessageKey[] = [];
      let embeddingsDeleted = 0;

      for (const key of [...new Set(keys)]) {
        const store = await this.#memoryStore();
        const existing = await this.#message(store, key);
        if (!existing) {
          missing.push(key);
          continue;
        }
        if (!existing.resourceId) throw new Error('Stored message has no resource boundary.');
        const boundaryId = existing.resourceId as BoundaryId;
        const resource = await store.getResourceById({ resourceId: boundaryId });
        const priorTombstones = tombstonesFrom(resource?.metadata?.[TOMBSTONES_METADATA_KEY]);
        const nextTombstones = { ...priorTombstones, [key]: deletedAt };

        await store.updateResource({
          resourceId: boundaryId,
          metadata: { [TOMBSTONES_METADATA_KEY]: nextTombstones },
        });

        try {
          // Embedding first, row second. The reverse order leaves a window in
          // which the message row is gone but its text is still in the vector
          // index, where semantic recall would surface content the user just
          // deleted (design review F-02). This way the surviving artefact is
          // the row, which the tombstone already covers and which
          // `reconcileTombstones` finishes.
          embeddingsDeleted += await this.#deleteVector(key);
          await store.deleteMessages([key]);
        } catch (error) {
          // The tombstone is deliberately NOT rolled back: it records the
          // user's intent, `shouldSuppressOriginal` keeps the message from
          // being re-ingested meanwhile, and reconciliation uses it to finish
          // the job. Rolling it back would lose the only trace of the request.
          await store.saveMessages({ messages: [existing] });
          throw error;
        }

        deleted.push(key);
        tombstoned.push(key);
      }

      return {
        deleted: deleted.length,
        embeddings_deleted: embeddingsDeleted,
        tombstoned,
        missing,
      };
    });
  }

  async isTombstoned(boundaryId: BoundaryId, messageKey: MessageKey): Promise<boolean> {
    const store = await this.#memoryStore();
    const resource = await store.getResourceById({ resourceId: boundaryId });
    const tombstones = tombstonesFrom(resource?.metadata?.[TOMBSTONES_METADATA_KEY]);
    return Object.hasOwn(tombstones, messageKey);
  }

  async *listMessageBatches(): AsyncIterable<readonly MastraDBMessage[]> {
    yield* this.#messageBatches(await this.#memoryStore());
  }

  /**
   * Finish mutations interrupted between their vector and row writes.
   *
   * Two repairs, both idempotent and both safe to run at any time:
   *
   *  1. **Tombstoned keys whose row or embedding survived.** The tombstone is
   *     written before anything is removed, so it is the durable record that a
   *     delete was requested; anything still present under a tombstoned key is
   *     an unfinished delete.
   *  2. **Rows still marked mid-edit.** Their embedding is rebuilt from the
   *     text the row currently holds, which is the value the edit committed.
   *
   * Returns the number of repairs performed, so a sweep can report a non-zero
   * count instead of healing silently.
   */
  async reconcileTombstones(): Promise<number> {
    return this.#exclusive(async () => {
      const store = await this.#memoryStore();
      let repaired = 0;

      for (const boundaryId of await this.#boundaries(store)) {
        const resource = await store.getResourceById({ resourceId: boundaryId });
        const tombstones = tombstonesFrom(resource?.metadata?.[TOMBSTONES_METADATA_KEY]);
        for (const key of Object.keys(tombstones) as MessageKey[]) {
          const removedVectors = await this.#deleteVector(key);
          const existing = await this.#message(store, key);
          if (existing) await store.deleteMessages([key]);
          if (existing || removedVectors > 0) repaired += 1;
        }
      }

      for await (const messages of this.#messageBatches(store)) {
        for (const message of messages) {
          const metadata = metadataOf(message);
          if (metadata[MUTATION_PENDING_METADATA_KEY] !== true) continue;

          const text = textOf(message);
          const editedAt = typeof metadata.edited_at === 'string'
            ? metadata.edited_at
            : message.createdAt.toISOString();
          const { [MUTATION_PENDING_METADATA_KEY]: _pending, ...settled } = metadata;
          const repairedMessage = this.#withMetadata(message, text, settled);

          await this.#replaceVector(repairedMessage, text, await this.#embed(text), editedAt);
          await store.saveMessages({ messages: [repairedMessage] });
          repaired += 1;
        }
      }

      return repaired;
    });
  }

  #withMetadata(
    message: MastraDBMessage,
    text: string,
    metadata: Record<string, unknown>,
  ): MastraDBMessage {
    return {
      ...message,
      content: {
        format: 2,
        parts: [{ type: 'text', text }],
        metadata,
      },
    };
  }

  /** Remove a message's embedding. Idempotent; returns how many rows went. */
  async #deleteVector(key: MessageKey): Promise<number> {
    const indexExists = (await this.#memory.vector!.listIndexes()).includes(MESSAGE_INDEX);
    if (!indexExists) return 0;

    const before = await this.#memory.vector!.describeIndex({ indexName: MESSAGE_INDEX });
    await this.#memory.vector!.deleteVectors({
      indexName: MESSAGE_INDEX,
      filter: { message_id: key },
    });
    const after = await this.#memory.vector!.describeIndex({ indexName: MESSAGE_INDEX });
    return Math.max(0, before.count - after.count);
  }

  async #boundaries(store: MemoryStorage): Promise<readonly string[]> {
    const threads = await store.listThreads({ perPage: false });
    const boundaries = new Set<string>();
    for (const thread of threads.threads) {
      if (thread.resourceId) boundaries.add(thread.resourceId);
    }
    return [...boundaries];
  }

  async *#messageBatches(
    store: MemoryStorage,
  ): AsyncIterable<readonly MastraDBMessage[]> {
    const threads = await store.listThreads({ perPage: false });
    for (const thread of threads.threads) {
      const page = await store.listMessages({ threadId: thread.id, perPage: false });
      yield page.messages;
    }
  }

  async #memoryStore(): Promise<MemoryStorage> {
    const store = await this.#storage.getStore('memory');
    if (!store || !this.#memory.vector || !this.#memory.embedder) {
      throw new Error('Mastra mutation storage dependencies are unavailable.');
    }
    return store;
  }

  async #message(store: MemoryStorage, key: MessageKey): Promise<MastraDBMessage | undefined> {
    return (await store.listMessagesById({ messageIds: [key] })).messages[0];
  }

  async #embed(text: string): Promise<number[]> {
    const result = await this.#memory.embedder!.doEmbed({ values: [text] });
    const vector = result.embeddings[0];
    if (!vector || vector.length !== GIST_EMBEDDING_DIMENSIONS) {
      throw new Error('Embedding dimension mismatch.');
    }
    return vector;
  }

  async #replaceVector(
    message: MastraDBMessage,
    text: string,
    vector: number[],
    embeddedAt: string,
  ): Promise<void> {
    await this.#memory.vector!.createIndex({
      indexName: MESSAGE_INDEX,
      dimension: GIST_EMBEDDING_DIMENSIONS,
    });
    await this.#memory.vector!.deleteVectors({
      indexName: MESSAGE_INDEX,
      filter: { message_id: message.id },
    });
    await this.#memory.vector!.upsert({
      indexName: MESSAGE_INDEX,
      ids: [message.id],
      vectors: [vector],
      metadata: [
        {
          message_id: message.id,
          thread_id: message.threadId,
          resource_id: message.resourceId,
          boundary_id: message.resourceId,
          role: message.role,
          content: text,
          created_at: message.createdAt.toISOString(),
          model: GIST_EMBEDDING_MODEL,
          embedded_at: embeddedAt,
        },
      ],
    });
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#pendingMutation;
    let release!: () => void;
    this.#pendingMutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
