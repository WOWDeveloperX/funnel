import { defineConfig } from 'vitest/config';

// One vitest run covers every workspace. All projects run in the node environment: web tests cover
// framework-free browser logic (event queue, controller, storage, poller) against in-memory fakes.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          root: './apps/server',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        // Fakes for window/document/localStorage live in apps/web/test/support/browser.ts.
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
    ],
  },
});
