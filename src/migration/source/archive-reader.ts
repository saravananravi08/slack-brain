import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ARCHIVE_IMPORT_CONTRACT_VERSION = '1.0.0' as const;

export interface ArchiveSourceUser {
  id: string;
  name: string;
  real_name: string | null;
  display_name: string | null;
}

export interface ArchiveSourceMessage {
  source_ref: string;
  ts: string;
  channel_id: string;
  user_id: string | null;
  user_name: string | null;
  text: string;
  thread_ts: string | null;
  reply_count: number;
  date: string;
  is_thread_reply: number;
  raw_json: string | null;
  user: ArchiveSourceUser | null;
}

export type ArchiveSourceResult =
  | { ok: true; value: ArchiveSourceMessage }
  | { ok: false; source_ref: string; reason: 'invalid_source_type' };

export type ArchiveSourceUserResult =
  | { ok: true; value: ArchiveSourceUser }
  | { ok: false; source_ref: string; reason: 'invalid_source_type' };

export interface ArchiveChannelCounts {
  channel_id: string;
  min_message_ts: string | null;
  max_message_ts: string | null;
  message_count: number;
  logical_thread_count: number;
  reply_count: number;
  malformed_timestamp_count: number;
  invalid_source_type_count: number;
}

export interface ArchiveSourceCounts {
  user_count: number;
  message_count: number;
  logical_thread_count: number;
  reply_count: number;
  malformed_timestamp_count: number;
  invalid_source_type_count: number;
  channels: readonly ArchiveChannelCounts[];
}

export interface MessageReadOptions {
  approvedChannelIds: readonly string[];
  pageSize?: number;
}

export interface ThreadReadOptions extends MessageReadOptions {
  channelId: string;
  threadTs: string;
}

export type ArchiveSourceErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_FILE'
  | 'SOURCE_OPEN_FAILED'
  | 'SOURCE_SCHEMA_INVALID'
  | 'SOURCE_CLOSED'
  | 'SOURCE_INPUT_INVALID';

export class ArchiveSourceError extends Error {
  constructor(readonly code: ArchiveSourceErrorCode) {
    super(code);
    this.name = 'ArchiveSourceError';
  }
}

export type SqlValue = null | number | bigint | string | Uint8Array;
type SqlRow = Record<string, SqlValue>;

export interface MessageSqlRow extends SqlRow {
  source_rowid: SqlValue;
  ts: SqlValue;
  channel_id: SqlValue;
  user_id: SqlValue;
  user_name: SqlValue;
  text: SqlValue;
  thread_ts: SqlValue;
  reply_count: SqlValue;
  date: SqlValue;
  is_thread_reply: SqlValue;
  raw_json: SqlValue;
  joined_user_id: SqlValue;
  joined_user_name: SqlValue;
  joined_real_name: SqlValue;
  joined_display_name: SqlValue;
}

export interface UserSqlRow extends SqlRow {
  source_rowid: SqlValue;
  id: SqlValue;
  name: SqlValue;
  real_name: SqlValue;
  display_name: SqlValue;
}

