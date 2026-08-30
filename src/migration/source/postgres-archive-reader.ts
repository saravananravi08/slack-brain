import { Client, type QueryResult, type QueryResultRow } from 'pg';

import {
  ArchiveSourceError,
  approvedChannels,
  count,
  messageResult,
  pageSize,
  userResult,
  type ArchiveChannelCounts,
  type ArchiveSourceCounts,
  type ArchiveSourceResult,
  type ArchiveSourceUserResult,
  type MessageReadOptions,
  type MessageSqlRow,
  type SqlValue,
  type ThreadReadOptions,
  type UserSqlRow,
} from './archive-reader.js';

interface PgMessageRow extends QueryResultRow, MessageSqlRow {}
interface PgUserRow extends QueryResultRow, UserSqlRow {}

interface PgChannelCountRow extends QueryResultRow {
  channel_id: SqlValue;
  min_message_ts: SqlValue;
  max_message_ts: SqlValue;
  message_count: SqlValue;
  logical_thread_count: SqlValue;
  reply_count: SqlValue;
  malformed_timestamp_count: SqlValue;
  invalid_source_type_count: SqlValue;
}

const REQUIRED_COLUMNS = {
  messages: {
    ts: 'text',
    channel_id: 'text',
    user_id: 'text',
    user_name: 'text',
    text: 'text',
    thread_ts: 'text',
    reply_count: 'integer',
    date: 'text',
    is_thread_reply: 'integer',
    raw_json: 'text',
  },
  users: {
    id: 'text',
    name: 'text',
    real_name: 'text',
    display_name: 'text',
  },
} as const;

