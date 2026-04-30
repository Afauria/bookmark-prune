import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  build: {
    outDir: '../dist/ui',
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
