import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts', 'public/sw.js'],
  },
  // eslint-config-next is not yet flat-native, so it is bridged through compat.
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Licence-plate numbers, prices and bidder identities pass through this
      // app; a stray console statement is how they end up in a device log.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
];