const MESSAGE_SELECT = `
  SELECT
    m.ts AS source_rowid,
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

export function isPostgresArchiveSource(source: string): boolean {
  try {
    const protocol = new URL(source).protocol;
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

export class PostgresArchiveSourceReader {
  private closed = false;

  private constructor(private readonly client: Client) {}

  static async open(connectionString: string): Promise<PostgresArchiveSourceReader> {
    if (!isPostgresArchiveSource(connectionString)) {
      throw new ArchiveSourceError('SOURCE_INPUT_INVALID');
    }

    const client = new Client({
      connectionString,
      application_name: 'gist-archive-import',
    });
    try {
      await client.connect();
    } catch {
      throw new ArchiveSourceError('SOURCE_OPEN_FAILED');
    }

    try {
      await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const readOnly = await client.query<{ default_transaction_read_only: string }>(
        'SHOW default_transaction_read_only',
      );
      if (readOnly.rows[0]?.default_transaction_read_only !== 'on') {
        throw new ArchiveSourceError('SOURCE_OPEN_FAILED');
      }
      await PostgresArchiveSourceReader.assertSchema(client);
      return new PostgresArchiveSourceReader(client);
    } catch (error) {
      await client.end().catch(() => undefined);
      if (error instanceof ArchiveSourceError) throw error;
      throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.end();
  }

  async *readUsers(requestedPageSize?: number): AsyncGenerator<ArchiveSourceUserResult> {
    this.assertOpen();
    const limit = pageSize(requestedPageSize);
    let cursor: string | null = null;

    while (true) {
      const result: QueryResult<PgUserRow> = await this.client.query<PgUserRow>({
        text: `
          SELECT id AS source_rowid, id, name, real_name, display_name
          FROM users
          WHERE ($1::text IS NULL OR id > $1)
          ORDER BY id
          LIMIT $2
        `,
        values: [cursor, limit],
      });
      for (const row of result.rows) yield userResult(row);
      if (result.rows.length < limit) return;
      const last: SqlValue | undefined = result.rows.at(-1)?.id;
      if (typeof last !== 'string') throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
      cursor = last;
    }
  }

  async *readMessages(options: MessageReadOptions): AsyncGenerator<ArchiveSourceResult> {
    this.assertOpen();
    const channels = approvedChannels(options.approvedChannelIds);
    const limit = pageSize(options.pageSize);
    let cursor: readonly [string, string] | undefined;

    while (true) {
      const result = await this.client.query<PgMessageRow>({
        text: `
          ${MESSAGE_SELECT}
          WHERE m.channel_id = ANY($1::text[])
            AND ($2::text IS NULL OR (m.ts, m.channel_id) > ($2::text, $3::text))
          ORDER BY m.ts, m.channel_id
          LIMIT $4
        `,
        values: [channels, cursor?.[0] ?? null, cursor?.[1] ?? null, limit],
      });
      for (const row of result.rows) yield messageResult(row);
      if (result.rows.length < limit) return;
      const last = result.rows.at(-1);
      if (typeof last?.ts !== 'string' || typeof last.channel_id !== 'string') {
        throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
      }
      cursor = [last.ts, last.channel_id];
    }
  }

  async *readThread(options: ThreadReadOptions): AsyncGenerator<ArchiveSourceResult> {
    this.assertOpen();
    const channels = approvedChannels(options.approvedChannelIds);
    if (!channels.includes(options.channelId) || options.threadTs === '') {
      throw new ArchiveSourceError('SOURCE_INPUT_INVALID');
    }
    const limit = pageSize(options.pageSize);
    let cursor: readonly [string, string] | undefined;

    while (true) {
      const result = await this.client.query<PgMessageRow>({
        text: `
          ${MESSAGE_SELECT}
          WHERE m.channel_id = $1
            AND (m.ts = $2 OR m.thread_ts = $2)
            AND ($3::text IS NULL OR (m.ts, m.channel_id) > ($3::text, $4::text))
          ORDER BY m.ts, m.channel_id
          LIMIT $5
        `,
        values: [
          options.channelId,
          options.threadTs,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          limit,
        ],
      });
      for (const row of result.rows) yield messageResult(row);
      if (result.rows.length < limit) return;
      const last = result.rows.at(-1);
      if (typeof last?.ts !== 'string' || typeof last.channel_id !== 'string') {
        throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
      }
      cursor = [last.ts, last.channel_id];
    }
  }

  async counts(approvedChannelIds: readonly string[]): Promise<ArchiveSourceCounts> {
    this.assertOpen();
    const channels = approvedChannels(approvedChannelIds);
    const result = await this.client.query<PgChannelCountRow>({
      text: `
        SELECT
          m.channel_id,
          MIN(m.ts) AS min_message_ts,
          MAX(m.ts) AS max_message_ts,
          COUNT(*)::integer AS message_count,
          COUNT(DISTINCT COALESCE(NULLIF(m.thread_ts, m.ts), m.ts))::integer
            AS logical_thread_count,
          COUNT(*) FILTER (
            WHERE m.thread_ts IS NOT NULL AND m.thread_ts <> m.ts
          )::integer AS reply_count,
          COUNT(*) FILTER (
            WHERE m.ts !~ '^[0-9]{10}\\.[0-9]{1,6}$'
          )::integer AS malformed_timestamp_count,
          COUNT(*) FILTER (
            WHERE m.reply_count IS NULL OR m.is_thread_reply IS NULL
          )::integer AS invalid_source_type_count
        FROM messages m
        WHERE m.channel_id = ANY($1::text[])
        GROUP BY m.channel_id
        ORDER BY m.channel_id
      `,
      values: [channels],
    });

    const byId = new Map<string, ArchiveChannelCounts>();
    for (const row of result.rows) {
      if (
        typeof row.channel_id !== 'string'
        || row.min_message_ts !== null && typeof row.min_message_ts !== 'string'
        || row.max_message_ts !== null && typeof row.max_message_ts !== 'string'
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

    const channelCounts = channels.map((channel_id) => byId.get(channel_id) ?? {
      channel_id,
      min_message_ts: null,
      max_message_ts: null,
      message_count: 0,
      logical_thread_count: 0,
      reply_count: 0,
      malformed_timestamp_count: 0,
      invalid_source_type_count: 0,
    });
    const users = await this.client.query<{ user_count: number }>(
      'SELECT COUNT(*)::integer AS user_count FROM users',
    );
    const userCount = users.rows[0]?.user_count;
    if (!Number.isSafeInteger(userCount) || userCount! < 0) {
      throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
    }

    return {
      user_count: userCount!,
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

  private assertOpen(): void {
    if (this.closed) throw new ArchiveSourceError('SOURCE_CLOSED');
  }

  private static async assertSchema(client: Client): Promise<void> {
    const result = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>({
      text: `
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
      `,
      values: [Object.keys(REQUIRED_COLUMNS)],
    });
    const actual = new Map(
      result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]),
    );
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const [column, dataType] of Object.entries(columns)) {
        if (actual.get(`${table}.${column}`) !== dataType) {
          throw new ArchiveSourceError('SOURCE_SCHEMA_INVALID');
        }
      }
    }
  }
}
