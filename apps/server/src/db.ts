/**
 * SQLite access: connection setup, ordered migrations and the per-connection statement cache.
 * SQL lives in src/services/*; routes never touch the database directly.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { nowIso } from './lib/time';

export type DB = Database.Database;

/**
 * Ordered migrations. Each entry runs once inside a transaction and is recorded in
 * schema_migrations(version = index + 1). Never edit an applied entry — append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1 */ `
  CREATE TABLE funnel_versions (
    funnel_id TEXT NOT NULL, version INTEGER NOT NULL,
    config_json TEXT NOT NULL, config_hash TEXT NOT NULL,
    title TEXT, release_note TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (funnel_id, version));
  CREATE TABLE version_activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, funnel_id TEXT NOT NULL, version INTEGER NOT NULL,
    previous_version INTEGER, action TEXT NOT NULL CHECK (action IN ('seed','publish','activate','rollback')),
    created_at TEXT NOT NULL);
  CREATE TABLE active_versions (funnel_id TEXT PRIMARY KEY, version INTEGER NOT NULL, activated_at TEXT NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, funnel_id TEXT NOT NULL, funnel_version INTEGER NOT NULL,
    experiment_id TEXT NOT NULL, variant TEXT NOT NULL,
    variant_source TEXT NOT NULL CHECK (variant_source IN ('hash','override')),
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
    answers_json TEXT NOT NULL DEFAULT '{}', current_step_id TEXT, result_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE events (
    event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, step_id TEXT,
    funnel_id TEXT NOT NULL, funnel_version INTEGER NOT NULL, experiment_id TEXT NOT NULL, variant TEXT NOT NULL,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
    client_ts TEXT, server_ts TEXT NOT NULL, properties_json TEXT NOT NULL DEFAULT '{}', batch_id TEXT);
  CREATE INDEX idx_events_session ON events(session_id);
  CREATE INDEX idx_events_name_step ON events(name, step_id);
  CREATE INDEX idx_sessions_cohort ON sessions(funnel_id, funnel_version, variant, utm_campaign);
  CREATE TABLE rejected_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, batch_id TEXT, reason TEXT NOT NULL,
    payload_json TEXT, received_at TEXT NOT NULL);
  CREATE TABLE ingest_batches (
    id TEXT PRIMARY KEY, received_at TEXT NOT NULL, total INTEGER NOT NULL, accepted INTEGER NOT NULL,
    duplicates INTEGER NOT NULL, rejected INTEGER NOT NULL);
  `,
  /* 2 */ `
  CREATE TABLE duplicate_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, batch_id TEXT, received_at TEXT NOT NULL);
  CREATE INDEX idx_duplicate_deliveries_received ON duplicate_deliveries(received_at);
  `,
  /* 3 */ `
  CREATE INDEX IF NOT EXISTS idx_events_server_ts ON events(server_ts);
  CREATE INDEX IF NOT EXISTS idx_rejected_received ON rejected_events(received_at);
  `,
];

function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.transaction(() => {
      db.exec(sql);
      record.run(version, nowIso());
    })();
  });
}

/**
 * Opens (creating if needed) the database, enables WAL + busy_timeout and applies migrations.
 * `path` may be ':memory:' (tests). The parent directory of a file path is created automatically.
 */
export function openDb(path: string): DB {
  if (path !== ':memory:' && !path.startsWith('file:')) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/**
 * Memoizes a set of prepared statements per connection:
 *
 *   const stmts = statements((db) => ({ byId: db.prepare('SELECT ...') }));
 *   stmts(db).byId.get(id);
 *
 * Statements are prepared lazily on first use and released together with the connection.
 */
export function statements<T>(prepare: (db: DB) => T): (db: DB) => T {
  const cache = new WeakMap<DB, T>();
  return (db) => {
    let s = cache.get(db);
    if (s === undefined) {
      s = prepare(db);
      cache.set(db, s);
    }
    return s;
  };
}

const pingStmts = statements((db) => db.prepare('SELECT 1'));

/** Cheap liveness check of the connection (throws if the database is unusable). */
export function pingDb(db: DB): void {
  pingStmts(db).get();
}
