// ESLint 9 flat config.
//
// Deliberately narrow: TypeScript already catches most of what a linter would,
// so these rules target the things it cannot see — unhandled promises, unsafe
// escapes, and dead code that survives a refactor.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Nest constructors take injected parameters that are used via `this`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` defeats the type safety the rest of the codebase relies on.
      '@typescript-eslint/no-explicit-any': 'error',
      // A floating promise in a request handler is a silently swallowed error.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Seeds and specs legitimately log and use looser typing.
    files: ['**/*.spec.ts', 'prisma/seed.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