interface ChannelCountSqlRow extends SqlRow {
  channel_id: SqlValue;
  min_message_ts: SqlValue;
  max_message_ts: SqlValue;
  message_count: SqlValue;
  logical_thread_count: SqlValue;
  reply_count: SqlValue;
  malformed_timestamp_count: SqlValue;
  invalid_source_type_count: SqlValue;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 10_000;
const REQUIRED_COLUMNS = {
  messages: [
    'ts', 'channel_id', 'user_id', 'user_name', 'text', 'thread_ts',
    'reply_count', 'date', 'is_thread_reply', 'raw_json',
  ],
  users: ['id', 'name', 'real_name', 'display_name'],
} as const;

const MESSAGE_SELECT = `
  SELECT
    m.rowid AS source_rowid,
    m.ts,
    m.channel_id,
    m.user_id,
    m.user_name,
    m.text,
    m.thread_ts,
    m.reply_count,
    m.date,
    m.is_thread_reply,
    m.raw_json,
    u.id AS joined_user_id,
    u.name AS joined_user_name,
    u.real_name AS joined_real_name,
    u.display_name AS joined_display_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.user_id
`;

const VALID_TIMESTAMP_SQL = `
  typeof(m.ts) = 'text'
  AND length(m.ts) BETWEEN 12 AND 17
  AND substr(m.ts, 11, 1) = '.'
  AND substr(m.ts, 1, 10) NOT GLOB '*[^0-9]*'
  AND length(substr(m.ts, 12)) BETWEEN 1 AND 6
  AND substr(m.ts, 12) NOT GLOB '*[^0-9]*'
`;

const VALID_SOURCE_TYPE_SQL = `
  typeof(m.ts) = 'text'
  AND typeof(m.channel_id) = 'text'
  AND (m.user_id IS NULL OR typeof(m.user_id) = 'text')
  AND (m.user_name IS NULL OR typeof(m.user_name) = 'text')
  AND typeof(m.text) = 'text'
  AND (m.thread_ts IS NULL OR typeof(m.thread_ts) = 'text')
  AND typeof(m.reply_count) = 'integer'
  AND typeof(m.date) = 'text'
  AND typeof(m.is_thread_reply) = 'integer'
  AND (m.raw_json IS NULL OR typeof(m.raw_json) = 'text')
  AND (
    u.id IS NULL OR (
      typeof(u.id) = 'text'
      AND typeof(u.name) = 'text'
      AND (u.real_name IS NULL OR typeof(u.real_name) = 'text')
      AND (u.display_name IS NULL OR typeof(u.display_name) = 'text')
    )
  )
`;

export function sourceRef(table: 'messages' | 'users', rowId: SqlValue): string {
  const digest = createHash('sha256').update(`${table}:${String(rowId)}`).digest('hex');
  return `sha256:${digest}`;
}

export function pageSize(value: number | undefined): number {
  const size = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new ArchiveSourceError('SOURCE_INPUT_INVALID');
  }
  return size;
}

export function approvedChannels(values: readonly string[]): string[] {
  const channels = [...new Set(values)];
  if (channels.length === 0 || channels.some((value) => value.trim() !== value || value === '')) {
    throw new ArchiveSourceError('SOURCE_INPUT_INVALID');
  }
  return channels.sort();
}

function isStringOrNull(value: SqlValue): value is string | null {
  return value === null || typeof value === 'string';
}

