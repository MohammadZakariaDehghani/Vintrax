import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxying keeps the browser on one origin in development, so listing images
    // served from /uploads resolve without rewriting URLs or relaxing CORS.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/uploads': { target: API_TARGET, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      // Compile @atlas/shared from TypeScript source rather than its CommonJS
      // dist. Pre-bundling the linked package instead caches it once, so edits
      // to the shared contracts would be served stale until the cache is wiped.
      '@atlas/shared': sharedSrc,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
