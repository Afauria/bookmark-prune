import type BetterSqlite3 from 'better-sqlite3';
import type { AppConfig, Settings, BatchResult, Bookmark, AIOutput, BookmarkStatus, ScanMode, SkippedDetail } from '../types.js';
import { getBookmarks, updateBookmark, updateBookmarkResult } from '../db/repository.js';
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
  status?: BookmarkStatus[];
  scanMode?: ScanMode;
  ids?: string[];
}): Promise<BatchResult> {
  const { config, settings, db, mode, limit, offset, force, category, url, status, scanMode, ids } = options;

  // Step 1: Query bookmarks based on user parameters
  let bookmarks: Bookmark[];
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',');
    bookmarks = db.prepare(
      `SELECT * FROM bookmarks WHERE id IN (${placeholders})`
    ).all(...ids) as Bookmark[];
  } else if (url) {
    bookmarks = getBookmarks(db, { url }).filter(b => b.url === url);
  } else {
    bookmarks = getBookmarks(db, { status, scanMode, category, limit, offset });
  }

  if (bookmarks.length === 0) {
    logger.info('No bookmarks to scan');
    return { success: 0, failed: 0, skipped: 0, dead: 0, skippedDetails: [] };
  }

  // Step 2: Filter by force (scope of processing)
  const toScan = force
    ? bookmarks.filter(b => b.status !== 'dead')
    : bookmarks.filter(b => b.status === 'pending');

  if (toScan.length === 0) {
    logger.info('No bookmarks to process in current scope');
    return { success: 0, failed: 0, skipped: 0, dead: 0, skippedDetails: [] };
  }

  const total = toScan.length;
  const interleaved = interleaveByDomain(toScan);
  logger.info(`Scanning ${total} bookmarks (${mode} mode)...`);

  const provider = await createProvider(settings);
  const allowedTags = getAllowedTags(config);
  const techTags = config.tags.tech;
  const aiModel = settings.ai[settings.ai.provider]?.model ?? 'unknown';
  const promptTemplate = loadPrompt(mode);

  const skippedDetails: SkippedDetail[] = [];
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDead = 0;
  let totalError = 0;

  for (let i = 0; i < total; i += SCAN_BATCH_SIZE) {
    const batch = interleaved.slice(i, i + SCAN_BATCH_SIZE);
    const batchNum = Math.floor(i / SCAN_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / SCAN_BATCH_SIZE);
    logger.info(`--- Batch ${batchNum}/${totalBatches} (${batch.length} bookmarks) ---`);

    const cacheDir = settings.storage.cache;
    const pageData = new Map<string, { url: string; title: string; content: string }>();
    const toCheck: Bookmark[] = [];

    // Step 3: Check DB content + disk cache → populate pageData, skip HTTP for cached
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

    // Step 4: Link check non-cached URLs only
    let alive: Bookmark[] = batch.filter(b => pageData.has(b.id));

    if (toCheck.length > 0) {
      const linkResults = await checkLinks(
        toCheck.map(b => b.url),
        settings.thresholds.dead_link_timeout,
        toCheck.length,
      );

      // Step 5: Process link check results → extract content → pageData + disk cache
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
          skippedDetails.push({ id: b.id, url: b.url, reason: 'dead' });
          logger.warn(`Dead link: ${b.url}`);
        } else {
          updateBookmark(db, b.id, { status: 'error' });
          totalError++;
          skippedDetails.push({ id: b.id, url: b.url, reason: 'error' });
          logger.warn(`Link check error (${result?.httpStatus ?? 'timeout'}): ${b.url}`);
        }
      }
    }

    if (alive.length === 0) continue;

    // Step 6: Filter for deep mode (needs content)
    let toProcess = alive;
    if (mode === 'deep') {
      toProcess = alive.filter(b => pageData.get(b.id)?.content);
      for (const b of alive) {
        if (!pageData.get(b.id)?.content) {
          totalSkipped++;
          skippedDetails.push({ id: b.id, url: b.url, reason: 'no_content' });
          logger.info(`Skipped (no content): ${b.url}`);
        }
      }
      if (toProcess.length === 0) continue;
    }

    // Step 7 & 8: AI processing + apply results
    if (mode === 'deep') {
      // Deep: 逐篇提交，避免长正文拼合导致 AI 解析错误
      const singleBatchConfig = { ...settings.ai.batch, size: 1 };
      for (const bookmark of toProcess) {
        const data = pageData.get(bookmark.id)!;
        const singlePrompt = buildDeepPrompt(promptTemplate, config, [{
          url: data.url,
          title: data.title,
          content: data.content,
        }]);

        const { results, batchResult } = await processBatch(
          [bookmark],
          provider,
          singlePrompt,
          allowedTags,
          singleBatchConfig,
          'deep',
        );

        if (batchResult.failedIds?.includes(bookmark.id)) {
          updateBookmark(db, bookmark.id, { status: 'error' });
          totalFailed++;
          skippedDetails.push({ id: bookmark.id, url: bookmark.url, reason: 'error' });
          totalSkipped += batchResult.skipped;
          continue;
        }

        const output = results.get(bookmark.id);
        if (output) {
          applyScanResult(db, bookmark, output, config, techTags, aiModel, mode);
          totalSuccess++;
        }
      }
    } else {
      // Fast: 批量提交
      const prompt = buildScanPrompt(promptTemplate, config, toProcess);

      const { results, batchResult } = await processBatch(
        toProcess,
        provider,
        prompt,
        allowedTags,
        settings.ai.batch,
        'fast',
      );

      if (batchResult.failedIds?.length) {
        for (const id of batchResult.failedIds) {
          updateBookmark(db, id, { status: 'error' });
          totalFailed++;
          skippedDetails.push({ id, url: toProcess.find(b => b.id === id)?.url || '', reason: 'error' });
        }
      }

      for (const bookmark of toProcess) {
        const output = results.get(bookmark.id);
        if (output) {
          applyScanResult(db, bookmark, output, config, techTags, aiModel, mode);
        }
      }

      totalSuccess += results.size;
      totalSkipped += batchResult.skipped;
    }
  }

  // Print final statistics
  const totalResult = totalSuccess + totalFailed + totalSkipped + totalDead;
  logger.info(`Scan complete: success=${totalSuccess}, failed=${totalFailed}, skipped=${totalSkipped}, dead=${totalDead}, total=${totalResult}`);

  if (skippedDetails.length > 0) {
    logger.info(`┌─ Skipped details ───────────────────────────────┐`);
    for (const detail of skippedDetails) {
      const reasonText = detail.reason === 'no_content' ? 'no content' : detail.reason === 'dead' ? 'dead link' : 'error';
      logger.info(`│ ${detail.url.slice(0, 50)}... → ${reasonText}`);
    }
    logger.info(`└─────────────────────────────────────────────────┘`);
  }

  return {
    success: totalSuccess,
    failed: totalFailed + totalError,
    skipped: totalSkipped,
    dead: totalDead,
    skippedDetails,
  };
}

function applyScanResult(
  db: BetterSqlite3.Database,
  bookmark: Bookmark,
  output: AIOutput,
  config: AppConfig,
  techTags: string[],
  aiModel: string,
  mode: 'fast' | 'deep',
) {
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
    status: 'tagged',
    scanMode: mode,
    summary: output.summary,
    subcategory: classifyResult.subcategory,
  });
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