import type BetterSqlite3 from 'better-sqlite3';
import type { AppConfig, Settings, BatchResult, Bookmark } from '../types.js';
import { getBookmarksForScan, getBookmarksForDeep, updateBookmark, updateBookmarkResult } from '../db/repository.js';
import { classify } from './classifier.js';
import { processBatch } from '../ai/batch.js';
import { createProvider } from '../ai/provider.js';
import { loadPrompt, buildScanPrompt, buildDeepPrompt } from '../config/prompts.js';
import { getAllowedTags } from '../config/loader.js';
import { checkLinks } from '../crawler/link-checker.js';
import { extractContent, cacheToDisk, readCache } from '../crawler/content-fetcher.js';
import { logger } from '../utils/logger.js';

const SCAN_BATCH_SIZE = 10;

export async function runScan(options: {
  config: AppConfig;
  settings: Settings;
  db: BetterSqlite3.Database;
  mode: 'fast' | 'deep';
  limit?: number;
  offset?: number;
  force?: boolean;
  category?: string;
  url?: string;
  ids?: string[];
}): Promise<BatchResult> {
  const { config, settings, db, mode, limit, offset, force, category, url, ids } = options;

  // Query bookmarks based on mode
  let bookmarks: Bookmark[];
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',');
    const statusFilter = mode === 'deep' ? '' : " AND status != 'deep_done'";
    bookmarks = db.prepare(
      `SELECT * FROM bookmarks WHERE id IN (${placeholders})${statusFilter}`,
    ).all(...ids) as Bookmark[];
  } else if (url) {
    bookmarks = mode === 'deep'
      ? getBookmarksForDeep(db, { force: true }).filter(b => b.url === url)
      : getBookmarksForScan(db, { force: true }).filter(b => b.url === url);
  } else if (mode === 'deep') {
    bookmarks = getBookmarksForDeep(db, { force, limit, offset, category });
  } else {
    bookmarks = getBookmarksForScan(db, { force, limit, offset });
  }

  if (bookmarks.length === 0) {
    logger.info('No bookmarks to scan');
    return { success: 0, failed: 0, skipped: 0 };
  }

  const total = bookmarks.length;
  bookmarks = interleaveByDomain(bookmarks);
  logger.info(`Scanning ${total} bookmarks (${mode} mode)...`);

  const provider = await createProvider(settings);
  const allowedTags = getAllowedTags(config);
  const techTags = config.tags.tech;
  const aiModel = settings.ai[settings.ai.provider]?.model ?? 'unknown';
  const promptTemplate = loadPrompt(mode);

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDead = 0;
  let totalError = 0;
  let totalEmpty = 0;

  for (let i = 0; i < total; i += SCAN_BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + SCAN_BATCH_SIZE);
    const batchNum = Math.floor(i / SCAN_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / SCAN_BATCH_SIZE);
    logger.info(`--- Batch ${batchNum}/${totalBatches} (${batch.length} bookmarks) ---`);

    const cacheDir = settings.storage.cache;
    const pageData = new Map<string, { url: string; title: string; content: string }>();
    const toCheck: Bookmark[] = [];

    // Step 1: Check DB content + disk cache → populate pageData, skip HTTP for cached
    for (const b of batch) {
      if (b.content) {
        pageData.set(b.id, { url: b.url, title: b.title, content: b.content });
      } else {
        const cached = readCache(cacheDir, b.id);
        if (cached) {
          pageData.set(b.id, { url: cached.url || b.url, title: cached.title, content: cached.content });
        } else {
          toCheck.push(b);
        }
      }
    }
    const cachedCount = pageData.size;
    if (cachedCount > 0) {
      logger.info(`[cache] ${cachedCount} bookmarks loaded from DB/disk cache`);
    }

    // Step 2: Link check non-cached URLs only
    let alive: Bookmark[] = batch.filter(b => pageData.has(b.id));

    if (toCheck.length > 0) {
      const linkResults = await checkLinks(
        toCheck.map(b => b.url),
        settings.thresholds.dead_link_timeout,
        toCheck.length,
      );

      // Step 3: Process link check results → extract content → pageData + disk cache
      for (const b of toCheck) {
        const result = linkResults.get(b.url);
        if (result?.status === 'alive') {
          if (result.finalUrl) {
            const existing = db.prepare('SELECT original_url FROM bookmarks WHERE id = ?').get(b.id) as { original_url: string | null } | undefined;
            if (!existing?.original_url) {
              updateBookmark(db, b.id, { url: result.finalUrl, original_url: b.url });
            } else {
              updateBookmark(db, b.id, { url: result.finalUrl });
            }
            logger.info(`Redirect: ${b.url} → ${result.finalUrl}`);
            b.url = result.finalUrl;
          }
          // Extract content → pageData → disk cache
          const html = result.content ?? '';
          const { content, title } = extractContent(html, b.url);
          const data = { url: b.url, title: title || b.title, content };
          pageData.set(b.id, data);
          cacheToDisk(cacheDir, b.id, data);
          updateBookmark(db, b.id, { content });
          alive.push(b);
        } else if (result?.status === 'dead') {
          updateBookmark(db, b.id, { status: 'dead' });
          totalDead++;
          logger.warn(`Dead link: ${b.url}`);
        } else {
          updateBookmark(db, b.id, { status: 'error' });
          totalError++;
          logger.warn(`Link check error (${result?.httpStatus ?? 'timeout'}): ${b.url}`);
        }
      }
    }

    if (alive.length === 0) continue;

    // Step 4: Filter for deep mode (needs content)
    let toProcess = alive;
    if (mode === 'deep') {
      toProcess = alive.filter(b => pageData.get(b.id)?.content);
      for (const b of alive) {
        if (!pageData.get(b.id)?.content) {
          updateBookmark(db, b.id, { status: 'empty' });
          totalEmpty++;
        }
      }
      if (totalEmpty > 0) {
        logger.info(`Empty content: ${totalEmpty} bookmarks`);
      }
      if (toProcess.length === 0) continue;
    }

    // Step 5: AI processing
    const prompt = mode === 'deep'
      ? buildDeepPrompt(promptTemplate, config, toProcess.map(b => ({
          url: pageData.get(b.id)!.url,
          title: pageData.get(b.id)!.title,
          content: pageData.get(b.id)!.content,
        })))
      : buildScanPrompt(promptTemplate, config, toProcess);

    logger.info(`[PROMPT]\n${prompt}\n[/PROMPT]`);

    const { results, batchResult } = await processBatch(
      toProcess,
      provider,
      prompt,
      allowedTags,
      settings.ai.batch,
      mode === 'deep' ? 'deep' : 'fast',
    );

    // Step 6: Apply results + classify
    if (batchResult.failedIds?.length) {
      for (const id of batchResult.failedIds) {
        updateBookmark(db, id, { status: 'error' });
      }
    }

    for (const bookmark of toProcess) {
      const output = results.get(bookmark.id);
      if (!output) continue;

      logger.info(`[AI] ${bookmark.url.slice(0, 80)} → tags: ${JSON.stringify(output.tags)}, confidence: ${output.confidence}, value_score: ${output.value_score}`);

      const tagsJson = JSON.stringify(output.tags);
      const classifyResult = classify(
        { url: bookmark.url, title: bookmark.title, tags: tagsJson },
        config.classification_rules,
        techTags,
      );

      logger.info(`[CLASSIFY] ${bookmark.url.slice(0, 80)} → ${classifyResult.category}/${classifyResult.subcategory}`);

      updateBookmarkResult(db, bookmark.id, {
        tags: tagsJson,
        confidence: output.confidence,
        category: classifyResult.category,
        value_score: output.value_score,
        ai_model: aiModel,
        status: mode === 'deep' ? 'deep_done' : 'scan_done',
        description: output.description,
        summary: output.summary,
        subcategory: classifyResult.subcategory,
      });
    }

    totalSuccess += results.size;
    totalFailed += batchResult.failed;
    totalSkipped += batchResult.skipped;
  }

  return {
    success: totalSuccess,
    failed: totalFailed + totalError,
    skipped: totalSkipped,
    dead: totalDead,
    empty: totalEmpty,
  };
}

function interleaveByDomain(bookmarks: Bookmark[]): Bookmark[] {
  const groups = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    let domain: string;
    try { domain = new URL(b.url).hostname; } catch { domain = ''; }
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(b);
  }

  const sorted: Bookmark[] = [];
  const queues = [...groups.values()];
  while (true) {
    let added = false;
    for (const q of queues) {
      if (q.length > 0) {
        sorted.push(q.shift()!);
        added = true;
      }
    }
    if (!added) break;
  }
  return sorted;
}
