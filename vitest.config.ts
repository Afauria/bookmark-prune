import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        'src/pipeline/classifier.ts': { lines: 90 },
        'src/ai/response-parser.ts': { lines: 90 },
        'src/importer/chrome-html.ts': { lines: 70 },
        'src/db/repository.ts': { lines: 70 },
        'src/crawler/content-fetcher.ts': { lines: 70 },
      },
    },
  },
});
