import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import type { AppConfig, Settings, BatchResult } from '../types.js';
import { getBookmarksFiltered, getAllCategories, getAllTags, getStats, deleteBookmarks } from '../db/repository.js';
import { runScan } from '../pipeline/scanner.js';
import { logger } from '../utils/logger.js';

const STATUS_LABELS: Record<string, string> = {
  pending: '未扫描',
  tagged: '已扫描',
  error: '失败',
  dead: '无法访问',
};

function parseUrl(req: IncomingMessage): { path: string; params: URLSearchParams } {
  const full = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return { path: full.pathname, params: full.searchParams };
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function formatDate(ts: number | null): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 16);
}

// --- API handlers ---

function handleBookmarks(db: Database, params: URLSearchParams, res: ServerResponse) {
  const page = Math.max(1, parseInt(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get('pageSize') ?? '50') || 50));
  const category = params.get('category') || undefined;
  const tag = params.get('tag') || undefined;
  const status = params.get('status') || undefined;
  const q = params.get('q') || undefined;
  const sort = params.get('sort') || 'updated_at';
  const dir = params.get('dir') === 'asc' ? 'ASC' : 'DESC';

  const { data, total } = getBookmarksFiltered(db, { page, pageSize, category, tag, status, q, sort, dir });

  json(res, {
    data: data.map(b => ({
      id: b.id,
      url: b.url,
      title: b.title,
      tags: JSON.parse(b.tags || '[]') as string[],
      category: b.category,
      subcategory: b.subcategory,
      status: b.status,
      statusLabel: STATUS_LABELS[b.status] ?? b.status,
      add_date: formatDate(b.add_date),
      processed_at: formatDateTime(b.processed_at),
      confidence: b.confidence,
      value_score: b.value_score,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

function handleStats(db: Database, res: ServerResponse) {
  json(res, getStats(db));
}

function handleCategories(db: Database, res: ServerResponse) {
  json(res, getAllCategories(db));
}

function handleTags(db: Database, res: ServerResponse) {
  json(res, getAllTags(db));
}

async function handleScan(
  db: Database, config: AppConfig, settings: Settings, body: string, res: ServerResponse,
) {
  try {
    const { ids } = JSON.parse(body) as { ids: string[] };
    if (!ids?.length) { json(res, { error: 'ids required' }, 400); return; }

    logger.info(`UI: scanning ${ids.length} bookmarks...`);
    const result = await runScan({ config, settings, db, mode: 'fast', ids });
    logger.info(`UI: scan complete`, result as unknown as Record<string, unknown>);
    json(res, result);
  } catch (err) {
    logger.error(`UI scan failed: ${(err as Error).message}`);
    json(res, { error: (err as Error).message }, 500);
  }
}

async function handleDeep(
  db: Database, config: AppConfig, settings: Settings, body: string, res: ServerResponse,
) {
  try {
    const { ids } = JSON.parse(body) as { ids: string[] };
    if (!ids?.length) { json(res, { error: 'ids required' }, 400); return; }

    logger.info(`UI: deep processing ${ids.length} bookmarks...`);
    const result = await runScan({ config, settings, db, mode: 'deep', ids });
    logger.info(`UI: deep complete`, result as unknown as Record<string, unknown>);
    json(res, result);
  } catch (err) {
    logger.error(`UI deep failed: ${(err as Error).message}`);
    json(res, { error: (err as Error).message }, 500);
  }
}

function handleDelete(db: Database, body: string, res: ServerResponse) {
  try {
    const { ids } = JSON.parse(body) as { ids: string[] };
    if (!ids?.length) { json(res, { error: 'ids required' }, 400); return; }
    const deleted = deleteBookmarks(db, ids);
    json(res, { deleted });
  } catch (err) {
    json(res, { error: (err as Error).message }, 500);
  }
}

// --- Static file serving ---

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function isSafePath(staticDir: string, requestPath: string): boolean {
  const resolved = path.resolve(staticDir, requestPath);
  return resolved.startsWith(staticDir + path.sep) || resolved === staticDir;
}

function serveStatic(res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext];
  if (!contentType) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function serveIndex(res: ServerResponse, staticDir: string): void {
  const htmlPath = path.join(staticDir, 'index.html');
  fs.readFile(htmlPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Frontend not built. Run: npm run build');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

// --- Server ---

export function startUIServer(db: Database, config: AppConfig, settings: Settings, port: number): void {
  const staticDir = path.join(import.meta.dirname, '..', 'ui');

  const server = createServer(async (req, res) => {
    const { path: reqPath, params } = parseUrl(req);

    // API routes
    if (reqPath === '/api/bookmarks' && req.method === 'DELETE') {
      return handleDelete(db, await readBody(req), res);
    }
    if (reqPath === '/api/bookmarks') return handleBookmarks(db, params, res);
    if (reqPath === '/api/stats') return handleStats(db, res);
    if (reqPath === '/api/categories') return handleCategories(db, res);
    if (reqPath === '/api/tags') return handleTags(db, res);

    if (reqPath === '/api/scan' && req.method === 'POST') {
      return handleScan(db, config, settings, await readBody(req), res);
    }
    if (reqPath === '/api/deep' && req.method === 'POST') {
      return handleDeep(db, config, settings, await readBody(req), res);
    }

    // Static files
    const safe = reqPath.slice(1); // remove leading /
    if (!safe || reqPath === '/' || reqPath === '/index.html') {
      return serveIndex(res, staticDir);
    }
    if (safe.includes('..') || !isSafePath(staticDir, safe)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(staticDir, safe);
    return serveStatic(res, filePath);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n正在关闭...');
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, () => {
    console.log(`\n  API 服务已启动: http://localhost:${port}/api`);
    console.log(`  开发模式请访问: http://localhost:5173`);
    console.log(`  生产模式请访问: http://localhost:${port}\n`);
  });
}
