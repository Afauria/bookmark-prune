import type BetterSqlite3 from 'better-sqlite3';
import type { Bookmark } from '../types.js';
import { updateBookmark } from '../db/repository.js';
import { checkLinks } from '../crawler/link-checker.js';
import { logger } from '../utils/logger.js';

export async function runLinkCheck(options: {
  db: BetterSqlite3.Database;
  bookmarks: Bookmark[];
  timeout: number;
  concurrency?: number;
}): Promise<{ alive: Bookmark[]; deadCount: number; errorCount: number }> {
  const { db, bookmarks, timeout, concurrency = 10 } = options;

  if (bookmarks.length === 0) {
    return { alive: [], deadCount: 0, errorCount: 0 };
  }

  logger.info(`Checking ${bookmarks.length} links...`);

  const linkResults = await checkLinks(
    bookmarks.map((b) => b.url),
    timeout,
    concurrency,
  );

  const alive: Bookmark[] = [];
  let deadCount = 0;
  let errorCount = 0;

  for (const b of bookmarks) {
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
      alive.push(b);
    } else if (result?.status === 'dead') {
      updateBookmark(db, b.id, { status: 'dead' });
      deadCount++;
    } else {
      updateBookmark(db, b.id, { status: 'error' });
      errorCount++;
      logger.warn(`Link check error (${result?.httpStatus ?? 'timeout'}): ${b.url}`);
    }
  }

  logger.info(`Alive: ${alive.length}, dead: ${deadCount}, error: ${errorCount}`);

  return { alive, deadCount, errorCount };
}
