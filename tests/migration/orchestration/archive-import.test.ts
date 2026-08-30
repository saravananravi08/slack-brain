import { readFile } from 'node:fs/promises';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { LibSQLVector } from '@mastra/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';
import {
  ArchiveImportError,
  MastraMemoryWriter,
  readArchiveImportCheckpoint,
  runArchiveImport,
  validateArchiveImportRequest,
  type ArchiveImportContext,
  type ArchiveImportWriter,
  type ArchiveWriterRecord,
  type ArchiveWriterResult,
} from '../../../src/migration/index.js';
import { main, parseArchiveImportCli } from '../../../scripts/import-slack.js';

type JsonRecord = Record<string, any>;

const fixture = JSON.parse(
  await readFile(
    new URL('../../fixtures/migration/source-records.v1.json', import.meta.url),
    'utf8',
  ),
) as JsonRecord;

const directories: string[] = [];
const resources: Array<{
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}> = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 't305-import-'));
  directories.push(directory);
  return directory;
}

function fixtureRows(...names: string[]): JsonRecord[] {
  return fixture.cases
    .filter(({ name }: JsonRecord) => names.includes(name))
    .flatMap(({ rows }: JsonRecord) => rows);
}

function createArchive(rows = fixtureRows('root_message', 'thread_reply', 'bot_message')): string {
  const path = join(temporaryDirectory(), 'synthetic-archive.db');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE users (
      id TEXT,
      name TEXT NOT NULL,
      real_name TEXT,
      display_name TEXT
    );
    CREATE TABLE messages (
      ts TEXT,
      channel_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      text TEXT NOT NULL,
      thread_ts TEXT,
      reply_count INTEGER DEFAULT 0,
      date TEXT NOT NULL,
      is_thread_reply INTEGER DEFAULT 0,
      raw_json TEXT
    );
  `);

  const users = new Map<string, JsonRecord>();
  for (const row of rows) {
    if (row.user !== null) users.set(row.user.id, row.user);
  }
  const insertUser = database.prepare(
    'INSERT INTO users (id, name, real_name, display_name) VALUES (?, ?, ?, ?)',
  );
  for (const user of users.values()) {
    insertUser.run(user.id, user.name, user.real_name, user.display_name);
  }

  const insertMessage = database.prepare(`
    INSERT INTO messages (
      ts, channel_id, user_id, user_name, text, thread_ts,
      reply_count, date, is_thread_reply, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insertMessage.run(
      row.ts,
      row.channel_id,
      row.user_id,
      row.user_name,
      row.text,
      row.thread_ts,
      row.reply_count,
      row.date,
      row.is_thread_reply,
      row.raw_json,
    );
  }
  database.close();
  return path;
}

function context(overrides: Partial<ArchiveImportContext> = {}): ArchiveImportContext {
  return {
    contract_version: '1.0.0',
    import_run_id: 'synthetic-run-001',
    source_snapshot_id: 'synthetic-snapshot-001',
    workspace_id: 'T0SYNTH01',
    approved_channel_ids: ['C0APPROVED1'],
    channel_aliases: { C0APPROVED1: 'synthetic-approved-one' },
    known_bot_sender_ids: ['B0SYNTH001'],
    started_at: '2025-02-01T00:00:00.000Z',
    ...overrides,
  };
}

async function makeWriter(destinationPath: string) {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const databaseUrl = pathToFileURL(destinationPath).href;
  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  vi.spyOn(memory.embedder!, 'doEmbed').mockImplementation(
    async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => {
        const vector = Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0);
        vector[0] = 1;
        return vector;
      }),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );
  const vector = memory.vector as LibSQLVector;
  resources.push({ memory, storage, vector });

  const countDestination = async (): Promise<number> => {
    const store = await storage.getStore('memory');
    const threads = await store!.listThreads({ perPage: false });
    if (threads.threads.length === 0) return 0;
    return (await store!.listMessages({
      threadId: threads.threads.map(({ id }) => id),
      perPage: false,
      filter: { metadata: { source: 'import' } },
    })).total;
  };
  return {
    writer: new MastraMemoryWriter({ memory, storage }),
    countDestination,
  };
}

