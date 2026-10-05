/**
 * Process entry point: environment → config → app → listen, plus graceful shutdown.
 * Run with `tsx src/server.ts` in development and `node dist/server.js` in production.
 */
import { buildApp } from './app';
import { loadConfig } from './config';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({
    dbPath: config.databasePath,
    adminToken: config.adminToken,
    seedConfigPath: config.seedConfigPath,
    translationsDir: config.translationsDir,
    webDist: config.webDist,
    logger: { level: config.logLevel },
  });

  if (config.nodeEnv === 'production' && !config.adminToken) {
    app.log.warn('ADMIN_TOKEN is not set: admin endpoints (publish, rollback, session lists) are open');
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    // Hard stop if in-flight requests do not drain in time.
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
