/**
 * SQLite database for Slack messages with FTS5 full-text search.
 */

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "slack_messages.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Users table — cache user ID → name mapping
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      real_name TEXT,
      display_name TEXT
    )
  `);

  // Messages table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
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
    )
  `);

  // FTS5 virtual table for full-text search
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      ts UNINDEXED,
      user_name,
      text,
      date UNINDEXED,
      content=messages,
      content_rowid=rowid,
      tokenize='porter unicode61'
    )
  `);

  // Triggers to keep FTS in sync
  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, ts, user_name, text, date)
      VALUES (new.rowid, new.ts, new.user_name, new.text, new.date);
    END
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, ts, user_name, text, date)
      VALUES ('delete', old.rowid, old.ts, old.user_name, old.text, old.date);
    END
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, ts, user_name, text, date)
      VALUES ('delete', old.rowid, old.ts, old.user_name, old.text, old.date);
      INSERT INTO messages_fts(rowid, ts, user_name, text, date)
      VALUES (new.rowid, new.ts, new.user_name, new.text, new.date);
    END
  `);

  // Metadata table for tracking fetch progress
  _db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Index for thread lookups
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON messages(thread_ts)
  `);
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date)
  `);

  // Documents table — stores extracted text from shared files
  _db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_ts TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      file_id TEXT UNIQUE,
      file_name TEXT NOT NULL,
      file_type TEXT,
      mime_type TEXT,
      file_size INTEGER,
      title TEXT,
      extracted_text TEXT,
      caption TEXT,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      file_name,
      title,
      extracted_text,
      caption,
      user_name UNINDEXED,
      date UNINDEXED,
      content=documents,
      content_rowid=id,
      tokenize='porter unicode61'
    )
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, file_name, title, extracted_text, caption, user_name, date)
      VALUES (new.id, new.file_name, new.title, new.extracted_text, new.caption, new.user_name, new.date);
    END
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, file_name, title, extracted_text, caption, user_name, date)
      VALUES ('delete', old.id, old.file_name, old.title, old.extracted_text, old.caption, old.user_name, old.date);
    END
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, file_name, title, extracted_text, caption, user_name, date)
      VALUES ('delete', old.id, old.file_name, old.title, old.extracted_text, old.caption, old.user_name, old.date);
      INSERT INTO documents_fts(rowid, file_name, title, extracted_text, caption, user_name, date)
      VALUES (new.id, new.file_name, new.title, new.extracted_text, new.caption, new.user_name, new.date);
    END
  `);

  // Proactive log — tracks bot-initiated messages to prevent spam
  _db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT,
      text TEXT NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export interface MessageRow {
  ts: string;
  channel_id: string;
  user_id: string | null;
  user_name: string | null;
  text: string;
  thread_ts: string | null;
  reply_count: number;
  date: string;
  is_thread_reply: number;
}

export function upsertUser(
  id: string,
  name: string,
  realName?: string,
  displayName?: string
) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO users (id, name, real_name, display_name) VALUES (?, ?, ?, ?)`
  ).run(id, name, realName ?? null, displayName ?? null);
}

export function getUserName(userId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT display_name, real_name, name FROM users WHERE id = ?`)
    .get(userId) as { display_name: string; real_name: string; name: string } | undefined;
  if (!row) return null;
  return row.display_name || row.real_name || row.name;
}

export function upsertMessage(msg: MessageRow) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO messages (ts, channel_id, user_id, user_name, text, thread_ts, reply_count, date, is_thread_reply)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.ts,
    msg.channel_id,
    msg.user_id,
    msg.user_name,
    msg.text,
    msg.thread_ts,
    msg.reply_count,
    msg.date,
    msg.is_thread_reply
  );
}

export function setMeta(key: string, value: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`
  ).run(key, value);
}

