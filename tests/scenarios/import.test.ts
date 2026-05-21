import { describe, it, expect } from 'vitest';
import { parseChromeBookmarks, deduplicateByUrl } from '../../src/importer/chrome-html.js';
import type { RawBookmark } from '../../src/types.js';
import path from 'node:path';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const sampleHtml = path.join(fixturesDir, 'sample-bookmarks.html');

// import.md 验收标准驱动的端到端场景测试
describe('导入流程 — import.md 验收标准', () => {
  // 验收标准1: 正确提取 href、标题、ADD_DATE
  it('从 Chrome HTML 提取书签信息', () => {
    const bookmarks = parseChromeBookmarks(sampleHtml);
    const github = bookmarks.find(b => b.url === 'https://github.com');
    expect(github).toBeDefined();
    expect(github!.title).toBe('GitHub');
    expect(github!.add_date).toBe(1700000002);
  });

  // 验收标准2: javascript:/place:/data:/about:/空 被过滤
  it('无效 scheme 和空 href 被过滤', () => {
    const bookmarks = parseChromeBookmarks(sampleHtml);
    const urls = bookmarks.map(b => b.url);
    expect(urls.some(u => u.startsWith('javascript:'))).toBe(false);
    expect(urls.some(u => u === '')).toBe(false);
    // 样本文件有 javascript:void(0) 和空 href，都被跳过
  });

  // 验收标准3: 空标题回退 hostname
  it('空标题回退为 URL hostname', () => {
    const bookmarks = parseChromeBookmarks(sampleHtml);
    const noTitle = bookmarks.find(b => b.url === 'https://example.com/no-title');
    expect(noTitle?.title).toBe('example.com');
  });

  // 验收标准4: URL 去重保留最新 add_date
  it('相同 URL 去重，保留最新 add_date', () => {
    const bookmarks: RawBookmark[] = [
      { url: 'https://dup.com', title: 'Old', original_folder: '', add_date: 100 },
      { url: 'https://dup.com', title: 'New', original_folder: '', add_date: 200 },
      { url: 'https://unique.com', title: 'Unique', original_folder: '', add_date: 150 },
    ];
    const result = deduplicateByUrl(bookmarks);
    expect(result).toHaveLength(2);
    expect(result.find(b => b.url === 'https://dup.com')?.title).toBe('New');
  });

  // 验收标准6: 文件不存在抛错
  it('文件不存在时抛错', () => {
    expect(() => parseChromeBookmarks('/nonexistent/file.html')).toThrow();
  });

  // 端到端: parse + dedup 联动
  it('完整导入流程: 解析 → 去重', () => {
    const parsed = parseChromeBookmarks(sampleHtml);
    const deduped = deduplicateByUrl(parsed);
    // 样本文件有 2 条 https://example.com/dup，去重后剩 1 条
    expect(deduped.filter(b => b.url === 'https://example.com/dup')).toHaveLength(1);
    expect(deduped.length).toBeLessThan(parsed.length);
  });
});
