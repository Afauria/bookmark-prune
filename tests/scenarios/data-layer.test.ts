import { describe, it, expect, beforeEach } from 'vitest';
import { CREATE_TABLE_SQL, CREATE_INDEXES_SQL } from '../../src/db/schema.js';
import {
  insertBookmarks,
  getBookmarksForScan,
  getBookmarksForDeep,
  getBookmarksForLinkCheck,
  getBookmarksForClassify,
  updateBookmark,
  updateBookmarkResult,
  markDuplicates,
  getBookmarksFiltered,
  getStats,
} from '../../src/db/repository.js';

// 检测原生模块是否可用
let Database: typeof import('better-sqlite3');
let nativeAvailable = true;
try {
  Database = (await import('better-sqlite3')).default;
  const t = new Database(':memory:');
  t.close();
} catch {
  nativeAvailable = false;
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(CREATE_TABLE_SQL);
  for (const sql of CREATE_INDEXES_SQL) db.exec(sql);
  return db;
}

function insert(db: ReturnType<typeof createDb>, overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? crypto.randomUUID();
  const url = (overrides.url as string) ?? `https://example.com/${id.slice(0, 8)}`;
  insertBookmarks(db, [{
    id, url,
    title: (overrides.title as string) ?? 'Test',
    original_folder: '',
    add_date: (overrides.add_date as number) ?? 1000000,
  }]);
  // Apply status/category/tags overrides via update
  if (overrides.status) updateBookmark(db, id, { status: overrides.status as 'scan_done' });
  if (overrides.category !== undefined) updateBookmark(db, id, { category: overrides.category as string | null });
  if (overrides.tags) updateBookmark(db, id, { tags: overrides.tags as string });
  return id;
}

// scan.md / classify.md / check-links.md 验收标准 — 数据层语义
describe.skipIf(!nativeAvailable)('数据层状态流转与查询语义', () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => { db = createDb(); });

  // 幂等: INSERT OR IGNORE 按 id (PK) 去重
  it('相同 id 重复插入被忽略（幂等）', () => {
    const id = 'fixed-id-001';
    expect(insertBookmarks(db, [
      { id, url: 'https://dup.com', title: 'A', original_folder: '', add_date: 1 },
    ])).toBe(1);
    expect(insertBookmarks(db, [
      { id, url: 'https://dup.com', title: 'B', original_folder: '', add_date: 2 },
    ])).toBe(0);
  });

  // scan.md 验收标准: 各模式的查询语义
  it('scan 查询: pending(默认), force(非 deep_done)', () => {
    insert(db, { status: 'pending' });
    insert(db, { status: 'scan_done' });
    insert(db, { status: 'deep_done' });
    expect(getBookmarksForScan(db)).toHaveLength(1);
    expect(getBookmarksForScan(db, { force: true })).toHaveLength(2);
  });

  // scan.md 验收标准: deep 不覆盖 deep_done
  it('deep 查询: 非 deep_done(默认), force(全部)', () => {
    insert(db, { status: 'deep_done' });
    insert(db, { status: 'pending' });
    expect(getBookmarksForDeep(db)).toHaveLength(1); // deep_done 被排除
    expect(getBookmarksForDeep(db, { force: true })).toHaveLength(2);
  });

  // check-links.md: dead 始终跳过
  it('link-check 查询: pending(默认), force(非 dead)', () => {
    insert(db, { status: 'pending' });
    insert(db, { status: 'dead' });
    insert(db, { status: 'error' });
    expect(getBookmarksForLinkCheck(db)).toHaveLength(1);
    expect(getBookmarksForLinkCheck(db, { force: true })).toHaveLength(2);
  });

  // classify.md 验收标准: classify 不改 status
  it('classify 查询: category IS NULL(默认), force(全部)', () => {
    insert(db, { category: null });
    insert(db, { category: 'AI' });
    expect(getBookmarksForClassify(db)).toHaveLength(1);
    expect(getBookmarksForClassify(db, { force: true })).toHaveLength(2);
  });

  // scan.md: deep 覆盖 fast 时 COALESCE 保留 description
  it('updateBookmarkResult: deep 覆盖 fast，COALESCE 保留 description', () => {
    const id = insert(db);
    // fast 扫描
    updateBookmarkResult(db, id, {
      tags: '["React"]', confidence: 0.8, category: '前端', value_score: 7,
      ai_model: 'gpt-4', status: 'scan_done', description: 'fast desc',
    });
    // deep 扫描覆盖，description 传 null → COALESCE 保留 fast 的值
    updateBookmarkResult(db, id, {
      tags: '["React","Hook"]', confidence: 0.95, category: '前端', subcategory: 'React',
      value_score: 9, ai_model: 'gpt-4', status: 'deep_done', description: null,
      summary: 'deep summary',
    });
    const stats = getStats(db);
    const bm = getBookmarksFiltered(db, { status: 'deep_done' }).data[0];
    expect(bm.tags).toBe('["React","Hook"]');
    expect(bm.description).toBe('fast desc'); // COALESCE 保留
    expect(bm.summary).toBe('deep summary');
  });

  // dedup.md: markDuplicates
  it('markDuplicates 标记旧记录', () => {
    insertBookmarks(db, [
      { url: 'https://dup.com', title: 'Old', original_folder: '', add_date: 100 },
      { url: 'https://dup.com', title: 'New', original_folder: '', add_date: 200 },
    ]);
    expect(markDuplicates(db)).toBe(1);
  });

  // 过滤查询: 多维度 + 分页
  it('过滤查询: category/tag/status/keyword + 分页', () => {
    for (let i = 0; i < 5; i++) insert(db, { status: 'pending', title: `Bookmark ${i}` });
    const id = insert(db, { status: 'pending', title: 'React Tutorial' });
    updateBookmark(db, id, { tags: '["React"]', category: '前端' });

    // category 过滤
    expect(getBookmarksFiltered(db, { category: '前端' }).total).toBe(1);
    // tag 过滤
    expect(getBookmarksFiltered(db, { tag: 'React' }).total).toBe(1);
    // keyword 过滤
    expect(getBookmarksFiltered(db, { q: 'React' }).total).toBe(1);
    // 分页
    const page = getBookmarksFiltered(db, { page: 1, pageSize: 3 });
    expect(page.data).toHaveLength(3);
    expect(page.total).toBe(6);
  });
});
