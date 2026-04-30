import { logger } from '../utils/logger.js';

export type LinkStatus = 'alive' | 'dead' | 'error';

export interface LinkCheckResult {
  status: LinkStatus;
  httpStatus?: number;
  finalUrl?: string;
  content?: string;
}

const SOFT_404_PATTERNS = [
  /<title[^>]*>.*404.*<\/title>/i,
  /<title[^>]*>.*not found.*<\/title>/i,
  /<title[^>]*>.*页面不存在.*<\/title>/i,
  /<title[^>]*>.*找不到.*<\/title>/i,
  /<title[^>]*>.*页面找不到了.*<\/title>/i,
  /<title[^>]*>.*内容不存在.*<\/title>/i,
];

function isSoft404(html: string): boolean {
  return SOFT_404_PATTERNS.some(p => p.test(html));
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

export async function checkLink(
  url: string,
  timeout: number,
): Promise<LinkCheckResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    clearTimeout(timer);

    const finalUrl = response.url !== url ? response.url : undefined;
    const httpStatus = response.status;

    if (response.ok) {
      const html = await response.text();
      if (isSoft404(html)) {
        return { status: 'dead', httpStatus, finalUrl };
      }
      return { status: 'alive', httpStatus, finalUrl, content: html };
    }

    // 404/410: definitively dead
    if (response.status === 404 || response.status === 410) {
      return { status: 'dead', httpStatus, finalUrl };
    }

    // 5xx/403 etc: transient error, not dead but not alive — retry later
    return { status: 'error', httpStatus, finalUrl };
  } catch {
    return { status: 'error' };
  }
}

const DOMAIN_DELAY = 300;

export async function checkLinks(
  urls: string[],
  timeout: number,
  _concurrency: number,
): Promise<Map<string, LinkCheckResult>> {
  const results = new Map<string, LinkCheckResult>();

  // Group URLs by domain
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    const domain = extractDomain(url);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(url);
  }

  // Process each domain group: sequential within, parallel across
  const tasks = [...groups.entries()].map(async ([, domainUrls]) => {
    for (let i = 0; i < domainUrls.length; i++) {
      const url = domainUrls[i];
      const result = await checkLink(url, timeout);
      logger.info(`[link-check] ${result.httpStatus ?? 'ERR'} ${result.status === 'alive' ? '✓' : result.status === 'dead' ? '✗ dead' : '⚠ error'} ${url.slice(0, 80)}${result.finalUrl ? ' → ' + result.finalUrl.slice(0, 80) : ''}`);
      results.set(url, result);
      if (i < domainUrls.length - 1) {
        await new Promise(r => setTimeout(r, DOMAIN_DELAY));
      }
    }
  });

  await Promise.all(tasks);
  return results;
}
