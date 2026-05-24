import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { CREATE_TABLE_SQL, CREATE_INDEXES_SQL } from '../../src/db/schema.js';
import { insertBookmarks, getStats, getBookmarks, updateBookmark, updateBookmarkResult } from '../../src/db/repository.js';

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

// 端到端场景测试（跳过 AI 调用，测试状态流转）
describe.skipIf(!nativeAvailable)('端到端状态流转测试', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('导入书签后状态为 pending', () => {
    const bookmarks = [
      { url: 'https://example.com/1', title: 'JS Tutorial', original_folder: '', add_date: 1000000 },
      { url: 'https://example.com/2', title: 'Python Guide', original_folder: '', add_date: 1000001 },
    ];

    insertBookmarks(db, bookmarks);

    const stats = getStats(db);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.pending).toBe(2);
  });

  it('状态流转：pending → tagged', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'JS Tutorial', original_folder: '', add_date: 1000000 },
    ]);

    // 模拟 fast scan 后更新
    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, {
      status: 'tagged',
      scan_mode: 'fast',
      tags: '["JavaScript"]',
      confidence: 0.9,
      category: '前端',
      value_score: 8,
    });

    const stats = getStats(db);
    expect(stats.byStatus.pending).toBeUndefined();
    expect(stats.byStatus.tagged).toBe(1);
    expect(stats.byScanMode.fast).toBe(1);

    const tagged = getBookmarks(db, { status: ['tagged'] });
    expect(tagged[0].tags).toBe('["JavaScript"]');
    expect(tagged[0].scan_mode).toBe('fast');
  });

  it('状态流转：tagged (fast) → tagged (deep)', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'JS Tutorial', original_folder: '', add_date: 1000000 },
    ]);

    // Fast scan
    let bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, {
      status: 'tagged',
      scan_mode: 'fast',
      tags: '["JavaScript"]',
      confidence: 0.9,
      category: '前端',
    });

    expect(getStats(db).byScanMode.fast).toBe(1);
    expect(getStats(db).byScanMode.deep).toBeUndefined();

    // Deep scan 升级
    bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, {
      status: 'tagged',
      scan_mode: 'deep',
      tags: '["JavaScript","ES6"]',
      confidence: 0.95,
      summary: 'Comprehensive tutorial',
      value_score: 9,
    });

    expect(getStats(db).byScanMode.fast).toBeUndefined();
    expect(getStats(db).byScanMode.deep).toBe(1);

    const deep = getBookmarks(db, { scanMode: 'deep' });
    expect(deep[0].tags).toBe('["JavaScript","ES6"]');
    expect(deep[0].summary).toBe('Comprehensive tutorial');
    expect(deep[0].confidence).toBe(0.95);
  });

  it('状态流转：pending → dead', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/dead', title: 'Dead Link', original_folder: '', add_date: 1000000 },
    ]);

    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'dead' });

    const stats = getStats(db);
    expect(stats.byStatus.pending).toBeUndefined();
    expect(stats.byStatus.dead).toBe(1);
  });

  it('状态流转：pending → error', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/timeout', title: 'Timeout Link', original_folder: '', add_date: 1000000 },
    ]);

    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'error' });

    const stats = getStats(db);
    expect(stats.byStatus.pending).toBeUndefined();
    expect(stats.byStatus.error).toBe(1);
  });

  it('状态流转：error → tagged（重试成功）', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'Retry Test', original_folder: '', add_date: 1000000 },
    ]);

    // 首次失败
    let bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'error' });

    expect(getStats(db).byStatus.error).toBe(1);

    // 重试成功
    bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, {
      status: 'tagged',
      scan_mode: 'fast',
      tags: '["Test"]',
    });

    const stats = getStats(db);
    expect(stats.byStatus.error).toBeUndefined();
    expect(stats.byStatus.tagged).toBe(1);
  });

  it('查询筛选：按状态筛选', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'Test 1', original_folder: '', add_date: 1000000 },
      { url: 'https://example.com/2', title: 'Test 2', original_folder: '', add_date: 1000001 },
      { url: 'https://example.com/3', title: 'Test 3', original_folder: '', add_date: 1000002 },
    ]);

    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'tagged' });
    updateBookmark(db, bookmarks[1].id, { status: 'dead' });

    const pending = getBookmarks(db, { status: ['pending'] });
    const tagged = getBookmarks(db, { status: ['tagged'] });
    const taggedOrDead = getBookmarks(db, { status: ['tagged', 'dead'] });

    expect(pending).toHaveLength(1);
    expect(tagged).toHaveLength(1);
    expect(taggedOrDead).toHaveLength(2);
  });

  it('查询筛选：按 scanMode 筛选', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'Test 1', original_folder: '', add_date: 1000000 },
      { url: 'https://example.com/2', title: 'Test 2', original_folder: '', add_date: 1000001 },
    ]);

    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'tagged', scan_mode: 'fast' });
    updateBookmark(db, bookmarks[1].id, { status: 'tagged', scan_mode: 'deep' });

    const fast = getBookmarks(db, { scanMode: 'fast' });
    const deep = getBookmarks(db, { scanMode: 'deep' });

    expect(fast).toHaveLength(1);
    expect(deep).toHaveLength(1);
  });

  it('查询筛选：组合筛选（status + scanMode）', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'Test 1', original_folder: '', add_date: 1000000 },
      { url: 'https://example.com/2', title: 'Test 2', original_folder: '', add_date: 1000001 },
      { url: 'https://example.com/3', title: 'Test 3', original_folder: '', add_date: 1000002 },
    ]);

    const bookmarks = getBookmarks(db, {});
    updateBookmark(db, bookmarks[0].id, { status: 'tagged', scan_mode: 'fast' });
    updateBookmark(db, bookmarks[1].id, { status: 'tagged', scan_mode: 'deep' });
    updateBookmark(db, bookmarks[2].id, { status: 'dead' });

    const taggedFast = getBookmarks(db, { status: ['tagged'], scanMode: 'fast' });
    const taggedDeep = getBookmarks(db, { status: ['tagged'], scanMode: 'deep' });

    expect(taggedFast).toHaveLength(1);
    expect(taggedDeep).toHaveLength(1);
  });

  it('COALESCE 保留 summary：deep 覆盖时保留旧值', () => {
    insertBookmarks(db, [
      { url: 'https://example.com/1', title: 'Test', original_folder: '', add_date: 1000000 },
    ]);

    // Fast scan（有 summary）
    let bookmarks = getBookmarks(db, {});
    updateBookmarkResult(db, bookmarks[0].id, {
      tags: '["JavaScript"]',
      confidence: 0.9,
      category: '前端',
      value_score: 8,
      ai_model: 'gpt-4',
      status: 'tagged',
      scanMode: 'fast',
      summary: 'Fast summary',
    });

    let result = getBookmarks(db, { status: ['tagged'] });
    expect(result[0].summary).toBe('Fast summary');

    // Deep scan（summary 为 null，应保留旧值）
    bookmarks = getBookmarks(db, {});
    updateBookmarkResult(db, bookmarks[0].id, {
      tags: '["JavaScript","ES6"]',
      confidence: 0.95,
      category: '前端',
      subcategory: 'React',
      value_score: 9,
      ai_model: 'gpt-4',
      status: 'tagged',
      scanMode: 'deep',
      summary: null,
    });

    result = getBookmarks(db, { status: ['tagged'], scanMode: 'deep' });
    expect(result[0].summary).toBe('Fast summary'); // 保留
    expect(result[0].tags).toBe('["JavaScript","ES6"]'); // 其他字段覆盖
  });
});