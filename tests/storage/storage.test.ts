import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SpanType } from '@mastra/core/observability';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  STORAGE_RETENTION,
  StorageUnavailableError,
  createMastraStorage,
  defaultDatabaseUrl,
} from '../../src/mastra/storage/index.js';
import {
  TRACE_ERROR_MESSAGE,
  TraceErrorRedactor,
  createGistObservability,
} from '../../src/mastra/storage/observability.js';

interface StorageFixture {
  contract_version: string;
  records: Array<{
    name: string;
    record: {
      boundary_id: string;
      thread_id: string;
    };
  }>;
  retention_classes: Array<{
    store?: string;
    retention_days?: number;
  }>;
}

const fixture = JSON.parse(
  await readFile(
    new URL('../../docs/architecture/contracts/fixtures/storage.v1.json', import.meta.url),
    'utf8',
  ),
) as StorageFixture;

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gist-storage-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Mastra storage', () => {
  it('uses an absolute default file URL outside the repository', async () => {
    const dataHome = await makeTemporaryDirectory();
    const url = defaultDatabaseUrl({ XDG_DATA_HOME: dataHome });
    const databasePath = new URL(url).pathname;

    expect(url).toMatch(/^file:\/\//);
    expect(relative(process.cwd(), databasePath)).toMatch(/^\.\./);
  });

  it('rejects relative, in-repository, and unavailable file locations without exposing them', async () => {
    expect(() => createMastraStorage({ databaseUrl: 'file:./private-token.db' })).toThrow(
      StorageUnavailableError,
    );

    const trackedPath = join(process.cwd(), 'private-token.db');
    expect(() =>
      createMastraStorage({ databaseUrl: pathToFileURL(trackedPath).href }),
    ).toThrow(StorageUnavailableError);

    const directory = await makeTemporaryDirectory();
    const blockingFile = join(directory, 'not-a-directory');
    await writeFile(blockingFile, 'synthetic');

    let thrown: unknown;
    try {
      createMastraStorage({
        databaseUrl: pathToFileURL(join(blockingFile, 'private-token.db')).href,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StorageUnavailableError);
    expect(String(thrown)).toBe('StorageUnavailableError: Persistent storage is unavailable.');
    expect(String(thrown)).not.toContain('private-token.db');
  });

  it('accepts managed libSQL URLs but rejects insecure or embedded credentials', async () => {
    const remote = createMastraStorage({
      databaseUrl: 'libsql://synthetic.invalid',
      authToken: 'SYNTHETIC_AUTH_VALUE',
    });
    expect(remote).toBeInstanceOf(LibSQLStore);
    await remote.close();

    expect(() =>
      createMastraStorage({ databaseUrl: 'http://synthetic.invalid' }),
    ).toThrow(StorageUnavailableError);
    expect(() =>
      createMastraStorage({
        databaseUrl: 'libsql://user:SYNTHETIC_AUTH_VALUE@synthetic.invalid',
      }),
    ).toThrow(StorageUnavailableError);
  });

  it('sanitizes database initialization failures', async () => {
    const directory = await makeTemporaryDirectory();
    const storage = createMastraStorage({
      databaseUrl: pathToFileURL(join(directory, 'closed-before-init.db')).href,
    });
    await storage.close();

    await expect(storage.init()).rejects.toEqual(
      expect.objectContaining({
        name: 'StorageUnavailableError',
        message: 'Persistent storage is unavailable.',
        code: 'storage_unavailable',
      }),
    );
  });

  it('preserves state after close and reopen using the frozen storage fixture', async () => {
    expect(fixture.contract_version).toBe('1.0.0');
    const fixtureRecord = fixture.records.find(
      ({ name }) => name === 'valid_channel_record',
    )?.record;
    expect(fixtureRecord).toBeDefined();
    if (!fixtureRecord) return;

    const directory = await makeTemporaryDirectory();
    const databaseUrl = pathToFileURL(join(directory, 'mastra.db')).href;
    const first = createMastraStorage({ databaseUrl });
    expect(first).toBeInstanceOf(LibSQLStore);

    await first.init();
    const firstMemory = await first.getStore('memory');
    expect(firstMemory).toBeDefined();
    await firstMemory?.saveThread({
      thread: {
        id: fixtureRecord.thread_id,
        title: 'Synthetic channel thread',
        resourceId: fixtureRecord.boundary_id,
        createdAt: new Date('2025-01-01T00:03:20.000Z'),
        updatedAt: new Date('2025-01-01T00:03:20.000Z'),
      },
    });
    await first.close();

    const reopened = createMastraStorage({ databaseUrl });
    await reopened.init();
    const reopenedMemory = await reopened.getStore('memory');
    const thread = await reopenedMemory?.getThreadById({
      threadId: fixtureRecord.thread_id,
    });

    expect(thread?.resourceId).toBe(fixtureRecord.boundary_id);
    await reopened.close();
  });
});

describe('Mastra observability', () => {
  it('persists traces while removing error bodies, stacks, and token values', async () => {
    const directory = await makeTemporaryDirectory();
    const storage = createMastraStorage({
      databaseUrl: pathToFileURL(join(directory, 'traces.db')).href,
    });
    const observability = createGistObservability();
    const mastra = new Mastra({
      storage,
      observability,
      loggerOptions: { export: false },
    });

    const instance = observability.getDefaultInstance();
    expect(instance).toBeDefined();
    expect(instance?.getExporters()[0]).toBeInstanceOf(MastraStorageExporter);
    expect(instance?.getSpanOutputProcessors()).toEqual([
      expect.any(TraceErrorRedactor),
      expect.any(SensitiveDataFilter),
    ]);
    if (!instance) return;

    const privateBody = 'SYNTHETIC_PRIVATE_MESSAGE_BODY';
    const tokenValue = 'SYNTHETIC_TOKEN_VALUE';
    const span = instance.startSpan({
      type: SpanType.GENERIC,
      name: 'synthetic storage failure',
      input: { authorization: tokenValue, text: privateBody },
    });
    span.error({
      error: new Error(`${privateBody} ${tokenValue}`),
      endSpan: true,
    });
    await observability.flush();

    const traceStore = await storage.getStore('observability');
    const trace = await traceStore?.getTrace({ traceId: span.traceId });
    const serialized = JSON.stringify(trace);
    const serializedError = JSON.stringify(trace?.spans[0]?.error);

    expect(trace?.spans[0]?.error).toEqual({
      message: TRACE_ERROR_MESSAGE,
      name: 'Error',
    });
    expect(trace?.spans[0]?.input).toMatchObject({ authorization: '[REDACTED]' });
    expect(serializedError).not.toContain(privateBody);
    expect(serializedError).not.toContain(tokenValue);
    expect(serializedError).not.toContain('storage.test.ts');
    expect(serialized).not.toContain(tokenValue);

    await mastra.shutdown();
  });

  it('prunes traces after the contract retention window and keeps current traces', async () => {
    const traceRetention = fixture.retention_classes.find(
      ({ store }) => store === 'trace',
    )?.retention_days;
    expect(traceRetention).toBe(30);
    expect(STORAGE_RETENTION.observability?.spans?.maxAge).toBe(
      `${traceRetention}d`,
    );

    const directory = await makeTemporaryDirectory();
    const storage = createMastraStorage({
      databaseUrl: pathToFileURL(join(directory, 'retention.db')).href,
    });
    const observability = createGistObservability();
    const mastra = new Mastra({ storage, observability });
    const instance = observability.getDefaultInstance();
    expect(instance).toBeDefined();
    if (!instance) return;

    const expired = instance.startSpan({
      type: SpanType.GENERIC,
      name: 'expired synthetic trace',
      startTime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
    });
    expired.end();
    const current = instance.startSpan({
      type: SpanType.GENERIC,
      name: 'current synthetic trace',
    });
    current.end();
    await observability.flush();

    const traceStore = await storage.getStore('observability');
    expect(await traceStore?.getTrace({ traceId: expired.traceId })).not.toBeNull();
    expect(await traceStore?.getTrace({ traceId: current.traceId })).not.toBeNull();

    const results = await storage.prune();

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'observability', deleted: 1, done: true }),
      ]),
    );
    expect(await traceStore?.getTrace({ traceId: expired.traceId })).toBeNull();
    expect(await traceStore?.getTrace({ traceId: current.traceId })).not.toBeNull();

    await mastra.shutdown();
  });

  it('registers storage and observability on the initial Mastra instance', async () => {
    const directory = await makeTemporaryDirectory();
    vi.stubEnv(
      'MASTRA_DATABASE_URL',
      pathToFileURL(join(directory, 'registered.db')).href,
    );

    const { mastra, observability, storage } = await import('../../src/mastra/index.js');

    expect(mastra.getStorage()).toBeDefined();
    expect(await mastra.getStorage()?.getStore('observability')).toBeDefined();
    expect(mastra.observability).toBe(observability);
    await mastra.shutdown();
  });
});
