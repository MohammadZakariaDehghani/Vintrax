import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
