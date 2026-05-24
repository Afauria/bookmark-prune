export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  original_url TEXT DEFAULT NULL,
  title TEXT NOT NULL DEFAULT '',
  original_folder TEXT DEFAULT '',
  add_date INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tagged','error','dead')),
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
  scan_mode TEXT DEFAULT NULL CHECK(scan_mode IS NULL OR scan_mode IN ('fast','deep')),
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`.trim();

export const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status)',
  'CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url)',
  'CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category)',
  'CREATE INDEX IF NOT EXISTS idx_bookmarks_scan_mode ON bookmarks(scan_mode)',
];
