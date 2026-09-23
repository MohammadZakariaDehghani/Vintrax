import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The React 17+ JSX transform, as Next compiles it; the classic default
  // would need `React` in scope in every component a test renders.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vintrax/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
      '@vintrax/client': fileURLToPath(new URL('../packages/client/src/index.ts', import.meta.url)),
    },
  },
});
