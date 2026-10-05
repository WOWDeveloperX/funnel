// ESLint flat config for the whole monorepo (one root config, scoped by file globs).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist', '**/node_modules', 'coverage', 'data']),

  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Node code: server, shared engine, CLI scripts and tool configs.
  {
    files: ['apps/server/**', 'packages/**', 'scripts/**', '**/*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  // The server logs through Fastify's pino logger; console is only for fatal boot errors.
  {
    files: ['apps/server/src/**'],
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },

  // Browser code: React SPA.
  {
    files: ['apps/web/src/**', 'apps/web/test/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/web/src/**', 'apps/web/test/**'],
    extends: [reactHooks.configs.flat.recommended],
  },

  // Must stay last: turns off stylistic rules that would fight Prettier.
  eslintConfigPrettier,
);
