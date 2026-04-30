import type BetterSqlite3 from 'better-sqlite3';
import type { ClassificationRule, AppConfig } from '../types.js';
import { getBookmarksForClassify, updateBookmark } from '../db/repository.js';
import { logger } from '../utils/logger.js';

export interface ClassifyResult {
  category: string;
  subcategory: string | null;
}

export function classify(
  bookmark: { url: string; title: string; tags: string },
  rules: ClassificationRule[],
  techTags?: string[],
): ClassifyResult {
  const parsedTags: string[] = safeParseTags(bookmark.tags);

  for (const rule of rules) {
    // Stage 1: Pre-AI rules (url_contains, title_contains)
    if (rule.match.url_contains || rule.match.title_contains) {
      if (matchesPreAI(bookmark, rule)) {
        const sub = findSubcategory(parsedTags, techTags);
        return { category: rule.domain, subcategory: sub };
      }
    }

    // Stage 3: Post-AI rules (tag_contains)
    if (rule.match.tag_contains) {
      const matchedTag = findMatchedTag(parsedTags, rule.match.tag_contains);
      if (matchedTag) {
        return { category: rule.domain, subcategory: matchedTag };
      }
    }

    // Stage 4: Default fallback
    if (rule.match.default === true) {
      const sub = findSubcategory(parsedTags, techTags);
      return { category: rule.domain, subcategory: sub };
    }
  }

  return { category: '待分类', subcategory: null };
}

function findMatchedTag(bookmarkTags: string[], matchTags: string[]): string | null {
  return bookmarkTags.find((t) => matchTags.includes(t)) ?? null;
}

function findSubcategory(parsedTags: string[], techTags?: string[]): string | null {
  if (!techTags) return null;
  return parsedTags.find((t) => techTags.includes(t)) ?? null;
}

function matchesPreAI(
  bookmark: { url: string; title: string },
  rule: ClassificationRule,
): boolean {
  const urlMatch = rule.match.url_contains?.some((s) =>
    bookmark.url.includes(s),
  );
  const titleMatch = rule.match.title_contains?.some((s) =>
    bookmark.title.includes(s),
  );
  // If both conditions are defined, either can match (OR logic)
  // If only one is defined, that one must match
  if (rule.match.url_contains && rule.match.title_contains) {
    return !!(urlMatch || titleMatch);
  }
  return !!(urlMatch ?? titleMatch);
}

function matchesTagContains(
  bookmarkTags: string[],
  matchTags: string[],
): boolean {
  return bookmarkTags.some((t) => matchTags.includes(t));
}

function safeParseTags(tags: string): string[] {
  if (!tags) return [];
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

export function runClassify(options: {
  db: BetterSqlite3.Database;
  config: AppConfig;
  force?: boolean;
}): { classified: number } {
  const { db, config, force } = options;
  const bookmarks = getBookmarksForClassify(db, { force });
  const techTags = config.tags.tech;

  if (bookmarks.length === 0) {
    logger.info('No bookmarks to classify');
    return { classified: 0 };
  }

  logger.info(`Classifying ${bookmarks.length} bookmarks...`);
  let classified = 0;

  for (const b of bookmarks) {
    const result = classify(
      { url: b.url, title: b.title, tags: b.tags },
      config.classification_rules,
      techTags,
    );
    updateBookmark(db, b.id, {
      category: result.category,
      subcategory: result.subcategory,
    });
    classified++;
  }

  logger.info(`Classified ${classified} bookmarks`);
  return { classified };
}
