import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  GIST_MEMORY_DEFAULTS,
  createGistMemory,
} from '../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../src/mastra/storage/index.js';

interface StorageFixture {
  embedding: {
    record: {
      model: string;
      vector_length: number;
    };
  };
}

const fixture = JSON.parse(
  await readFile(
    new URL('../../docs/architecture/contracts/fixtures/storage.v1.json', import.meta.url),
    'utf8',
  ),
) as StorageFixture;

const temporaryDirectories: string[] = [];
const resources: Array<{
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

async function makeMemory() {
  const directory = await mkdtemp(join(tmpdir(), 'gist-memory-config-test-'));
  temporaryDirectories.push(directory);
  const databaseUrl = pathToFileURL(join(directory, 'mastra.db')).href;
  const storage = createMastraStorage({ databaseUrl });
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });

  expect(memory.vector).toBeInstanceOf(LibSQLVector);
  resources.push({ storage, vector: memory.vector as LibSQLVector });
  return memory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    resources.splice(0).map(async ({ storage, vector }) => {
      await vector.close();
      await storage.close();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Gist Mastra Memory configuration', () => {
  it('uses the frozen embedding model and vector dimension', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
    const memory = await makeMemory();

    expect(GIST_EMBEDDING_MODEL).toBe(fixture.embedding.record.model);
    expect(GIST_EMBEDDING_DIMENSIONS).toBe(fixture.embedding.record.vector_length);
    expect(memory.embedder).toMatchObject({
      provider: 'openai',
      modelId: 'text-embedding-3-small',
    });
    expect(memory.embedderOptions).toEqual({
      providerOptions: {
        openai: { dimensions: GIST_EMBEDDING_DIMENSIONS },
      },
    });
  });

  it('enables recent history and automatic resource-scoped semantic recall', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
    const memory = await makeMemory();

    expect(GIST_MEMORY_DEFAULTS).toEqual({
      lastMessages: 20,
      semanticRecall: {
        topK: 5,
        messageRange: 2,
        scope: 'resource',
      },
      workingMemory: { enabled: false },
      observationalMemory: false,
      generateTitle: false,
    });
    expect(memory.getMergedThreadConfig()).toMatchObject(GIST_MEMORY_DEFAULTS);
    expect(memory.listTools()).toEqual({});
  });

  it('uses a compatible 1536-dimensional libSQL vector index', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
    const memory = await makeMemory();
    const vector = memory.vector as LibSQLVector;

    await vector.createIndex({
      indexName: 'gist_config_compatibility',
      dimension: GIST_EMBEDDING_DIMENSIONS,
    });

    await expect(
      vector.describeIndex({ indexName: 'gist_config_compatibility' }),
    ).resolves.toMatchObject({ dimension: GIST_EMBEDDING_DIMENSIONS });
  });

  it('rejects an embedding model that would change corpus dimensions', async () => {
    const storage = new LibSQLStore({ id: 'rejected-model-test', url: 'file::memory:' });

    expect(() =>
      createGistMemory({
        storage,
        databaseUrl: 'file::memory:',
        embeddingModel: 'openai/text-embedding-3-large',
      }),
    ).toThrow(`Gist memory requires ${GIST_EMBEDDING_MODEL}.`);

    await storage.close();
  });
});