export function getMeta(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM metadata WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Sanitize a query for FTS5 — escape special characters so hyphens,
 * colons, etc. aren't treated as operators.
 */
function sanitizeFtsQuery(raw: string): string {
  // If the user already used explicit FTS5 syntax (AND, OR, NOT, quotes), pass through
  if (/\b(AND|OR|NOT)\b/.test(raw) || raw.includes('"')) {
    return raw;
  }
  // Otherwise, wrap each token in quotes to make them literal
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ");
}

/**
 * Run a single FTS5 query with filters. Returns matched rows.
 */
function runFtsQuery(
  db: Database.Database,
  ftsQuery: string,
  opts: { limit?: number; user?: string; dateFrom?: string; dateTo?: string }
): MessageRow[] {
  const limit = opts.limit ?? 30;
  let sql = `
    SELECT m.ts, m.channel_id, m.user_id, m.user_name, m.text,
           m.thread_ts, m.reply_count, m.date, m.is_thread_reply,
           rank
    FROM messages_fts f
    JOIN messages m ON m.rowid = f.rowid
    WHERE messages_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];

  if (opts.user) {
    sql += ` AND m.user_name LIKE ?`;
    params.push(`%${opts.user}%`);
  }
  if (opts.dateFrom) {
    sql += ` AND m.date >= ?`;
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    sql += ` AND m.date <= ?`;
    params.push(opts.dateTo);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    return db.prepare(sql).all(...params) as MessageRow[];
  } catch {
    return [];
  }
}

/**
 * Full-text search across messages.
 * Returns messages ranked by relevance (BM25).
 *
 * FTS5 requires ALL terms to match (implicit AND). When a multi-word query
 * returns nothing, we progressively drop one word at a time and retry,
 * staying in FTS5 for better ranking before falling to LIKE fallback.
 */
export function searchMessages(
  query: string,
  opts: { limit?: number; user?: string; dateFrom?: string; dateTo?: string } = {}
): MessageRow[] {
  const db = getDb();
  const ftsQuery = sanitizeFtsQuery(query);

  // Try the full query first
  let results = runFtsQuery(db, ftsQuery, opts);
  if (results.length > 0) return results;

  // Full AND query returned nothing — try dropping one word at a time.
  // Try ALL subsets and pick the most specific (fewest results = most precise).
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    let bestResults: MessageRow[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const subset = tokens.filter((_, j) => j !== i);
      const subQuery = sanitizeFtsQuery(subset.join(" "));
      const subResults = runFtsQuery(db, subQuery, opts);
      if (subResults.length > 0) {
        if (bestResults.length === 0 || subResults.length < bestResults.length) {
          bestResults = subResults;
        }
      }
    }
    if (bestResults.length > 0) return bestResults;
  }

  return [];
}

/**
 * Fallback search using LIKE when FTS5 returns no results.
 * Searches each word independently (OR logic) across messages.
 */
export function searchMessagesFallback(
  query: string,
  opts: { limit?: number; user?: string; dateFrom?: string; dateTo?: string } = {}
): MessageRow[] {
  const db = getDb();
  const limit = opts.limit ?? 30;
  const words = query.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];

  const likeClauses = words.map(() => `m.text LIKE ?`);
  let sql = `
    SELECT m.ts, m.channel_id, m.user_id, m.user_name, m.text,
           m.thread_ts, m.reply_count, m.date, m.is_thread_reply
    FROM messages m
    WHERE (${likeClauses.join(" OR ")})
  `;
  const params: (string | number)[] = words.map((w) => `%${w}%`);

  if (opts.user) {
    sql += ` AND m.user_name LIKE ?`;
    params.push(`%${opts.user}%`);
  }
  if (opts.dateFrom) {
    sql += ` AND m.date >= ?`;
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    sql += ` AND m.date <= ?`;
    params.push(opts.dateTo);
  }

  sql += ` ORDER BY m.ts DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params) as MessageRow[];
}

/**
 * Get all replies in a thread.
 */
export function getThread(threadTs: string): MessageRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE thread_ts = ? ORDER BY ts ASC`
    )
    .all(threadTs) as MessageRow[];
}

/**
 * Get messages by date range.
 */
export function getMessagesByDate(
  dateFrom: string,
  dateTo: string,
  limit = 100
): MessageRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE date >= ? AND date <= ? AND is_thread_reply = 0
       ORDER BY ts DESC LIMIT ?`
    )
    .all(dateFrom, dateTo, limit) as MessageRow[];
}

