import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { v4 as uuid } from 'uuid';
import type { Bookmark, BookmarkStatus } from '../types.js';

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function insertBookmarks(db: Database, bookmarks: Array<{
  id?: string;
  url: string;
  title: string;
  original_folder: string;
  add_date: number | null;
  created_at?: string;
  updated_at?: string;
}>): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO bookmarks
      (id, url, title, original_folder, add_date, status, is_duplicate,
       tags, category, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, '[]', NULL, ?, ?)
  `);

  const insertAll = db.transaction((items: typeof bookmarks) => {
    let count = 0;
    for (const b of items) {
      const id = b.id || uuid();
      const createdAt = b.created_at || now();
      const result = stmt.run(
        id, b.url, b.title, b.original_folder, b.add_date,
        createdAt, createdAt,
      );
      if (result.changes > 0) count++;
    }
    return count;
  });

  return insertAll(bookmarks);
}

export function getBookmarksByStatus(
  db: Database,
  status: BookmarkStatus,
  limit?: number,
): Bookmark[] {
  const sql = limit
    ? 'SELECT * FROM bookmarks WHERE status = ? LIMIT ?'
    : 'SELECT * FROM bookmarks WHERE status = ?';
  const params = limit ? [status, limit] : [status];
  return db.prepare(sql).all(...params) as Bookmark[];
}

export function getBookmarksForScan(db: Database, options?: { force?: boolean; limit?: number; offset?: number }): Bookmark[] {
  let sql: string;
  const params: unknown[] = [];

  if (options?.force) {
    sql = "SELECT * FROM bookmarks WHERE status != 'deep_done'";
  } else {
    sql = "SELECT * FROM bookmarks WHERE status = 'pending'";
  }

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset) {
    if (!options?.limit) {
      sql += ' LIMIT -1'; // SQLite needs LIMIT before OFFSET
    }
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  return db.prepare(sql).all(...params) as Bookmark[];
}

export function getBookmarksForLinkCheck(db: Database, options?: { force?: boolean; limit?: number; offset?: number }): Bookmark[] {
  let sql: string;
  const params: unknown[] = [];

  if (options?.force) {
    sql = "SELECT * FROM bookmarks WHERE status != 'dead'";
  } else {
    sql = "SELECT * FROM bookmarks WHERE status = 'pending'";
  }

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset) {
    if (!options?.limit) {
      sql += ' LIMIT -1';
    }
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  return db.prepare(sql).all(...params) as Bookmark[];
}

export function getBookmarksForDeep(db: Database, options?: { force?: boolean; limit?: number; offset?: number; category?: string }): Bookmark[] {
  let sql: string;
  const params: unknown[] = [];

  if (options?.force) {
    sql = 'SELECT * FROM bookmarks WHERE 1=1';
  } else {
    sql = "SELECT * FROM bookmarks WHERE status != 'deep_done'";
  }

  if (options?.category) {
    sql += ' AND category = ?';
    params.push(options.category);
  }
  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset) {
    if (!options?.limit) {
      sql += ' LIMIT -1';
    }
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  return db.prepare(sql).all(...params) as Bookmark[];
}

export function getBookmarksForClassify(db: Database, options?: { force?: boolean }): Bookmark[] {
  const sql = options?.force
    ? 'SELECT * FROM bookmarks'
    : 'SELECT * FROM bookmarks WHERE category IS NULL';
  return db.prepare(sql).all() as Bookmark[];
}

export function updateBookmark(
  db: Database,
  id: string,
  fields: Partial<Bookmark>,
): void {
  const entries = Object.entries(fields).filter(([k]) => k !== 'id');
  if (entries.length === 0) return;

  entries.push(['updated_at', now()]);
  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);

  db.prepare(`UPDATE bookmarks SET ${setClause} WHERE id = ?`)
    .run(...values, id);
}

export function updateBookmarkResult(
  db: Database,
  id: string,
  data: {
    tags: string;
    confidence: number;
    category: string;
    subcategory?: string | null;
    value_score: number;
    ai_model: string;
    status: BookmarkStatus;
    description?: string;
    summary?: string;
  },
): void {
  const processedAt = now();
  db.prepare(`
    UPDATE bookmarks SET
      tags = ?, confidence = ?, category = ?, subcategory = ?, value_score = ?,
      ai_model = ?, status = ?, description = COALESCE(?, description),
      summary = COALESCE(?, summary), processed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.tags, data.confidence, data.category, data.subcategory ?? null, data.value_score,
    data.ai_model, data.status, data.description ?? null,
    data.summary ?? null, processedAt, processedAt, id,
  );
}

