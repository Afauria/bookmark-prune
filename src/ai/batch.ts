import type { AIProvider } from './provider.js';
import type { AIOutput, Bookmark, BatchConfig, ProcessBatchResult } from '../types.js';
import { parseAIResponse } from './response-parser.js';
import { RetryableError } from './anthropic.js';
import { logger } from '../utils/logger.js';
import { ProgressReporter } from '../utils/progress.js';

export async function processBatch(
  bookmarks: Bookmark[],
  provider: AIProvider,
  prompt: string,
  allowedTags: string[],
  batchConfig: BatchConfig,
  mode: 'fast' | 'deep',
): Promise<{ results: Map<string, AIOutput>; batchResult: ProcessBatchResult }> {
  logger.info(`[PROMPT]\n${prompt}\n[/PROMPT]`);
  const results = new Map<string, AIOutput>();
  const progress = new ProgressReporter(bookmarks.length);
  let failed = 0;
  let skipped = 0;
  const failedIds: string[] = [];

  // Split into chunks
  const chunks: Bookmark[][] = [];
  for (let i = 0; i < bookmarks.length; i += batchConfig.size) {
    chunks.push(bookmarks.slice(i, i + batchConfig.size));
  }

  // Process chunks with concurrency limit
  const semaphore = new Semaphore(batchConfig.concurrency);
  const tasks = chunks.map((chunk) => async () => {
    await semaphore.acquire();
    try {
      const aiOutputs = await processChunkWithRetry(
        chunk,
        provider,
        prompt,
        allowedTags,
        batchConfig.retry,
      );

      // Match AI results back to bookmarks by URL
      for (const output of aiOutputs) {
        if (output.url) {
          const bookmark = chunk.find((b) => b.url === output.url);
          if (bookmark) {
            results.set(bookmark.id, output);
          }
        }
      }

      progress.increment('success', chunk.length);
      progress.report(mode);
    } catch (err) {
      logger.error(`Batch failed: ${(err as Error).message}`);
      failed += chunk.length;
      chunk.forEach(b => failedIds.push(b.id));
      progress.increment('failed', chunk.length);
      progress.report(mode);
    } finally {
      semaphore.release();
    }
  });

  // Run all tasks
  await Promise.all(tasks.map((t) => t()));
  progress.finish();

  return {
    results,
    batchResult: {
      success: results.size,
      failed,
      skipped,
      failedIds,
    },
  };
}

async function processChunkWithRetry(
  chunk: Bookmark[],
  provider: AIProvider,
  prompt: string,
  allowedTags: string[],
  maxRetries: number,
): Promise<AIOutput[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await provider.call(prompt);
      const outputs = parseAIResponse(raw, allowedTags);
      if (!outputs) {
        logger.warn(`AI response parse failed, raw output:\n${raw}`);
        throw new Error('Failed to parse AI response as JSON');
      }
      return outputs;
    } catch (err) {
      lastError = err as Error;

      if (err instanceof RetryableError) {
        if (attempt < maxRetries) {
          logger.warn(`Retry ${attempt + 1}/${maxRetries} after ${err.retryAfterMs}ms`);
          await sleep(err.retryAfterMs);
          continue;
        }
      }

      // Exponential backoff for other errors
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        logger.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('Unknown error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}
