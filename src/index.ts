import { Command } from 'commander';
import { initDatabase } from './db/database.js';
import { insertBookmarks, getStats, markDuplicates, getBookmarksForLinkCheck } from './db/repository.js';
import { parseChromeBookmarks, deduplicateByUrl } from './importer/chrome-html.js';
import { loadConfig, loadSettings } from './config/loader.js';
import { runScan } from './pipeline/scanner.js';
import { runClassify } from './pipeline/classifier.js';
import { runLinkCheck } from './pipeline/link-checker.js';
import { startUIServer } from './ui/server.js';
import { logger } from './utils/logger.js';
import { v4 as uuid } from 'uuid';

const program = new Command();

program
  .name('bm')
  .description('书签知识管理 CLI — 导入、AI 打标签、分类、深度分析')
  .version('0.1.0');

program
  .command('import')
  .description('导入 Chrome 书签 HTML 文件')
  .requiredOption('-i, --input <path>', '书签 HTML 文件路径')
  .action(async (opts: { input: string }) => {
    try {
      const config = loadConfig();
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      logger.info(`Parsing ${opts.input}...`);
      const raw = parseChromeBookmarks(opts.input);
      logger.info(`Parsed ${raw.length} bookmarks`);

      const deduped = deduplicateByUrl(raw);
      const duplicates = raw.length - deduped.length;
      if (duplicates > 0) {
        logger.info(`Removed ${duplicates} duplicate URLs`);
      }

      const bookmarks = deduped.map((b) => ({
        id: uuid(),
        url: b.url,
        title: b.title,
        original_folder: b.original_folder,
        add_date: b.add_date,
        status: 'pending' as const,
        is_duplicate: false,
        tags: '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const inserted = insertBookmarks(db, bookmarks);
      logger.info(`Imported ${inserted} bookmarks (${deduped.length - inserted} already existed)`);

      db.close();
    } catch (err) {
      logger.error(`Import failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('AI 打标签 + 自动分类（默认 fast 模式，--deep 为深度模式）')
  .option('--deep', '深度模式：抓取正文 + AI 深度分析')
  .option('-l, --limit <n>', '处理数量限制', parseInt)
  .option('-s, --start <n>', '偏移量（跳过前 N 条）', parseInt)
  .option('--force', '重新处理已完成的书签')
  .option('--category <cat>', '按分类筛选（仅 deep 模式）')
  .option('--url <url>', '指定单个 URL 处理')
  .action(async (opts: { deep?: boolean; limit?: number; start?: number; force?: boolean; category?: string; url?: string }) => {
    try {
      const config = loadConfig();
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      const result = await runScan({
        config,
        settings,
        db,
        mode: opts.deep ? 'deep' : 'fast',
        limit: opts.limit,
        offset: opts.start,
        force: opts.force,
        category: opts.category,
        url: opts.url,
      });

      const modeLabel = opts.deep ? 'Deep' : 'Scan';
      logger.info(`${modeLabel} complete: ✓${result.success} ✗${result.failed} ⏭${result.skipped}`);
      db.close();
    } catch (err) {
      logger.error(`Scan failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Backward compatible alias: bm deep = bm scan --deep
program
  .command('deep')
  .description('（已合并到 scan）深度分析，等同于 bm scan --deep')
  .option('-l, --limit <n>', '处理数量限制', parseInt)
  .option('-s, --start <n>', '偏移量（跳过前 N 条）', parseInt)
  .option('--force', '重新处理已深度分析的书签')
  .option('--category <cat>', '按分类筛选（如 AI、Android）')
  .option('--url <url>', '指定单个 URL 处理')
  .action(async (opts: { limit?: number; start?: number; force?: boolean; category?: string; url?: string }) => {
    try {
      const config = loadConfig();
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      const result = await runScan({
        config,
        settings,
        db,
        mode: 'deep',
        limit: opts.limit,
        offset: opts.start,
        force: opts.force,
        category: opts.category,
        url: opts.url,
      });

      logger.info(`Deep complete: ✓${result.success} ✗${result.failed} ⏭${result.skipped}`);
      db.close();
    } catch (err) {
      logger.error(`Deep failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('classify')
  .description('规则分类：对所有书签执行分类规则')
  .option('--force', '重新分类所有书签（包括已有分类的）')
  .action((opts: { force?: boolean }) => {
    try {
      const config = loadConfig();
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      const { classified } = runClassify({ db, config, force: opts.force });
      logger.info(`Classify complete: ${classified} bookmarks classified`);
      db.close();
    } catch (err) {
      logger.error(`Classify failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('查看数据库统计（按状态、分类、scan_mode）')
  .action(() => {
    try {
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      const stats = getStats(db);

      console.log(`\nTotal bookmarks: ${stats.total}`);
      console.log('\nBy status:');
      for (const [status, count] of Object.entries(stats.byStatus)) {
        console.log(`  ${status}: ${count}`);
      }

      console.log('\nBy scan_mode:');
      for (const [scanMode, count] of Object.entries(stats.byScanMode)) {
        console.log(`  ${scanMode}: ${count}`);
      }

      console.log('\nBy category:');
      const sorted = Object.entries(stats.byCategory)
        .sort(([, a], [, b]) => b - a);
      for (const [cat, count] of sorted) {
        const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : '0.0';
        console.log(`  ${cat}: ${count} (${pct}%)`);
      }

      db.close();
    } catch (err) {
      logger.error(`Stats failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('check-links')
  .description('检测书签死链并标记')
  .option('-l, --limit <n>', '处理数量限制', parseInt)
  .option('-s, --start <n>', '偏移量', parseInt)
  .option('--force', '重新检测已检测的链接')
  .option('--url <url>', '指定单个 URL 检测')
  .action(async (opts: { limit?: number; start?: number; force?: boolean; url?: string }) => {
    try {
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);

      const bookmarks = opts.url
        ? getBookmarksForLinkCheck(db, { force: true }).filter(b => b.url === opts.url)
        : getBookmarksForLinkCheck(db, { force: opts.force, limit: opts.limit, offset: opts.start });

      if (bookmarks.length === 0) {
        logger.info('No bookmarks to check');
        db.close();
        return;
      }

      logger.info(`Checking ${bookmarks.length} bookmarks...`);
      const startTime = Date.now();

      const { alive, deadCount, errorCount } = await runLinkCheck({
        db,
        bookmarks,
        timeout: settings.thresholds.dead_link_timeout,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Done in ${elapsed}s — alive: ${alive.length}, dead: ${deadCount}, error: ${errorCount}`);
      db.close();
    } catch (err) {
      logger.error(`Check-links failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('ui')
  .description('启动 Web 可视化管理界面')
  .option('-p, --port <port>', '服务端口', (v) => parseInt(v, 10), 3000)
  .action((opts: { port: number }) => {
    const port = opts.port || 3000;
    try {
      const config = loadConfig();
      const settings = loadSettings();
      const db = initDatabase(settings.storage.db);
      startUIServer(db, config, settings, port);
    } catch (err) {
      logger.error(`UI failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