/**
 * Get messages by a specific user.
 */
export function getMessagesByUser(userName: string, limit = 50): MessageRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE user_name LIKE ? ORDER BY ts DESC LIMIT ?`
    )
    .all(`%${userName}%`, limit) as MessageRow[];
}

/**
 * Get messages newer than a given timestamp.
 */
export function getMessagesSince(sinceTs: string, limit = 100): MessageRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE ts > ? ORDER BY ts ASC LIMIT ?`
    )
    .all(sinceTs, limit) as MessageRow[];
}

/**
 * Get the latest message timestamp in the DB.
 */
export function getLatestMessageTs(): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT MAX(ts) as ts FROM messages`)
    .get() as { ts: string } | undefined;
  return row?.ts ?? null;
}

/**
 * Get total message count and date range.
 */
export function getStats(): {
  total: number;
  threads: number;
  users: number;
  earliest: string | null;
  latest: string | null;
} {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT COUNT(*) as total,
              COUNT(DISTINCT thread_ts) as threads,
              COUNT(DISTINCT user_name) as users,
              MIN(date) as earliest,
              MAX(date) as latest
       FROM messages`
    )
    .get() as any;
  return stats;
}

// --- Documents ---

export interface DocumentRow {
  id: number;
  message_ts: string;
  channel_id: string;
  user_id: string | null;
  user_name: string | null;
  file_id: string;
  file_name: string;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  title: string | null;
  extracted_text: string | null;
  caption: string | null;
  date: string;
  created_at: string;
}

export function upsertDocument(doc: Omit<DocumentRow, "id" | "created_at">) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO documents
     (message_ts, channel_id, user_id, user_name, file_id, file_name, file_type, mime_type, file_size, title, extracted_text, caption, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    doc.message_ts, doc.channel_id, doc.user_id, doc.user_name,
    doc.file_id, doc.file_name, doc.file_type, doc.mime_type,
    doc.file_size, doc.title, doc.extracted_text, doc.caption, doc.date
  );
}

export function searchDocuments(
  query: string,
  opts: { limit?: number; user?: string; fileType?: string } = {}
): DocumentRow[] {
  const db = getDb();
  const limit = opts.limit ?? 10;
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ");

  let sql = `
    SELECT d.* FROM documents_fts f
    JOIN documents d ON d.id = f.rowid
    WHERE documents_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];

  if (opts.user) {
    sql += ` AND d.user_name LIKE ?`;
    params.push(`%${opts.user}%`);
  }
  if (opts.fileType) {
    sql += ` AND d.file_type LIKE ?`;
    params.push(`%${opts.fileType}%`);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    return db.prepare(sql).all(...params) as DocumentRow[];
  } catch {
    return [];
  }
}

// --- Proactive log ---

export function logProactiveAction(
  type: string,
  channelId: string,
  threadTs: string | null,
  text: string,
  reason: string | null
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO proactive_log (type, channel_id, thread_ts, text, reason)
     VALUES (?, ?, ?, ?, ?)`
  ).run(type, channelId, threadTs, text, reason);
}

export function getLastProactiveAction(
  type: string
): { created_at: string } | null {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT created_at FROM proactive_log WHERE type = ? ORDER BY id DESC LIMIT 1`
      )
      .get(type) as { created_at: string } | undefined
  ) ?? null;
}

export function getDigestStatus(date: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM proactive_log WHERE type = 'daily_digest' AND created_at >= ? LIMIT 1`
    )
    .get(date + "T00:00:00");
  return !!row;
}

/**
 * Count proactive actions of a given type today.
 */
export function countProactiveActionsToday(type: string, todayDate: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM proactive_log WHERE type = ? AND created_at >= ?`
    )
    .get(type, todayDate + "T00:00:00") as { cnt: number };
  return row.cnt;
}

/**
 * Get recent proactive messages for anti-repetition.
 */
export function getRecentProactiveMessages(limit = 5): { text: string; type: string; created_at: string }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT text, type, created_at FROM proactive_log
       WHERE type IN ('proactive', 'nudge', 'morning_greeting', 'eod_highlights')
       ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as { text: string; type: string; created_at: string }[];
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
