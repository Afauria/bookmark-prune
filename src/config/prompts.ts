import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, RawBookmark, TagDefinitions, Bookmark } from '../types.js';

export function loadPrompt(
  mode: 'fast' | 'deep',
  customDir?: string,
): string {
  const filenames = { fast: 'scan.md', deep: 'deep.md' };
  const filename = filenames[mode];

  // User override takes priority
  const customPath = path.resolve(customDir ?? 'config/prompts', filename);
  if (fs.existsSync(customPath)) {
    return fs.readFileSync(customPath, 'utf-8');
  }

  // Built-in default
  const builtInPath = path.resolve('prompts', filename);
  if (fs.existsSync(builtInPath)) {
    return fs.readFileSync(builtInPath, 'utf-8');
  }

  throw new Error(`Prompt template not found: ${filename}`);
}

export function formatTagList(tags: TagDefinitions): string {
  return [
    `领域标签: ${tags.domain.join(', ')}`,
    `技术标签: ${tags.tech.join(', ')}`,
    `类型标签: ${tags.type.join(', ')}`,
    `场景标签: ${tags.meta.join(', ')}`,
    `状态标签: ${tags.status.join(', ')}`,
  ].join('\n');
}

export function formatScanInput(bookmarks: RawBookmark[] | Pick<Bookmark, 'url' | 'title'>[]): string {
  return bookmarks
    .map((b, i) => `${i + 1}. URL: ${b.url}\n   标题: ${b.title}`)
    .join('\n\n');
}

export function formatDeepInput(
  bookmarks: { url: string; title: string; content: string | null }[],
): string {
  return bookmarks
    .map((b, i) => {
      const contentSection = b.content
        ? `\n   正文: ${b.content.slice(0, 3000)}`
        : '\n   正文: (无正文，仅根据标题和URL判断)';
      return `${i + 1}. URL: ${b.url}\n   标题: ${b.title}${contentSection}`;
    })
    .join('\n\n');
}

export function buildScanPrompt(
  template: string,
  config: AppConfig,
  bookmarks: RawBookmark[] | Pick<Bookmark, 'url' | 'title'>[],
): string {
  return template
    .replace('{{tags}}', formatTagList(config.tags))
    .replace('{{input_data}}', formatScanInput(bookmarks));
}

export function buildDeepPrompt(
  template: string,
  config: AppConfig,
  bookmarks: { url: string; title: string; content: string | null }[],
): string {
  return template
    .replace('{{tags}}', formatTagList(config.tags))
    .replace('{{input_data}}', formatDeepInput(bookmarks));
}
