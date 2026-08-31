import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GIST_EMBEDDING_MODEL,
  GIST_MEMORY_DEFAULTS,
  GIST_OBSERVATION_MEMORY_CONFIG,
  GIST_OBSERVATION_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';

const CHANNEL = 'ch:T0OBSERVE1:C0OBSERVEA';
const THREAD = 'slack:C0OBSERVEA:1767225600.000101';
const directories: string[] = [];
const resources: Array<{
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

async function makeMemory() {
  const directory = await mkdtemp(join(tmpdir(), 'gist-observation-memory-'));
  directories.push(directory);
  const databaseUrl = pathToFileURL(join(directory, 'memory.db')).href;
  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  resources.push({ storage, vector: memory.vector as LibSQLVector });
  return memory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(resources.splice(0).map(async ({ storage, vector }) => {
    await vector.close();
    await storage.close();
  }));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('Gist channel Observation Memory configuration', () => {
  it('uses supported resource scope with asynchronous caller scheduling', () => {
    expect(GIST_OBSERVATION_MODEL).toBe('openai/gpt-4.1-mini');
    expect(GIST_OBSERVATION_MEMORY_CONFIG).toMatchObject({
      model: GIST_OBSERVATION_MODEL,
      scope: 'resource',
      observation: {
        bufferTokens: false,
        continuationHints: false,
      },
      reflection: { continuationHints: false },
    });
    expect(GIST_OBSERVATION_MEMORY_CONFIG.observation.instruction).toContain(
      'decisions, ongoing work, unresolved questions, conventions, and outcomes',
    );
    expect(GIST_OBSERVATION_MEMORY_CONFIG.observation.instruction).toContain(
      'message_key, sender_class, sender_name, and sent_at',
    );

    // Built-in turn-driven OM stays disabled. Resource-scope model work is
    // scheduled by ChannelObservationMemory so it cannot block exact capture.
    expect(GIST_MEMORY_DEFAULTS.observationalMemory).toBe(false);
  });

  it('installs only the failure-isolated channel processor and fails closed off-channel', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
    const memory = await makeMemory();
    const processors = await memory.getInputProcessors();

    expect(processors.filter(({ id }) => id === 'channel-observational-memory')).toHaveLength(1);
    expect(processors.find(({ id }) => id === 'observational-memory')).toBeUndefined();
    await expect(memory.channelObservations.context(CHANNEL, THREAD)).resolves.toEqual({
      summary: null,
      observations: '',
    });
    await expect(memory.channelObservations.context('dm:U0OBSERVE1', THREAD)).resolves.toEqual({
      summary: null,
      observations: '',
    });
  });
});
