import { describe, it, expect, beforeEach } from 'vitest';
import { CREATE_TABLE_SQL, CREATE_INDEXES_SQL } from '../../src/db/schema.js';
import {
  insertBookmarks,
  getBookmarks,
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
  // Apply status/category/tags/scanMode overrides via update
  if (overrides.status) updateBookmark(db, id, { status: overrides.status as 'pending' | 'tagged' | 'error' | 'dead' });
  if (overrides.category !== undefined) updateBookmark(db, id, { category: overrides.category as string | null });
  if (overrides.tags) updateBookmark(db, id, { tags: overrides.tags as string });
  if (overrides.scanMode) updateBookmark(db, id, { scanMode: overrides.scanMode as 'fast' | 'deep' });
  return id;
}

// scan.md 验收标准 — 数据层语义
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

  // scan.md 验收标准: 查询语义
  it('getBookmarks: 按状态筛选', () => {
    insert(db, { status: 'pending' });
    insert(db, { status: 'tagged' });
    insert(db, { status: 'error' });
    const pending = getBookmarks(db, { status: ['pending'] });
    const pendingTagged = getBookmarks(db, { status: ['pending', 'tagged'] });
    expect(pending).toHaveLength(1);
    expect(pendingTagged).toHaveLength(2);
  });

  it('getBookmarks: 按 scanMode 筛选', () => {
    insert(db, { status: 'tagged', scanMode: 'fast' });
    insert(db, { status: 'tagged', scanMode: 'deep' });
    const fast = getBookmarks(db, { scanMode: 'fast' });
    const deep = getBookmarks(db, { scanMode: 'deep' });
    expect(fast).toHaveLength(1);
    expect(deep).toHaveLength(1);
  });

  it('getBookmarks: 组合筛选（status + scanMode）', () => {
    insert(db, { status: 'tagged', scanMode: 'fast' });
    insert(db, { status: 'tagged', scanMode: 'deep' });
    insert(db, { status: 'pending' });
    const taggedFast = getBookmarks(db, { status: ['tagged'], scanMode: 'fast' });
    expect(taggedFast).toHaveLength(1);
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

  // scan.md: deep 覆盖 fast 时 COALESCE 保留 summary
  it('updateBookmarkResult: deep 覆盖 fast，COALESCE 保留 summary', () => {
    const id = insert(db);
    // fast 扫描
    updateBookmarkResult(db, id, {
      tags: '["React"]', confidence: 0.8, category: '前端', value_score: 7,
      ai_model: 'gpt-4', status: 'tagged', scanMode: 'fast', summary: 'fast summary',
    });
    // deep 扫描覆盖，summary 传 null → COALESCE 保留 fast 的值
    updateBookmarkResult(db, id, {
      tags: '["React","Hook"]', confidence: 0.95, category: '前端', subcategory: 'React',
      value_score: 9, ai_model: 'gpt-4', status: 'tagged', scanMode: 'deep', summary: null,
    });
    const stats = getStats(db);
    const bm = getBookmarksFiltered(db, { status: 'tagged' }).data[0];
    expect(bm.tags).toBe('["React","Hook"]');
    expect(bm.summary).toBe('fast summary'); // COALESCE 保留
    expect(bm.scan_mode).toBe('deep');
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