export function markDuplicates(db: Database): number {
  const result = db.prepare(`
    UPDATE bookmarks SET is_duplicate = 1
    WHERE id IN (
      SELECT b2.id FROM bookmarks b2
      INNER JOIN (
        SELECT url, MAX(add_date) as latest FROM bookmarks GROUP BY url HAVING COUNT(*) > 1
      ) dup ON b2.url = dup.url AND b2.add_date < dup.latest
    )
  `).run();
  return result.changes;
}

export function deleteBookmarks(db: Database, ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

export function getStats(db: Database): {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
} {
  const total = (db.prepare('SELECT COUNT(*) as count FROM bookmarks').get() as { count: number }).count;

  const statusRows = db.prepare('SELECT status, COUNT(*) as count FROM bookmarks GROUP BY status')
    .all() as { status: string; count: number }[];
  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  const categoryRows = db.prepare('SELECT category, COUNT(*) as count FROM bookmarks GROUP BY category')
    .all() as { category: string; count: number }[];
  const byCategory: Record<string, number> = {};
  for (const row of categoryRows) {
    byCategory[row.category ?? 'null'] = row.count;
  }

  return { total, byStatus, byCategory };
}

export function getPendingCount(db: Database): number {
  return (db.prepare("SELECT COUNT(*) as count FROM bookmarks WHERE status = 'pending'")
    .get() as { count: number }).count;
}

export function getBookmarksFiltered(db: Database, options?: {
  page?: number;
  pageSize?: number;
  category?: string;
  tag?: string;
  status?: string;
  q?: string;
  sort?: string;
  dir?: 'ASC' | 'DESC';
}): { data: Bookmark[]; total: number } {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 50;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.category) {
    conditions.push('category = ?');
    params.push(options.category);
  }
  if (options?.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${options.tag}"%`);
  }
  if (options?.status) {
    if (options.status.includes(',')) {
      const statuses = options.status.split(',').map(s => s.trim()).filter(Boolean);
      const placeholders = statuses.map(() => '?').join(',');
      conditions.push(`status IN (${placeholders})`);
      params.push(...statuses);
    } else {
      conditions.push('status = ?');
      params.push(options.status);
    }
  }
  if (options?.q) {
    conditions.push('(title LIKE ? OR url LIKE ?)');
    params.push(`%${options.q}%`, `%${options.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM bookmarks ${where}`)
    .get(...params) as { count: number }).count;

  const allowedSort = new Set(['updated_at', 'title', 'category', 'status', 'add_date', 'processed_at', 'created_at']);
  const sortCol = allowedSort.has(options?.sort ?? '') ? options!.sort : 'updated_at';
  const sortDir = options?.dir === 'ASC' ? 'ASC' : 'DESC';
  // add_date is stored as INTEGER, processed_at as TEXT
  const orderBy = sortCol === 'processed_at'
    ? `ORDER BY COALESCE(processed_at, '') ${sortDir} NULLS LAST`
    : sortCol === 'add_date'
      ? `ORDER BY COALESCE(add_date, 0) ${sortDir}`
      : `ORDER BY ${sortCol} ${sortDir}`;

  const offset = (page - 1) * pageSize;
  const data = db.prepare(
    `SELECT * FROM bookmarks ${where} ${orderBy} LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as Bookmark[];

  return { data, total };
}

export function getAllCategories(db: Database): string[] {
  const rows = db.prepare(
    "SELECT category FROM bookmarks WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY COUNT(*) DESC",
  ).all() as { category: string }[];
  return rows.map(r => r.category);
}

export function getAllTags(db: Database): string[] {
  const rows = db.prepare('SELECT tags FROM bookmarks WHERE tags != \'[]\'')
    .all() as { tags: string }[];
  const freq: Record<string, number> = {};
  for (const row of rows) {
    try {
      const tags: string[] = JSON.parse(row.tags);
      for (const t of tags) {
        freq[t] = (freq[t] ?? 0) + 1;
      }
    } catch { /* skip invalid JSON */ }
  }
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .map(([tag]) => tag);
}
