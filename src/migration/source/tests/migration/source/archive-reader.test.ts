import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ARCHIVE_IMPORT_CONTRACT_VERSION,
  ArchiveSourceError,
  ArchiveSourceReader,
  type ArchiveSourceMessage,
} from '../../../archive-reader.js';

type JsonRecord = Record<string, any>;

const fixture = JSON.parse(
  await readFile(
    new URL('../../../../../../tests/fixtures/migration/source-records.v1.json', import.meta.url),
    'utf8',
  ),
) as JsonRecord;

const temporaryDirectories: string[] = [];

function fixtureRows(...caseNames: string[]): JsonRecord[] {
  return fixture.cases
    .filter(({ name }: JsonRecord) => caseNames.includes(name))
    .flatMap(({ rows }: JsonRecord) => rows);
}

function createArchive(rows: JsonRecord[]): string {
  const directory = mkdtempSync(join(tmpdir(), 't302-source-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'synthetic-archive.db');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      real_name TEXT,
      display_name TEXT
    );
    CREATE TABLE messages (
      ts TEXT PRIMARY KEY,
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
  const insertUser = database.prepare(`
    INSERT INTO users (id, name, real_name, display_name) VALUES (?, ?, ?, ?)
  `);
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
  return databasePath;
}

function successfulMessages(
  results: ReturnType<ArchiveSourceReader['readMessages']>,
): ArchiveSourceMessage[] {
  return [...results].map((result) => {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid synthetic source row');
    return result.value;
  });
}

function withoutSourceRef(row: ArchiveSourceMessage): Omit<ArchiveSourceMessage, 'source_ref'> {
  const { source_ref: _sourceRef, ...value } = row;
  return value;
}

function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ArchiveSourceReader', () => {
  it('pins the immutable import contract version', () => {
    expect(ARCHIVE_IMPORT_CONTRACT_VERSION).toBe('1.0.0');
    expect(fixture.contract_version).toBe(ARCHIVE_IMPORT_CONTRACT_VERSION);
    expect(fixture.synthetic).toBe(true);
  });

  it('streams approved message rows in stable bounded pages', () => {
    const expected = fixtureRows(
      'root_message',
      'thread_reply',
      'self_referential_root',
      'timestamp_precision_pair',
      'unapproved_channel',
    );
    const path = createArchive(expected);
    const reader = ArchiveSourceReader.open(path);

    try {
      const messages = successfulMessages(reader.readMessages({
        approvedChannelIds: ['C0APPROVED1'],
        pageSize: 1,
      }));
      const expectedApproved = expected
        .filter(({ channel_id }) => channel_id === 'C0APPROVED1')
        .sort((left, right) => left.ts.localeCompare(right.ts));

      expect(messages.map(withoutSourceRef)).toEqual(
        expectedApproved.map(({ source_ref: _sourceRef, ...row }) => row),
      );
      expect(messages.every(({ source_ref }) => /^sha256:[a-f0-9]{64}$/.test(source_ref))).toBe(true);
    } finally {
      reader.close();
    }
  });

  it('streams users and thread roots/replies without loading unrelated rows', () => {
    const rows = fixtureRows('root_message', 'thread_reply', 'self_referential_root');
    const reader = ArchiveSourceReader.open(createArchive(rows));

    try {
      const users = [...reader.readUsers(1)];
      expect(users).toEqual([
        {
          ok: true,
          value: {
            id: 'U0MEMBER01',
            name: 'synthetic-one',
            real_name: 'Synthetic Member One',
            display_name: 'Synthetic One',
          },
        },
        {
          ok: true,
          value: {
            id: 'U0MEMBER02',
            name: 'synthetic-two',
            real_name: 'Synthetic Member Two',
            display_name: '',
          },
        },
      ]);

      const thread = [...reader.readThread({
        approvedChannelIds: ['C0APPROVED1'],
        channelId: 'C0APPROVED1',
        threadTs: '1735689600.000100',
        pageSize: 1,
      })];
      expect(thread.map((result) => result.ok && result.value.ts)).toEqual([
        '1735689600.000100',
        '1735689660.000200',
      ]);
    } finally {
      reader.close();
    }
  });

  it('returns deterministic approved-channel counts including corruption counters', () => {
    const rows = fixtureRows(
      'root_message',
      'thread_reply',
      'self_referential_root',
      'invalid_timestamp',
      'unapproved_channel',
    );
    const reader = ArchiveSourceReader.open(createArchive(rows));

    try {
      const first = reader.counts(['C0APPROVED2', 'C0APPROVED1']);
      const second = reader.counts(['C0APPROVED1', 'C0APPROVED2']);

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        user_count: 2,
        message_count: 4,
        logical_thread_count: 3,
        reply_count: 1,
        malformed_timestamp_count: 1,
        invalid_source_type_count: 0,
      });
      expect(first.channels).toEqual([
        {
          channel_id: 'C0APPROVED1',
          min_message_ts: '1735689600.000100',
          max_message_ts: 'not-a-timestamp',
          message_count: 4,
          logical_thread_count: 3,
          reply_count: 1,
          malformed_timestamp_count: 1,
          invalid_source_type_count: 0,
        },
        {
          channel_id: 'C0APPROVED2',
          min_message_ts: null,
          max_message_ts: null,
          message_count: 0,
          logical_thread_count: 0,
          reply_count: 0,
          malformed_timestamp_count: 0,
          invalid_source_type_count: 0,
        },
      ]);
    } finally {
      reader.close();
    }
  });

  it('reports malformed dynamic SQLite values without returning content', () => {
    const path = createArchive(fixtureRows('root_message'));
    const database = new DatabaseSync(path);
    database.prepare(`
      INSERT INTO messages (
        ts, channel_id, user_id, user_name, text, thread_ts,
        reply_count, date, is_thread_reply, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '1735689620.000150',
      'C0APPROVED1',
      'U0MEMBER01',
      'Synthetic One',
      'Synthetic corruption marker must not escape.',
      null,
      'not-an-integer',
      '2025-01-01',
      0,
      null,
    );
    database.close();

    const reader = ArchiveSourceReader.open(path);
    try {
      const failures = [...reader.readMessages({ approvedChannelIds: ['C0APPROVED1'] })]
        .filter((result) => !result.ok);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({
        ok: false,
        source_ref: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        reason: 'invalid_source_type',
      });
      expect(JSON.stringify(failures)).not.toContain('corruption marker');
      expect(reader.counts(['C0APPROVED1']).invalid_source_type_count).toBe(1);
    } finally {
      reader.close();
    }
  });

  it('does not mutate the source file while reading', () => {
    const path = createArchive(fixtureRows('root_message', 'thread_reply'));
    const before = { digest: fileDigest(path), mtime: statSync(path).mtimeMs };
    const reader = ArchiveSourceReader.open(path);

    try {
      [...reader.readUsers(1)];
      [...reader.readMessages({ approvedChannelIds: ['C0APPROVED1'], pageSize: 1 })];
      reader.counts(['C0APPROVED1']);
    } finally {
      reader.close();
    }

    expect({ digest: fileDigest(path), mtime: statSync(path).mtimeMs }).toEqual(before);
  });

  it('fails closed for missing files, wrong schemas, closed readers, and invalid scope', () => {
    const directory = mkdtempSync(join(tmpdir(), 't302-missing-'));
    temporaryDirectories.push(directory);
    const missing = join(directory, 'missing.db');
    expect(() => ArchiveSourceReader.open(missing)).toThrow(
      expect.objectContaining<Partial<ArchiveSourceError>>({ code: 'SOURCE_NOT_FOUND' }),
    );
    expect(() => statSync(missing)).toThrow();

    const wrongSchema = join(directory, 'wrong-schema.db');
    const database = new DatabaseSync(wrongSchema);
    database.exec('CREATE TABLE messages (ts TEXT PRIMARY KEY)');
    database.close();
    expect(() => ArchiveSourceReader.open(wrongSchema)).toThrow(
      expect.objectContaining<Partial<ArchiveSourceError>>({ code: 'SOURCE_SCHEMA_INVALID' }),
    );

    const reader = ArchiveSourceReader.open(createArchive(fixtureRows('root_message')));
    expect(() => [...reader.readMessages({ approvedChannelIds: [] })]).toThrow(
      expect.objectContaining<Partial<ArchiveSourceError>>({ code: 'SOURCE_INPUT_INVALID' }),
    );
    expect(() => [...reader.readMessages({
      approvedChannelIds: ['C0APPROVED1'],
      pageSize: 0,
    })]).toThrow(expect.objectContaining<Partial<ArchiveSourceError>>({
      code: 'SOURCE_INPUT_INVALID',
    }));
    reader.close();
    expect(() => reader.counts(['C0APPROVED1'])).toThrow(
      expect.objectContaining<Partial<ArchiveSourceError>>({ code: 'SOURCE_CLOSED' }),
    );
  });
});
