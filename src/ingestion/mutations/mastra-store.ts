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
      const updated: MastraDBMessage = {
        ...existing,
        content: {
          format: 2,
          parts: [{ type: 'text', text: newText }],
          metadata: { ...metadata, edited_at: editedAt },
        },
      };

      await store.saveMessages({ messages: [updated] });
      try {
        await this.#replaceVector(updated, newText, newVector, editedAt);
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
          await store.deleteMessages([key]);
          const indexExists = (await this.#memory.vector!.listIndexes()).includes(MESSAGE_INDEX);
          if (indexExists) {
            const before = await this.#memory.vector!.describeIndex({ indexName: MESSAGE_INDEX });
            await this.#memory.vector!.deleteVectors({
              indexName: MESSAGE_INDEX,
              filter: { message_id: key },
            });
            const after = await this.#memory.vector!.describeIndex({ indexName: MESSAGE_INDEX });
            embeddingsDeleted += Math.max(0, before.count - after.count);
          }
        } catch (error) {
          await store.saveMessages({ messages: [existing] });
          await store.updateResource({
            resourceId: boundaryId,
            metadata: { [TOMBSTONES_METADATA_KEY]: priorTombstones },
          });
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

  async listMessages(): Promise<readonly MastraDBMessage[]> {
    const store = await this.#memoryStore();
    const threads = await store.listThreads({ perPage: false });
    const messages = new Map<string, MastraDBMessage>();
    for (const thread of threads.threads) {
      const page = await store.listMessages({ threadId: thread.id, perPage: false });
      for (const message of page.messages) messages.set(message.id, message);
    }
    return [...messages.values()];
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
