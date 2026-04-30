import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { FetchedContent } from '../types.js';
import { logger } from '../utils/logger.js';

export function urlToCacheKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Selectors for article body content (prefer these over Readability when available)
const ARTICLE_BODY_SELECTORS = [
  '#content_views', '#article_content', '.article-content',
  '#article-body', '.post-content', '.entry-content',
  '.article_content', '.blog-post-body', '#js_content',
];

// Lines matching these patterns are site metadata noise, not article content
const NOISE_PATTERNS = [
  /推荐文章于.*发布/,
  /^\d{4}-\d{2}-\d{2}/,
  /^\d+k?\s*(阅读|views?|reads?)/i,
  /^(原创|转载|翻译)$/,
  /^\d+$/,           // standalone numbers (like/comment counts)
  /^[·\s]+$/,        // just dots
];

function cleanContent(raw: string): string {
  return raw
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => {
      if (line.length === 0) return false;
      return !NOISE_PATTERNS.some(p => p.test(line));
    })
    .join('\n');
}

function extractBodyText(doc: Document): string {
  for (const sel of ARTICLE_BODY_SELECTORS) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const text = cleanContent(el.textContent ?? '');
    if (text.length > 50) return text;
  }
  return '';
}

export function extractContent(html: string, url: string): { content: string; title: string } {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  let content = cleanContent(article?.textContent ?? '');
  const title = article?.title ?? '';

  // Try selector-based extraction: often cleaner than Readability (less metadata noise)
  const bodyText = extractBodyText(dom.window.document);
  if (bodyText.length > 50 && bodyText.length >= content.length * 0.4) {
    content = bodyText;
  }

  if (content.length < 50) {
    const articleEl = dom.window.document.querySelector('article');
    if (articleEl) {
      const articleText = cleanContent(articleEl.textContent ?? '');
      if (articleText.length > content.length) {
        content = articleText;
      }
    }
  }

  return { content, title };
}

interface CacheEntry {
  url: string;
  content: string;
  title: string;
  cachedAt: string;
}

export function cacheToDisk(cacheDir: string, id: string, data: { url: string; title: string; content: string }): void {
  if (!data.content) return;
  const cachePath = path.join(cacheDir, `${id}.json`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const entry: CacheEntry = { url: data.url, content: data.content, title: data.title, cachedAt: new Date().toISOString() };
  fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2));
}

export function readCache(cacheDir: string, id: string): CacheEntry | null {
  const cachePath = path.join(cacheDir, `${id}.json`);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheEntry;
  } catch {
    return null;
  }
}

export async function fetchContent(
  url: string,
  timeout: number,
  cacheDir?: string,
  id?: string,
): Promise<FetchedContent> {
  // Check cache
  if (cacheDir && id) {
    const cached = readCache(cacheDir, id);
    if (cached) {
      return { url, content: cached.content, title: cached.title, success: true };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_UA,
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        url,
        content: '',
        title: '',
        success: false,
        error: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    logger.info(`[content-fetcher] ${url} — HTML ${html.length} bytes`);

    const { content, title } = extractContent(html, url);
    logger.info(`[content-fetcher] ${url} — content ${content.length} chars, title: "${title}"`);

    // Save to cache
    if (cacheDir && content && id) {
      cacheToDisk(cacheDir, id, { url, title, content });
    }

    return { url, content, title, success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    logger.warn(`Fetch failed: ${url} — ${errorMsg}`);
    return {
      url,
      content: '',
      title: '',
      success: false,
      error: errorMsg,
    };
  }
}
