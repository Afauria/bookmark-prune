import fs from 'node:fs';
import { parse as parseHtml } from 'node-html-parser';
import type { RawBookmark } from '../types.js';

const SKIP_URL_SCHEMES = ['javascript:', 'place:', 'data:', 'about:'];

function isValidUrl(url: string): boolean {
  if (!url || url.trim() === '') return false;
  const lower = url.toLowerCase();
  return !SKIP_URL_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

function parseAddDate(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseInt(value, 10);
  // Chrome uses Unix timestamps in seconds
  return isNaN(num) ? null : num;
}

function walkBookmarks(
  node: ReturnType<typeof parseHtml>['childNodes'][number],
  folderPath: string,
  results: RawBookmark[],
): void {
  const element = node as ReturnType<typeof parseHtml>;
  if (!element || typeof element.tagName !== 'string') return;

  const tag = element.tagName?.toLowerCase();

  // <DT><H3> indicates a folder
  if (tag === 'h3') {
    const folderName = element.textContent?.trim() ?? '';
    const parentDt = element.parentNode;
    if (parentDt) {
      // Find sibling <DL>
      const dl = parentDt.querySelector('dl');
      if (dl) {
        const newPath = folderPath ? `${folderPath}/${folderName}` : folderName;
        for (const child of dl.childNodes) {
          walkBookmarks(child, newPath, results);
        }
      }
    }
    return;
  }

  // <A> indicates a bookmark
  if (tag === 'a') {
    const url = element.getAttribute('href') ?? '';
    if (!isValidUrl(url)) return;

    const title = element.textContent?.trim() ?? '';
    let displayTitle = title;
    if (!displayTitle) {
      try {
        displayTitle = new URL(url).hostname;
      } catch {
        displayTitle = url;
      }
    }
    const addDate = parseAddDate(element.getAttribute('add_date'));

    results.push({
      url,
      title: displayTitle,
      original_folder: folderPath,
      add_date: addDate,
    });
    return;
  }

  // Recurse into children
  if (element.childNodes) {
    for (const child of element.childNodes) {
      walkBookmarks(child, folderPath, results);
    }
  }
}

export function parseChromeBookmarks(htmlFilePath: string): RawBookmark[] {
  const content = fs.readFileSync(htmlFilePath, 'utf-8');
  const root = parseHtml(content, {
    lowerCaseTagName: false,
    comment: false,
  });

  const results: RawBookmark[] = [];

  // Find all <DL> elements at root level and walk them
  const dls = root.querySelectorAll('dl');
  // The first DL is typically the root
  for (const dl of dls) {
    for (const child of dl.childNodes) {
      walkBookmarks(child, '', results);
    }
    // Only process the first DL to avoid duplicates from nested DLs
    break;
  }

  return results;
}

export function deduplicateByUrl(bookmarks: RawBookmark[]): RawBookmark[] {
  const urlMap = new Map<string, RawBookmark>();

  for (const b of bookmarks) {
    const existing = urlMap.get(b.url);
    if (!existing) {
      urlMap.set(b.url, b);
    } else {
      // Keep the one with the latest add_date
      if (b.add_date && existing.add_date && b.add_date > existing.add_date) {
        urlMap.set(b.url, b);
      }
    }
  }

  return Array.from(urlMap.values());
}
