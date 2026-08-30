import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../../scripts/import-slack.js';
import {
  APPROVED_SOURCE_ROWS,
  EXPECTED_IMPORTED_RECORDS,
  createSyntheticRehearsalArchive,
} from './synthetic-archive.js';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 't306-synthetic-rehearsal-'));
  directories.push(directory);
  return directory;
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function report(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

function syntheticEmbeddingResponse(init: RequestInit | undefined): Response {
  const body = JSON.parse(String(init?.body)) as { input: string | string[] };
  const values = Array.isArray(body.input) ? body.input : [body.input];
  const embedding = Array<number>(1_536).fill(0);
  embedding[0] = 1;
  return new Response(JSON.stringify({
    object: 'list',
    data: values.map((_, index) => ({ object: 'embedding', index, embedding })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: values.length, total_tokens: values.length },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function cliArgs(
  directory: string,
  sourcePath: string,
  destinationPath: string,
  runId: string,
): string[] {
  return [
    '--source', sourcePath,
    '--destination', destinationPath,
    '--import-run-id', runId,
    '--source-snapshot-id', 'synthetic-rehearsal-snapshot',
    '--workspace-id', 'T0SYNTH01',
    '--channel', 'C0APPROVED1=synthetic-approved-one',
    '--known-bot-id', 'B0SYNTH001',
    '--sample', String(APPROVED_SOURCE_ROWS),
    '--source-backup-confirmed',
    '--checkpoint', join(directory, `${runId}-checkpoint.json`),
    '--report', join(directory, `${runId}-report.json`),
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('T306 synthetic import CLI rehearsal', () => {
  it('imports fixture-shaped SQLite, reconciles audit output, and deduplicates a rerun', async () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, 'synthetic-archive.db');
    const destinationPath = join(directory, 'scratch-mastra.db');
    createSyntheticRehearsalArchive(sourcePath);
    const sourceBefore = { digest: digest(sourcePath), mtimeMs: statSync(sourcePath).mtimeMs };

    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      if (!url.endsWith('/embeddings')) {
        throw new Error(`Unexpected network request: ${url}`);
      }
      return syntheticEmbeddingResponse(init);
    }));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const firstRunId = 't306-synthetic-rehearsal-001';
    expect(await main(cliArgs(
      directory,
      sourcePath,
      destinationPath,
      firstRunId,
    ))).toBe(0);
    const first = report(join(directory, `${firstRunId}-report.json`));

    expect(first.status).toBe('partial');
    expect(first.inventory).toEqual([expect.objectContaining({
      channel_alias: 'synthetic-approved-one',
      source_message_count: APPROVED_SOURCE_ROWS,
      logical_thread_count: 12,
      malformed_timestamp_count: 0,
    })]);
    expect(first.counts).toMatchObject({
      source_rows_seen: APPROVED_SOURCE_ROWS,
      normalized_records: EXPECTED_IMPORTED_RECORDS,
      skipped_by_reason: {
        bot_message: 1,
        duplicate_exact: 1,
        empty_text: 1,
        missing_sender: 1,
        system_subtype: 1,
      },
      failed_by_reason: {},
      warnings_by_reason: {
        legacy_date_mismatch: 1,
        user_cache_miss_fallback: 1,
      },
      writer: { inserted: 9, updated: 0, unchanged: 0, failed: 0 },
      embeddings: { written: 9, unchanged: 0, failed: 0 },
    });
    expect(first.failures).toEqual([]);
    expect(first.reconciliation).toEqual({
      source_rows_balanced: true,
      normalized_rows_balanced: true,
      destination_count_before: 0,
      destination_count_after: EXPECTED_IMPORTED_RECORDS,
    });

    const secondRunId = 't306-synthetic-rehearsal-002';
    expect(await main(cliArgs(
      directory,
      sourcePath,
      destinationPath,
      secondRunId,
    ))).toBe(0);
    const secondReportPath = join(directory, `${secondRunId}-report.json`);
    const second = report(secondReportPath);

    expect(statSync(join(directory, `${firstRunId}-report.json`)).mode & 0o777).toBe(0o600);
    expect(statSync(secondReportPath).mode & 0o777).toBe(0o600);
    expect(second.counts.writer).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: EXPECTED_IMPORTED_RECORDS,
      failed: 0,
    });
    expect(second.counts.embeddings).toEqual({
      written: 0,
      unchanged: EXPECTED_IMPORTED_RECORDS,
      failed: 0,
    });
    expect(second.reconciliation).toEqual({
      source_rows_balanced: true,
      normalized_rows_balanced: true,
      destination_count_before: EXPECTED_IMPORTED_RECORDS,
      destination_count_after: EXPECTED_IMPORTED_RECORDS,
    });
    expect({ digest: digest(sourcePath), mtimeMs: statSync(sourcePath).mtimeMs })
      .toEqual(sourceBefore);

    const serializedReports = JSON.stringify([first, second]);
    for (const forbidden of ['text', 'raw_json', 'sender_id', 'sender_name', 'channel_id', 'workspace_id']) {
      expect(serializedReports).not.toContain(`"${forbidden}"`);
    }
  });
});