class FakeWriter implements ArchiveImportWriter {
  readonly records = new Map<string, string>();
  failNext = false;

  async write(records: readonly ArchiveWriterRecord[]): Promise<ArchiveWriterResult> {
    if (this.failNext) {
      this.failNext = false;
      return {
        accepted: records.length - 1,
        rejected: 1,
        writer: { inserted: 0, updated: 0, unchanged: records.length - 1, failed: 1 },
        embeddings: { written: 0, unchanged: records.length - 1, failed: 1 },
        failures: [{ record_index: 0, reason: 'writer_failed', retryable: true }],
      };
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const record of records) {
      const canonical = JSON.stringify({
        ...record.message,
        ingested_at: undefined,
      });
      const existing = this.records.get(record.message.message_key);
      if (existing === undefined) inserted += 1;
      else if (existing === canonical) unchanged += 1;
      else updated += 1;
      this.records.set(record.message.message_key, canonical);
    }
    return {
      accepted: records.length,
      rejected: 0,
      writer: { inserted, updated, unchanged, failed: 0 },
      embeddings: {
        written: inserted + updated,
        unchanged,
        failed: 0,
      },
      failures: [],
    };
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(resources.splice(0).map(async ({ memory, storage, vector }) => {
    await memory.settled();
    await vector.close();
    await storage.close();
  }));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('archive import orchestration', () => {
  it('composes the real reader, mapper, and writer and converges on rerun', async () => {
    const sourcePath = createArchive();
    const destinationDirectory = temporaryDirectory();
    const destinationPath = join(destinationDirectory, 'mastra.db');
    const firstIo = await makeWriter(destinationPath);
    const first = await runArchiveImport({
      sourcePath,
      destinationPath,
      context: context(),
      mode: 'full',
      reportPath: join(destinationDirectory, 'first-report.json'),
      checkpointPath: join(destinationDirectory, 'first-checkpoint.json'),
      now: () => '2025-02-01T00:01:00.000Z',
      ...firstIo,
    });

    expect(first.status).toBe('succeeded');
    expect(first.counts).toMatchObject({
      source_rows_seen: 3,
      normalized_records: 2,
      skipped_by_reason: { bot_message: 1 },
      failed_by_reason: {},
      writer: { inserted: 2, updated: 0, unchanged: 0, failed: 0 },
      embeddings: { written: 2, unchanged: 0, failed: 0 },
    });
    expect(first.reconciliation).toEqual({
      source_rows_balanced: true,
      normalized_rows_balanced: true,
      destination_count_before: 0,
      destination_count_after: 2,
    });

    const second = await runArchiveImport({
      sourcePath,
      destinationPath,
      context: context({
        import_run_id: 'synthetic-run-002',
        started_at: '2025-02-02T00:00:00.000Z',
      }),
      mode: 'full',
      reportPath: join(destinationDirectory, 'second-report.json'),
      checkpointPath: join(destinationDirectory, 'second-checkpoint.json'),
      now: () => '2025-02-02T00:01:00.000Z',
      ...firstIo,
    });

    expect(second.status).toBe('succeeded');
    expect(second.counts.writer).toEqual({
      inserted: 0, updated: 0, unchanged: 2, failed: 0,
    });
    expect(second.counts.embeddings).toEqual({
      written: 0, unchanged: 2, failed: 0,
    });
    expect(second.reconciliation.destination_count_after).toBe(2);
  });

  it('defaults to dry-run and does not touch writer or destination', async () => {
    const sourcePath = createArchive();
    const directory = temporaryDirectory();
    const destinationPath = join(directory, 'destination-marker');
    writeFileSync(destinationPath, 'unchanged', { mode: 0o600 });
    const writer = new FakeWriter();

    const report = await runArchiveImport({
      sourcePath,
      destinationPath,
      context: context(),
      writer: { write: () => { throw new Error('writer must not run'); } },
      countDestination: () => { throw new Error('destination must not open'); },
      reportPath: join(directory, 'dry-report.json'),
      checkpointPath: join(directory, 'dry-checkpoint.json'),
      now: () => '2025-02-01T00:01:00.000Z',
    });

    expect(readFileSync(destinationPath, 'utf8')).toBe('unchanged');
    expect(writer.records.size).toBe(0);
    expect(report.status).toBe('partial');
    expect(report.counts.writer).toEqual({
      inserted: 0, updated: 0, unchanged: 2, failed: 0,
    });
    expect(report.reconciliation).toEqual({
      source_rows_balanced: true,
      normalized_rows_balanced: true,
      destination_count_before: 0,
      destination_count_after: 0,
    });
  });

  it('bounds explicit samples and writes only sampled normalized rows', async () => {
    const sourcePath = createArchive();
    const directory = temporaryDirectory();
    const writer = new FakeWriter();
    const report = await runArchiveImport({
      sourcePath,
      destinationPath: join(directory, 'destination.db'),
      context: context(),
      mode: 'sample',
      sampleLimit: 1,
      writer,
      countDestination: async () => writer.records.size,
      now: () => '2025-02-01T00:01:00.000Z',
    });

    expect(report.status).toBe('partial');
    expect(report.counts.source_rows_seen).toBe(1);
    expect(report.counts.normalized_records).toBe(1);
    expect(report.counts.writer.inserted).toBe(1);
    expect(writer.records.size).toBe(1);
  });

  it('resumes a failed writer delivery from a content-free checkpoint', async () => {
    const sourcePath = createArchive(fixtureRows('root_message'));
    const directory = temporaryDirectory();
    const destinationPath = join(directory, 'destination.db');
    const checkpointPath = join(directory, 'checkpoint.json');
    const writer = new FakeWriter();
    writer.failNext = true;
    const options = {
      sourcePath,
      destinationPath,
      context: context(),
      mode: 'full' as const,
      checkpointPath,
      writer,
      countDestination: async () => writer.records.size,
      now: () => '2025-02-01T00:01:00.000Z',
    };

    const failed = await runArchiveImport(options);
    expect(failed.status).toBe('failed');
    expect(failed.counts.failed_by_reason).toEqual({ writer_failed: 1 });
    expect(readArchiveImportCheckpoint(checkpointPath).state).toBe('writing');

    const resumed = await runArchiveImport({ ...options, resume: true });
    expect(resumed.status).toBe('succeeded');
    expect(resumed.counts.writer.inserted).toBe(1);
    expect(readArchiveImportCheckpoint(checkpointPath).state).toBe('completed');
    expect(() => JSON.stringify(readArchiveImportCheckpoint(checkpointPath)))
      .not.toThrow();
    expect(readFileSync(checkpointPath, 'utf8')).not.toContain('Synthetic decision');
    await expect(runArchiveImport({ ...options, resume: true })).rejects.toEqual(
      expect.objectContaining<Partial<ArchiveImportError>>({
        code: 'CHECKPOINT_COMPLETED',
      }),
    );
  });

  it('rejects source/destination collision before reading', async () => {
    const sourcePath = createArchive();
    await expect(runArchiveImport({
      sourcePath,
      destinationPath: sourcePath,
      context: context(),
    })).rejects.toEqual(expect.objectContaining<Partial<ArchiveImportError>>({
      code: 'SOURCE_DESTINATION_COLLISION',
    }));
  });

  it('accepts a PostgreSQL archive URI but rejects one without a database', () => {
    const destinationPath = join(temporaryDirectory(), 'destination.db');
    expect(() => validateArchiveImportRequest({
      sourcePath: 'postgresql://synthetic@localhost:5432/slack_archive',
      destinationPath,
      context: context(),
    })).not.toThrow();
    for (const sourcePath of [
      'postgresql://synthetic@localhost:5432',
      'postgresql://synthetic:secret@localhost:5432/slack_archive',
    ]) {
      expect(() => validateArchiveImportRequest({
        sourcePath,
        destinationPath,
        context: context(),
      })).toThrow(expect.objectContaining<Partial<ArchiveImportError>>({
        code: 'UNSAFE_PATH',
      }));
    }
  });

  it('writes reports without source content or real identity fields', async () => {
    const sourcePath = createArchive(fixtureRows('root_message'));
    const directory = temporaryDirectory();
    const reportPath = join(directory, 'report.json');
    await runArchiveImport({
      sourcePath,
      destinationPath: join(directory, 'destination.db'),
      context: context(),
      reportPath,
      now: () => '2025-02-01T00:01:00.000Z',
    });
    const serialized = readFileSync(reportPath, 'utf8');

    expect(serialized).not.toContain('Synthetic decision');
    for (const field of [
      'text', 'raw_json', 'sender_id', 'sender_name', 'channel_id',
      'workspace_id', 'source_path', 'embedding', 'trace',
    ]) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });
});

describe('archive import CLI guards', () => {
  const base = [
    '--source', '/tmp/synthetic-source.db',
    '--destination', '/tmp/synthetic-destination.db',
    '--import-run-id', 'synthetic-run-001',
    '--source-snapshot-id', 'synthetic-snapshot-001',
    '--workspace-id', 'T0SYNTH01',
    '--channel', 'C0APPROVED1=synthetic-approved-one',
    '--checkpoint', '/tmp/synthetic-checkpoint.json',
    '--report', '/tmp/synthetic-report.json',
  ] as const;

  it('defaults to dry-run', () => {
    expect(parseArchiveImportCli(base, '2025-02-01T00:00:00.000Z').run.mode)
      .toBe('dry-run');
  });

  it('requires source backup confirmation for a sample', () => {
    expect(() => parseArchiveImportCli([...base, '--sample', '1']))
      .toThrow(/source-backup-confirmed/);
    expect(parseArchiveImportCli([
      ...base,
      '--sample', '1',
      '--source-backup-confirmed',
    ]).run).toMatchObject({ mode: 'sample', sampleLimit: 1 });
  });

  it('requires both backups and exact full-import confirmation', () => {
    expect(() => parseArchiveImportCli([...base, '--full-import']))
      .toThrow(/source-backup-confirmed/);
    expect(parseArchiveImportCli([
      ...base,
      '--full-import',
      '--source-backup-confirmed',
      '--destination-backup-confirmed',
      '--confirm-full-import', 'IMPORT synthetic-run-001',
    ]).run.mode).toBe('full');
  });

  it('rejects a CLI source/destination collision before storage initialization', async () => {
    const sourcePath = createArchive(fixtureRows('root_message'));
    const before = readFileSync(sourcePath);
    const directory = temporaryDirectory();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await main([
      '--source', sourcePath,
      '--destination', sourcePath,
      '--import-run-id', 'synthetic-run-001',
      '--source-snapshot-id', 'synthetic-snapshot-001',
      '--workspace-id', 'T0SYNTH01',
      '--channel', 'C0APPROVED1=synthetic-approved-one',
      '--checkpoint', join(directory, 'checkpoint.json'),
      '--report', join(directory, 'report.json'),
      '--full-import',
      '--source-backup-confirmed',
      '--destination-backup-confirmed',
      '--confirm-full-import', 'IMPORT synthetic-run-001',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      'archive_import_failed:SOURCE_DESTINATION_COLLISION\n',
    );
    expect(readFileSync(sourcePath)).toEqual(before);
  });
});
