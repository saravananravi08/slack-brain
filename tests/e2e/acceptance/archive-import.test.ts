import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  runArchiveImport,
  type ArchiveImportContext,
  type ArchiveImportWriter,
  type ArchiveWriterRecord,
  type ArchiveWriterResult,
} from '../../../src/migration/index.js';

class CountingWriter implements ArchiveImportWriter {
  readonly keys = new Set<string>();

  async write(records: readonly ArchiveWriterRecord[]): Promise<ArchiveWriterResult> {
    let inserted = 0;
    let unchanged = 0;
    for (const { message } of records) {
      if (this.keys.has(message.message_key)) unchanged += 1;
      else {
        this.keys.add(message.message_key);
        inserted += 1;
      }
    }
    return {
      accepted: records.length,
      rejected: 0,
      writer: { inserted, updated: 0, unchanged, failed: 0 },
      embeddings: { written: inserted, unchanged, failed: 0 },
      failures: [],
    };
  }
}

function context(importRunId: string, startedAt: string): ArchiveImportContext {
  return {
    contract_version: '1.0.0',
    import_run_id: importRunId,
    source_snapshot_id: 'synthetic-snapshot-001',
    workspace_id: 'T0SYNTH01',
    approved_channel_ids: ['C0APPROVED1'],
    channel_aliases: { C0APPROVED1: 'synthetic-approved-one' },
    known_bot_sender_ids: ['B0SYNTH001'],
    started_at: startedAt,
  };
}

function createArchive(path: string): void {
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
    INSERT INTO users VALUES (
      'U0MEMBER01', 'synthetic-one', 'Synthetic Member One', 'Synthetic One'
    );
    INSERT INTO messages VALUES (
      '1735689600.000100',
      'C0APPROVED1',
      'U0MEMBER01',
      'Synthetic Archived One',
      'Synthetic decision: use the blue rollout checklist.',
      NULL,
      0,
      '2025-01-01',
      0,
      NULL
    );
  `);
  database.close();
}

describe('T501 archive acceptance', () => {
  it('AC-14: converges on stable message counts when the archive importer runs twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't501-archive-'));
    try {
      const sourcePath = join(directory, 'source.db');
      const destinationPath = join(directory, 'destination.db');
      createArchive(sourcePath);
      const writer = new CountingWriter();
      const countDestination = async () => writer.keys.size;

      const first = await runArchiveImport({
        sourcePath,
        destinationPath,
        context: context('synthetic-run-001', '2025-02-01T00:00:00.000Z'),
        mode: 'full',
        writer,
        countDestination,
        now: () => '2025-02-01T00:01:00.000Z',
      });
      const second = await runArchiveImport({
        sourcePath,
        destinationPath,
        context: context('synthetic-run-002', '2025-02-02T00:00:00.000Z'),
        mode: 'full',
        writer,
        countDestination,
        now: () => '2025-02-02T00:01:00.000Z',
      });

      expect(first.status).toBe('succeeded');
      expect(first.counts.writer).toMatchObject({ inserted: 1, unchanged: 0 });
      expect(second.status).toBe('succeeded');
      expect(second.counts.writer).toMatchObject({ inserted: 0, unchanged: 1 });
      expect(second.reconciliation).toMatchObject({
        destination_count_before: 1,
        destination_count_after: 1,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
