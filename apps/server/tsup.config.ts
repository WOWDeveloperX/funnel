import { defineConfig } from 'tsup';

// Single ESM bundle → dist/server.js. @funnel/shared is TS source, so it must be bundled; better-sqlite3 is native.
export default defineConfig({
  entry: { server: 'src/server.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@funnel/shared'],
  external: ['better-sqlite3'],
});
