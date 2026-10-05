/**
 * Process configuration: environment variables → a typed, validated AppConfig.
 * Only src/server.ts reads process.env; buildApp() takes plain options.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repo root; valid for src/config.ts and for the bundled dist/server.js (both in apps/server/<dir>/). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Resolves a path against cwd first, then against the repo root (so `npm -w` and root scripts both work). */
function resolveFromCwdOrRoot(p: string): string {
  if (isAbsolute(p)) return p;
  const fromCwd = resolve(process.cwd(), p);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = resolve(REPO_ROOT, p);
  return existsSync(fromRoot) ? fromRoot : fromCwd;
}

/** A relative database path is anchored at the repo root, whatever directory the process starts in. */
function resolveDatabasePath(p: string): string {
  if (p === ':memory:' || p.startsWith('file:')) return p;
  return resolve(REPO_ROOT, p);
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./data/funnel.db'),
  ADMIN_TOKEN: z.string().optional(),
  SEED_CONFIG: z.string().default('configs/funnel-v1.json'),
  TRANSLATIONS_DIR: z.string().default('configs/translations'),
  WEB_DIST: z.string().default('apps/web/dist'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  NODE_ENV: z.string().default('development'),
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  port: number;
  host: string;
  /** Absolute path, or ':memory:'. */
  databasePath: string;
  /** Unset → admin endpoints are open (local development). */
  adminToken: string | undefined;
  /** Absolute path of the config seeded into an empty database. */
  seedConfigPath: string;
  /** Absolute path of the content translation catalogs directory (`<funnelId>.<lang>.json`). */
  translationsDir: string;
  /** Absolute path of the built SPA. */
  webDist: string;
  logLevel: LogLevel;
  nodeEnv: string;
}

/** Validates the environment; throws one error listing every invalid variable. Empty values count as unset. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const input = Object.fromEntries(
    Object.keys(EnvSchema.shape).map((key) => [key, env[key] === '' ? undefined : env[key]]),
  );
  const parsed = EnvSchema.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    databasePath: resolveDatabasePath(e.DATABASE_PATH),
    adminToken: e.ADMIN_TOKEN,
    seedConfigPath: resolveFromCwdOrRoot(e.SEED_CONFIG),
    translationsDir: resolveFromCwdOrRoot(e.TRANSLATIONS_DIR),
    webDist: resolveFromCwdOrRoot(e.WEB_DIST),
    logLevel: e.LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
}
