/**
 * Fastify app factory. Pure: everything comes from `opts` (no process.env, no argv), so tests build
 * as many isolated apps as they need with `buildApp({ dbPath: ':memory:', ... })` + `app.inject`.
 * The process entry point is src/server.ts.
 */
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { type DB, openDb } from './db';
import { errorHandler } from './http/error-handler';
import { registerWebApp } from './http/spa';
import adminRoutes from './routes/admin';
import eventsRoutes from './routes/events';
import healthRoutes from './routes/health';
import sessionsRoutes from './routes/sessions';
import translationsRoutes from './routes/translations';
import { describeTranslations, loadTranslations } from './services/translations';
import { firstActiveFunnelId, seedIfEmpty } from './services/versions';

export interface BuildAppOptions {
  /** SQLite file path or ':memory:'. */
  dbPath: string;
  /**
   * If set, admin mutations and the session-level admin reads require `x-admin-token`;
   * GET /api/health then reports adminAuthRequired = true.
   */
  adminToken?: string | null;
  /** Config published + activated when the DB has no versions; also defines the default funnel. */
  seedConfigPath?: string;
  /**
   * Directory of content translation catalogs (`<funnelId>.<lang>.json`), loaded and validated at
   * boot; a bad file fails startup. Null/missing directory → no translations (source language only).
   */
  translationsDir?: string | null;
  /** Built SPA directory to serve (with index.html fallback). Ignored if null/missing. */
  webDist?: string | null;
  logger?: boolean | { level: string };
}

function readSeedConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read seed config ${path}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

/** Seeds an empty database and resolves the default funnel (the seed config's, else the first active one). */
function initContext(db: DB, opts: BuildAppOptions, log: FastifyInstance['log']): AppContext {
  let seedFunnelId: string | null = null;
  if (opts.seedConfigPath) {
    const raw = readSeedConfig(opts.seedConfigPath);
    let seeded;
    try {
      seeded = seedIfEmpty(db, raw);
    } catch (err) {
      throw new Error(`${opts.seedConfigPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (seeded) log.info({ seeded }, 'seeded initial funnel version');
    const { funnelId } = raw as { funnelId?: unknown };
    if (typeof funnelId === 'string') seedFunnelId = funnelId;
  }
  const defaultFunnelId = seedFunnelId ?? firstActiveFunnelId(db);
  if (!defaultFunnelId) throw new Error('No funnel configured: set SEED_CONFIG');
  const translations = loadTranslations(opts.translationsDir);
  if (translations.size > 0) log.info({ translations: describeTranslations(translations) }, 'loaded translations');
  return { db, adminToken: opts.adminToken || null, defaultFunnelId, translations };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  const db = openDb(opts.dbPath);
  let ctx: AppContext;
  try {
    ctx = initContext(db, opts, app.log);
  } catch (err) {
    db.close();
    throw err;
  }
  app.decorate('ctx', ctx);
  app.addHook('onClose', async () => {
    db.close();
  });
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(sessionsRoutes, { prefix: '/api' });
  await app.register(eventsRoutes, { prefix: '/api' });
  await app.register(translationsRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await registerWebApp(app, opts.webDist);

  return app;
}
