import { LibSQLVector, type LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

export const GIST_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const GIST_EMBEDDING_DIMENSIONS = 1_536;

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

export interface CreateGistMemoryOptions {
  readonly storage: LibSQLStore;
  readonly databaseUrl: string;
  readonly embeddingModel: string;
}

export function createGistMemory({
  storage,
  databaseUrl,
  embeddingModel,
}: CreateGistMemoryOptions): Memory {
  if (embeddingModel !== GIST_EMBEDDING_MODEL) {
    throw new Error(`Gist memory requires ${GIST_EMBEDDING_MODEL}.`);
  }

  return new Memory({
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
