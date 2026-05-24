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

  // Check if migration is needed: missing scan_mode
  const hasScanMode = columnNames.includes('scan_mode');

  if (!hasScanMode) {
    // Need to add scan_mode column
    db.exec(`
      ALTER TABLE bookmarks ADD COLUMN scan_mode TEXT DEFAULT NULL CHECK(scan_mode IS NULL OR scan_mode IN ('fast','deep'));
    `);
  }

  // Migrate old status values to new ones
  db.exec(`
    UPDATE bookmarks SET status = 'tagged' WHERE status IN ('scan_done','deep_done','empty');
  `);

  // Ensure scan_mode index exists
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_bookmarks_scan_mode ON bookmarks(scan_mode)');
  } catch {
    // Index might already exist, ignore
  }
}