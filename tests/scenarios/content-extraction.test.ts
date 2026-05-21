import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractContent, urlToCacheKey, cacheToDisk, readCache } from '../../src/crawler/content-fetcher.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// cache.md + scan.md 内容处理流程验证
describe('正文提取与缓存流程', () => {
  it('HTML 提取正文和标题', () => {
    const html = `
      <html><head><title>Article Title</title></head><body>
        <article>
          <h1>Article Title</h1>
          <p>${'Sufficient content paragraph for Readability to extract as the main article body. '.repeat(5)}</p>
        </article>
      </body></html>
    `;
    const { content, title } = extractContent(html, 'https://example.com/article');
    expect(content.length).toBeGreaterThan(0);
    expect(title).toBeTruthy();
  });

  it('cache key 一致性: 同 URL 产生同 key', () => {
    const key1 = urlToCacheKey('https://example.com/a');
    const key2 = urlToCacheKey('https://example.com/a');
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64);
  });

  describe('磁盘缓存流程', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-cache-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('写入 → 读取 → 命中', () => {
      cacheToDisk(tmpDir, 'id-1', { url: 'https://a.com', title: 'T', content: 'body text' });
      const cached = readCache(tmpDir, 'id-1');
      expect(cached).toMatchObject({ content: 'body text', title: 'T', url: 'https://a.com' });
      expect(cached!.cachedAt).toBeTruthy();
    });

    it('空内容不缓存', () => {
      cacheToDisk(tmpDir, 'id-2', { url: 'https://a.com', title: 'T', content: '' });
      expect(readCache(tmpDir, 'id-2')).toBeNull();
    });
  });
});
