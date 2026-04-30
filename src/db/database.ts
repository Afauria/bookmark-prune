import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { CREATE_TABLE_SQL, CREATE_INDEXES_SQL } from './schema.js';

export function initDatabase(dbPath: string): BetterSqlite3.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(CREATE_TABLE_SQL);
  for (const sql of CREATE_INDEXES_SQL) {
    db.exec(sql);
  }

  migrateSchema(db);

  return db;
}

function migrateSchema(db: BetterSqlite3.Database): void {
  const columns = db.prepare("PRAGMA table_info(bookmarks)").all() as { name: string }[];
  const columnNames = columns.map(c => c.name);

  // Check if migration is needed: missing original_url, has is_alive, or missing 'empty' in CHECK
  const hasOriginalUrl = columnNames.includes('original_url');
  const hasIsAlive = columnNames.includes('is_alive');

  if (hasOriginalUrl && !hasIsAlive) return; // Already on latest schema

  // Get current CHECK constraint to verify 'empty' is included
  if (!hasIsAlive && hasOriginalUrl) {
    // Check if 'empty' is in CHECK constraint
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'bookmarks'").get() as { sql: string } | undefined;
    if (tableInfo?.sql?.includes("'empty'")) return; // Already has empty
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks_new (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      original_url TEXT DEFAULT NULL,
      title TEXT NOT NULL DEFAULT '',
      original_folder TEXT DEFAULT '',
      add_date INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','scan_done','deep_done','error','dead','empty')),
      confidence REAL,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      description TEXT,
      summary TEXT,
      tags TEXT DEFAULT '[]',
      category TEXT,
      subcategory TEXT,
      notes TEXT,
      value_score INTEGER,
      ai_model TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Build column list for INSERT (only columns that exist in old table)
  const oldColumns = ['id', 'url', 'title', 'original_folder', 'add_date', 'status', 'confidence',
    'is_duplicate', 'content', 'description', 'summary', 'tags', 'category', 'subcategory',
    'notes', 'value_score', 'ai_model', 'processed_at', 'created_at', 'updated_at'];
  const availableColumns = oldColumns.filter(c => columnNames.includes(c));

  db.exec(`
    INSERT OR IGNORE INTO bookmarks_new (${availableColumns.join(', ')})
    SELECT ${availableColumns.join(', ')}
    FROM bookmarks;
  `);

  db.exec('DROP TABLE bookmarks;');
  db.exec('ALTER TABLE bookmarks_new RENAME TO bookmarks;');

  for (const sql of CREATE_INDEXES_SQL) {
    db.exec(sql);
  }
}
