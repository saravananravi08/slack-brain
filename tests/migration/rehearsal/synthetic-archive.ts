import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

interface SyntheticUser {
  readonly id: string;
  readonly name: string;
  readonly real_name: string | null;
  readonly display_name: string | null;
}

interface SyntheticSourceRow {
  readonly source_ref: string;
  readonly ts: string;
  readonly channel_id: string;
  readonly user_id: string | null;
  readonly user_name: string | null;
  readonly text: string;
  readonly thread_ts: string | null;
  readonly reply_count: number;
  readonly date: string;
  readonly is_thread_reply: number;
  readonly raw_json: string | null;
  readonly user: SyntheticUser | null;
}

interface SourceFixture {
  readonly synthetic: boolean;
  readonly cases: readonly {
    readonly name: string;
    readonly rows: readonly SyntheticSourceRow[];
  }[];
}

export const REHEARSAL_CASES = [
  'root_message',
  'thread_reply',
  'self_referential_root',
  'edited_message',
  'missing_user_cache_with_row_name_fallback',
  'missing_unresolvable_sender',
  'bot_message',
  'timestamp_precision_pair',
  'exact_duplicate_delivery',
  'system_subtype',
  'empty_text',
  'unapproved_channel',
  'legacy_date_mismatch',
] as const;

export const APPROVED_SOURCE_ROWS = 14;
export const EXPECTED_IMPORTED_RECORDS = 9;

const fixture = JSON.parse(readFileSync(
  new URL('../../fixtures/migration/source-records.v1.json', import.meta.url),
  'utf8',
)) as SourceFixture;

export function createSyntheticRehearsalArchive(databasePath: string): void {
  if (!fixture.synthetic || !isAbsolute(databasePath)) {
    throw new TypeError('Synthetic rehearsal requires an absolute destination path.');
  }

  const selected = new Set<string>(REHEARSAL_CASES);
  const cases = fixture.cases.filter(({ name }) => selected.has(name));
  if (cases.length !== REHEARSAL_CASES.length) {
    throw new Error('Synthetic migration fixture is missing a rehearsal case.');
  }
  const rows = cases.flatMap(({ rows: caseRows }) => caseRows);

  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
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

    const users = new Map<string, SyntheticUser>();
    for (const row of rows) {
      if (row.user) users.set(row.user.id, row.user);
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
  } finally {
    database.close();
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath && pathToFileURL(entryPath).href === import.meta.url) {
  const databasePath = process.argv[2];
  if (!databasePath) throw new TypeError('Usage: synthetic-archive.ts /absolute/path/archive.db');
  createSyntheticRehearsalArchive(databasePath);
}