function isSafeInteger(value: SqlValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function count(value: SqlValue): number {
  if (!isSafeInteger(value) || value < 0) {
    throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
  }
  return value;
}

function sourceUser(row: MessageSqlRow): ArchiveSourceUser | null | undefined {
  if (row.joined_user_id === null) {
    return row.joined_user_name === null
      && row.joined_real_name === null
      && row.joined_display_name === null
      ? null
      : undefined;
  }
  if (
    typeof row.joined_user_id !== 'string'
    || typeof row.joined_user_name !== 'string'
    || !isStringOrNull(row.joined_real_name)
    || !isStringOrNull(row.joined_display_name)
  ) {
    return undefined;
  }
  return {
    id: row.joined_user_id,
    name: row.joined_user_name,
    real_name: row.joined_real_name,
    display_name: row.joined_display_name,
  };
}

export function messageResult(row: MessageSqlRow): ArchiveSourceResult {
  const source_ref = sourceRef('messages', row.source_rowid);
  const user = sourceUser(row);
  if (
    typeof row.ts !== 'string'
    || typeof row.channel_id !== 'string'
    || !isStringOrNull(row.user_id)
    || !isStringOrNull(row.user_name)
    || typeof row.text !== 'string'
    || !isStringOrNull(row.thread_ts)
    || !isSafeInteger(row.reply_count)
    || typeof row.date !== 'string'
    || !isSafeInteger(row.is_thread_reply)
    || !isStringOrNull(row.raw_json)
    || user === undefined
  ) {
    return { ok: false, source_ref, reason: 'invalid_source_type' };
  }
  return {
    ok: true,
    value: {
      source_ref,
      ts: row.ts,
      channel_id: row.channel_id,
      user_id: row.user_id,
      user_name: row.user_name,
      text: row.text,
      thread_ts: row.thread_ts,
      reply_count: row.reply_count,
      date: row.date,
      is_thread_reply: row.is_thread_reply,
      raw_json: row.raw_json,
      user,
    },
  };
}

export function userResult(row: UserSqlRow): ArchiveSourceUserResult {
  const source_ref = sourceRef('users', row.source_rowid);
  if (
    typeof row.id !== 'string'
    || typeof row.name !== 'string'
    || !isStringOrNull(row.real_name)
    || !isStringOrNull(row.display_name)
  ) {
    return { ok: false, source_ref, reason: 'invalid_source_type' };
  }
  return {
    ok: true,
    value: {
      id: row.id,
      name: row.name,
      real_name: row.real_name,
      display_name: row.display_name,
    },
  };
}

export class ArchiveSourceReader {
  private closed = false;

  private constructor(private readonly database: DatabaseSync) {}

  static open(sourcePath: string): ArchiveSourceReader {
    let resolvedPath: string;
    try {
      const sourceStat = statSync(sourcePath);
      if (!sourceStat.isFile()) throw new ArchiveSourceError('SOURCE_NOT_FILE');
      resolvedPath = realpathSync(sourcePath);
    } catch (error) {
      if (error instanceof ArchiveSourceError) throw error;
      throw new ArchiveSourceError('SOURCE_NOT_FOUND');
    }

    const sourceUrl = pathToFileURL(resolvedPath);
    sourceUrl.searchParams.set('mode', 'ro');
    sourceUrl.searchParams.set('immutable', '1');

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(sourceUrl.href, {
        readOnly: true,
        allowExtension: false,
        enableForeignKeyConstraints: false,
        enableDoubleQuotedStringLiterals: false,
      });
      database.exec('PRAGMA query_only = ON');
    } catch {
      database?.close();
      throw new ArchiveSourceError('SOURCE_OPEN_FAILED');
    }

    try {
      ArchiveSourceReader.assertReadOnly(database);
      ArchiveSourceReader.assertSchema(database);
      return new ArchiveSourceReader(database);
    } catch (error) {
      database.close();
      if (error instanceof ArchiveSourceError) throw error;
      throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
    }
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  *readUsers(requestedPageSize?: number): Generator<ArchiveSourceUserResult> {
    this.assertOpen();
    const limit = pageSize(requestedPageSize);
    let cursor: SqlValue | undefined;

    while (true) {
      const where = cursor === undefined ? '' : 'WHERE id > ?';
      const statement = this.database.prepare(`
        SELECT rowid AS source_rowid, id, name, real_name, display_name
        FROM users
        ${where}
        ORDER BY id, rowid
        LIMIT ?
      `);
      const rows = (cursor === undefined
        ? statement.all(limit)
        : statement.all(cursor, limit)) as UserSqlRow[];
      for (const row of rows) yield userResult(row);
      if (rows.length < limit) return;
      cursor = rows.at(-1)?.id;
    }
  }

  *readMessages(options: MessageReadOptions): Generator<ArchiveSourceResult> {
    this.assertOpen();
    const channels = approvedChannels(options.approvedChannelIds);
    yield* this.readMessageQuery(
      `m.channel_id IN (${channels.map(() => '?').join(', ')})`,
      channels,
      pageSize(options.pageSize),
    );
  }

  *readThread(options: ThreadReadOptions): Generator<ArchiveSourceResult> {
    this.assertOpen();
    const channels = approvedChannels(options.approvedChannelIds);
    if (!channels.includes(options.channelId) || options.threadTs === '') {
      throw new ArchiveSourceError('SOURCE_INPUT_INVALID');
    }
    yield* this.readMessageQuery(
      `m.channel_id = ? AND (m.ts = ? OR m.thread_ts = ?)`,
      [options.channelId, options.threadTs, options.threadTs],
      pageSize(options.pageSize),
    );
  }

  counts(approvedChannelIds: readonly string[]): ArchiveSourceCounts {
    this.assertOpen();
    const channels = approvedChannels(approvedChannelIds);
    const placeholders = channels.map(() => '?').join(', ');
    const rows = this.database.prepare(`
      SELECT
        m.channel_id,
        MIN(CASE WHEN typeof(m.ts) = 'text' THEN m.ts END) AS min_message_ts,
        MAX(CASE WHEN typeof(m.ts) = 'text' THEN m.ts END) AS max_message_ts,
        COUNT(*) AS message_count,
        COUNT(DISTINCT COALESCE(NULLIF(m.thread_ts, m.ts), m.ts)) AS logical_thread_count,
        SUM(CASE WHEN m.thread_ts IS NOT NULL AND m.thread_ts != m.ts THEN 1 ELSE 0 END) AS reply_count,
        SUM(CASE WHEN ${VALID_TIMESTAMP_SQL} THEN 0 ELSE 1 END) AS malformed_timestamp_count,
        SUM(CASE WHEN ${VALID_SOURCE_TYPE_SQL} THEN 0 ELSE 1 END) AS invalid_source_type_count
      FROM messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel_id IN (${placeholders})
      GROUP BY m.channel_id
      ORDER BY m.channel_id
    `).all(...channels) as ChannelCountSqlRow[];

    const byId = new Map<string, ArchiveChannelCounts>();
    for (const row of rows) {
      if (
        typeof row.channel_id !== 'string'
        || !isStringOrNull(row.min_message_ts)
        || !isStringOrNull(row.max_message_ts)
      ) {
        throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
      }
      byId.set(row.channel_id, {
        channel_id: row.channel_id,
        min_message_ts: row.min_message_ts,
        max_message_ts: row.max_message_ts,
        message_count: count(row.message_count),
        logical_thread_count: count(row.logical_thread_count),
        reply_count: count(row.reply_count),
        malformed_timestamp_count: count(row.malformed_timestamp_count),
        invalid_source_type_count: count(row.invalid_source_type_count),
      });
    }

    const empty = (channel_id: string): ArchiveChannelCounts => ({
      channel_id,
      min_message_ts: null,
      max_message_ts: null,
      message_count: 0,
      logical_thread_count: 0,
      reply_count: 0,
      malformed_timestamp_count: 0,
      invalid_source_type_count: 0,
    });
    const channelCounts = channels.map((channel) => byId.get(channel) ?? empty(channel));
    const userRow = this.database.prepare(
      'SELECT COUNT(*) AS user_count FROM users',
    ).get() as { user_count: SqlValue };

    return {
      user_count: count(userRow.user_count),
      message_count: channelCounts.reduce((total, item) => total + item.message_count, 0),
      logical_thread_count: channelCounts.reduce(
        (total, item) => total + item.logical_thread_count,
        0,
      ),
      reply_count: channelCounts.reduce((total, item) => total + item.reply_count, 0),
      malformed_timestamp_count: channelCounts.reduce(
        (total, item) => total + item.malformed_timestamp_count,
        0,
      ),
      invalid_source_type_count: channelCounts.reduce(
        (total, item) => total + item.invalid_source_type_count,
        0,
      ),
      channels: channelCounts,
    };
  }

  private *readMessageQuery(
    filter: string,
    parameters: readonly (string | number)[],
    limit: number,
  ): Generator<ArchiveSourceResult> {
    let cursor: [SqlValue, SqlValue, SqlValue] | undefined;

    while (true) {
      const cursorFilter = cursor === undefined
        ? ''
        : 'AND (m.ts, m.channel_id, m.rowid) > (?, ?, ?)';
      const statement = this.database.prepare(`
        ${MESSAGE_SELECT}
        WHERE ${filter}
        ${cursorFilter}
        ORDER BY m.ts, m.channel_id, m.rowid
        LIMIT ?
      `);
      const rows = statement.all(
        ...parameters,
        ...(cursor ?? []),
        limit,
      ) as MessageSqlRow[];
      for (const row of rows) yield messageResult(row);
      if (rows.length < limit) return;
      const last = rows.at(-1);
      if (last === undefined) return;
      cursor = [last.ts ?? null, last.channel_id ?? null, last.source_rowid ?? null];
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new ArchiveSourceError('SOURCE_CLOSED');
  }

  private static assertReadOnly(database: DatabaseSync): void {
    const result = database.prepare('PRAGMA query_only').get() as SqlRow;
    if (result.query_only !== 1) throw new ArchiveSourceError('SOURCE_OPEN_FAILED');
  }

  private static assertSchema(database: DatabaseSync): void {
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[];
      const names = new Set(columns.map(({ name }) => name));
      if (required.some((column) => !names.has(column))) {
        throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
      }
    }
  }
}
