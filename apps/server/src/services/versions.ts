/**
 * Funnel versions: immutable stored configs, the active-version pointer and its activation log.
 *
 * Storage rules (publish and first-boot seeding alike):
 * - `funnel_versions.config_json` = JSON.stringify(raw config as uploaded),
 *   `config_hash` = configHash(raw) (sha256 of canonical JSON).
 * - Readers go through `getVersionConfig()`, which runs `parseConfig()` (zod defaults) once and
 *   caches the result per DB connection — stored versions never change, so the cache never goes stale.
 * - Activation = moving `active_versions.version` + appending a `version_activations` row whose
 *   `previous_version` is the version that was active right before. The log is append-only.
 * - Rollback uses stack semantics over that log: seed/publish/activate rows push a version, rollback
 *   rows pop one (see `activationStack`). Rollback re-activates the version below the top, so
 *   repeated rollbacks walk back through history (v1 → v3 → v4, rollback → v3, rollback → v1, 409).
 */
import { createHash } from 'node:crypto';
import {
  type ActivateResponse,
  type ActivationAction,
  type AdminVersionDetailResponse,
  type AdminVersionsResponse,
  type ConfigDiff,
  type ExistingVersionState,
  type FunnelConfig,
  type PublishResponse,
  type ResolvedFunnel,
  type ValidateResponse,
  type VersionSummary,
  canonicalJson,
  diffConfigs,
  parseConfig,
  resolveFunnel,
  summarizeConfig,
  summarizeVariants,
  validateConfig,
} from '@funnel/shared';
import { type DB, statements } from '../db';
import { ServiceError, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';

// ---------------------------------------------------------------------------
// Rows + prepared statements (prepared once per connection)
// ---------------------------------------------------------------------------

interface VersionRow {
  funnel_id: string;
  version: number;
  config_json: string;
  config_hash: string;
  title: string | null;
  release_note: string | null;
  created_at: string;
}

interface ActivationRow {
  id: number;
  version: number;
  previous_version: number | null;
  action: ActivationAction;
  created_at: string;
}

interface SessionCountRow {
  funnel_version: number;
  total: number;
  in_progress: number;
  completed: number;
}

const stmts = statements((db: DB) => ({
  versionRow: db.prepare<[string, number], VersionRow>(
    `SELECT funnel_id, version, config_json, config_hash, title, release_note, created_at
       FROM funnel_versions WHERE funnel_id = ? AND version = ?`,
  ),
  versionHash: db.prepare<[string, number], { config_hash: string }>(
    'SELECT config_hash FROM funnel_versions WHERE funnel_id = ? AND version = ?',
  ),
  versionsOf: db.prepare<[string], Omit<VersionRow, 'config_json'>>(
    `SELECT funnel_id, version, config_hash, title, release_note, created_at
       FROM funnel_versions WHERE funnel_id = ? ORDER BY version DESC`,
  ),
  versionNumbers: db
    .prepare<[string], number>('SELECT version FROM funnel_versions WHERE funnel_id = ? ORDER BY version')
    .pluck(),
  anyVersion: db.prepare<[], { found: number }>('SELECT 1 AS found FROM funnel_versions LIMIT 1'),
  insertVersion: db.prepare<[string, number, string, string, string | null, string | null, string]>(
    `INSERT INTO funnel_versions (funnel_id, version, config_json, config_hash, title, release_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  activeVersion: db.prepare<[string], { version: number }>('SELECT version FROM active_versions WHERE funnel_id = ?'),
  firstActiveFunnel: db.prepare<[], { funnel_id: string }>(
    'SELECT funnel_id FROM active_versions ORDER BY activated_at LIMIT 1',
  ),
  upsertActive: db.prepare<[string, number, string]>(
    `INSERT INTO active_versions (funnel_id, version, activated_at) VALUES (?, ?, ?)
     ON CONFLICT(funnel_id) DO UPDATE SET version = excluded.version, activated_at = excluded.activated_at`,
  ),
  insertActivation: db.prepare<[string, number, number | null, ActivationAction, string]>(
    `INSERT INTO version_activations (funnel_id, version, previous_version, action, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  activations: db.prepare<[string], ActivationRow>(
    `SELECT id, version, previous_version, action, created_at
       FROM version_activations WHERE funnel_id = ? ORDER BY id DESC LIMIT 200`,
  ),
  allActivationsAsc: db.prepare<[string], Pick<ActivationRow, 'version' | 'action'>>(
    `SELECT version, action FROM version_activations WHERE funnel_id = ? ORDER BY id ASC`,
  ),
  sessionCounts: db.prepare<[string, string], SessionCountRow>(
    `SELECT funnel_version,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN result_id IS NULL AND expires_at > ? THEN 1 ELSE 0 END), 0) AS in_progress,
            COALESCE(SUM(CASE WHEN result_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed
       FROM sessions WHERE funnel_id = ? GROUP BY funnel_version`,
  ),
}));

/** sha256 (hex) of the canonical JSON of a config — identical content ⇒ identical hash. */
export function configHash(config: unknown): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

// ---------------------------------------------------------------------------
// Config cache (versions are immutable)
// ---------------------------------------------------------------------------

interface CachedVersion {
  config: FunnelConfig;
  resolved: Map<string, ResolvedFunnel>;
}

const configCache = new WeakMap<DB, Map<string, CachedVersion>>();

function cacheFor(db: DB): Map<string, CachedVersion> {
  let m = configCache.get(db);
  if (!m) {
    m = new Map();
    configCache.set(db, m);
  }
  return m;
}

function loadVersion(db: DB, funnelId: string, version: number): CachedVersion | null {
  const key = `${funnelId}@${version}`;
  const cache = cacheFor(db);
  const hit = cache.get(key);
  if (hit) return hit;
  const row = stmts(db).versionRow.get(funnelId, version);
  if (!row) return null;
  const entry: CachedVersion = { config: parseConfig(JSON.parse(row.config_json)), resolved: new Map() };
  cache.set(key, entry);
  return entry;
}

/** Parsed (zod defaults applied) config of a stored version, or null. Cached; treat as read-only. */
export function getVersionConfig(db: DB, funnelId: string, version: number): FunnelConfig | null {
  return loadVersion(db, funnelId, version)?.config ?? null;
}

/**
 * The resolved funnel for a stored version + variant (what a pinned session sees). Cached; treat as
 * read-only. Returns null if the version does not exist or the variant is not part of it.
 */
export function getResolvedFunnel(db: DB, funnelId: string, version: number, variant: string): ResolvedFunnel | null {
  const entry = loadVersion(db, funnelId, version);
  if (!entry || !Object.prototype.hasOwnProperty.call(entry.config.experiment.variants, variant)) return null;
  let resolved = entry.resolved.get(variant);
  if (!resolved) {
    resolved = resolveFunnel(entry.config, variant);
    entry.resolved.set(variant, resolved);
  }
  return resolved;
}

export function getActiveVersion(db: DB, funnelId: string): number | null {
  return stmts(db).activeVersion.get(funnelId)?.version ?? null;
}

/** Every stored version number of the funnel, ascending. */
export function listVersionNumbers(db: DB, funnelId: string): number[] {
  return stmts(db).versionNumbers.all(funnelId);
}

/** The funnel that was activated first (the default funnel when no seed config is given). */
export function firstActiveFunnelId(db: DB): string | null {
  return stmts(db).firstActiveFunnel.get()?.funnel_id ?? null;
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

export function listVersions(db: DB, funnelId: string): AdminVersionsResponse {
  const s = stmts(db);
  const activeVersion = getActiveVersion(db, funnelId);
  const counts = new Map(s.sessionCounts.all(nowIso(), funnelId).map((r) => [r.funnel_version, r]));

  const versions: VersionSummary[] = s.versionsOf.all(funnelId).map((row) => {
    const config = getVersionConfig(db, funnelId, row.version)!;
    const c = counts.get(row.version);
    return {
      version: row.version,
      title: row.title ?? config.title,
      releaseNote: row.release_note,
      createdAt: row.created_at,
      isActive: row.version === activeVersion,
      configHash: row.config_hash,
      sessionCount: c?.total ?? 0,
      inProgressCount: c?.in_progress ?? 0,
      completedCount: c?.completed ?? 0,
      variants: summarizeVariants(config),
      eventNames: config.events.allowed.map((e) => e.name),
    };
  });

  const activations = s.activations.all(funnelId).map((a) => ({
    id: a.id,
    version: a.version,
    previousVersion: a.previous_version,
    action: a.action,
    createdAt: a.created_at,
  }));

  return { funnelId, activeVersion, versions, activations, rollbackTarget: rollbackTarget(db, funnelId) };
}

export function getVersionDetail(db: DB, funnelId: string, version: number): AdminVersionDetailResponse {
  const config = getVersionConfig(db, funnelId, version);
  if (!config) throw notFound(`Version ${version} of funnel "${funnelId}" not found`);
  return { version, config };
}

// ---------------------------------------------------------------------------
// Validate / publish
// ---------------------------------------------------------------------------

/** funnelId + version of a raw (possibly invalid) config, if it has usable ones. */
function identity(raw: unknown): { funnelId: string; version: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { funnelId, version } = raw as { funnelId?: unknown; version?: unknown };
  if (typeof funnelId !== 'string' || typeof version !== 'number' || !Number.isInteger(version)) return null;
  return { funnelId, version };
}

function existingState(db: DB, raw: unknown): ExistingVersionState {
  const id = identity(raw);
  if (!id) return 'new';
  const row = stmts(db).versionHash.get(id.funnelId, id.version);
  if (!row) return 'new';
  return row.config_hash === configHash(raw) ? 'identical' : 'conflict';
}

/** Full validation + summary + diff vs the active version of the same funnel (POST /admin/versions/validate). */
export function validateCandidate(db: DB, raw: unknown): ValidateResponse {
  const result = validateConfig(raw);
  const existing = existingState(db, raw);
  if (!result.ok || !result.config) {
    return { ok: false, errors: result.errors, warnings: result.warnings, summary: null, diff: null, existing };
  }
  const config = result.config;
  const activeVersion = getActiveVersion(db, config.funnelId);
  const activeConfig = activeVersion === null ? null : getVersionConfig(db, config.funnelId, activeVersion);
  const diff: ConfigDiff | null = activeConfig ? diffConfigs(activeConfig, config) : null;
  return {
    ok: true,
    errors: result.errors,
    warnings: result.warnings,
    summary: summarizeConfig(config),
    diff,
    existing,
  };
}

export type PublishOutcome =
  { kind: 'invalid'; validation: ValidateResponse } | { kind: 'published' | 'activated'; body: PublishResponse };

/** Inserts an immutable version row. Call inside a transaction. */
function storeVersion(
  db: DB,
  raw: unknown,
  v: { funnelId: string; version: number; title: string | null; releaseNote: string | null },
  now: string,
): void {
  stmts(db).insertVersion.run(v.funnelId, v.version, JSON.stringify(raw), configHash(raw), v.title, v.releaseNote, now);
}

/**
 * Publishes a config without redeploy:
 * - invalid → `invalid` with the ValidateResponse (the route answers 422);
 * - same funnelId+version but different content → 409 `version_conflict`;
 * - identical to a stored version → (re)activates it, `activated` (200, `action: 'activate'`);
 * - new → stores and activates it (activation log action 'publish'), `published` (201).
 */
export function publishConfig(db: DB, raw: unknown): PublishOutcome {
  const validation = validateCandidate(db, raw);
  if (!validation.ok || !validation.summary) return { kind: 'invalid', validation };
  const { funnelId, version, title } = validation.summary;

  if (validation.existing === 'conflict') {
    throw new ServiceError(
      409,
      'version_conflict',
      `Version ${version} of "${funnelId}" already exists with different content. Bump "version" to publish a new one.`,
    );
  }

  if (validation.existing === 'identical') {
    const res = activateVersion(db, funnelId, version);
    return { kind: 'activated', body: { version, activeVersion: res.activeVersion, action: 'activate' } };
  }

  const releaseNote = (raw as { releaseNote?: unknown }).releaseNote;
  const now = nowIso();
  db.transaction(() => {
    // Re-check inside the write transaction (another request may have published meanwhile).
    if (stmts(db).versionHash.get(funnelId, version)) {
      throw new ServiceError(
        409,
        'version_conflict',
        `Version ${version} of "${funnelId}" was published concurrently.`,
      );
    }
    storeVersion(
      db,
      raw,
      { funnelId, version, title, releaseNote: typeof releaseNote === 'string' ? releaseNote : null },
      now,
    );
    setActive(db, funnelId, version, 'publish', now);
  }).immediate();
  return { kind: 'published', body: { version, activeVersion: version, action: 'publish' } };
}

/**
 * First boot: if no funnel version exists yet, stores + activates `raw` (activation action 'seed').
 * Returns what was seeded, or null when the database already had versions. Throws if `raw` is invalid.
 */
export function seedIfEmpty(db: DB, raw: unknown): { funnelId: string; version: number } | null {
  if (stmts(db).anyVersion.get()) return null;
  const result = validateConfig(raw);
  if (!result.ok || !result.config) {
    throw new Error(`Seed config is invalid:\n- ${result.errors.join('\n- ')}`);
  }
  const { funnelId, version, title, releaseNote } = result.config;
  const now = nowIso();
  return db
    .transaction(() => {
      if (stmts(db).anyVersion.get()) return null;
      storeVersion(db, raw, { funnelId, version, title, releaseNote: releaseNote ?? null }, now);
      setActive(db, funnelId, version, 'seed', now);
      return { funnelId, version };
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Activation / rollback
// ---------------------------------------------------------------------------

/** Moves the active pointer and logs it. Returns the version that was active before. Call inside a transaction. */
function setActive(db: DB, funnelId: string, version: number, action: ActivationAction, now = nowIso()): number | null {
  const s = stmts(db);
  const previous = s.activeVersion.get(funnelId)?.version ?? null;
  s.upsertActive.run(funnelId, version, now);
  s.insertActivation.run(funnelId, version, previous, action, now);
  return previous;
}

/**
 * Activates any stored version (an explicit choice → logged as 'activate', i.e. pushed onto the
 * activation stack, whether it is higher or lower than the current one). Activating the
 * already-active version is a no-op (no log row) and reports `previousVersion` = that same version.
 */
export function activateVersion(db: DB, funnelId: string, version: number): ActivateResponse {
  return db
    .transaction((): ActivateResponse => {
      if (!stmts(db).versionHash.get(funnelId, version)) {
        throw notFound(`Version ${version} of funnel "${funnelId}" not found`);
      }
      const current = getActiveVersion(db, funnelId);
      if (current === version) return { activeVersion: version, previousVersion: current };
      const previousVersion = setActive(db, funnelId, version, 'activate');
      return { activeVersion: version, previousVersion };
    })
    .immediate();
}

/**
 * Replays the append-only activation log (oldest first) as a stack:
 * - 'seed' / 'publish' / 'activate' push their version;
 * - 'rollback' pops the top (its version is the one that became active = the new top); a rollback
 *   row that does not land on the entry below the top is treated as a push.
 * The top always equals the active version; if the log and the pointer disagree (manual DB edit),
 * the active version is pushed so rollback never "jumps" to an unrelated version.
 */
function activationStack(db: DB, funnelId: string): number[] {
  const stack: number[] = [];
  for (const row of stmts(db).allActivationsAsc.all(funnelId)) {
    if (row.action === 'rollback' && stack.length >= 2 && stack[stack.length - 2] === row.version) {
      stack.pop();
    } else if (stack[stack.length - 1] !== row.version) {
      stack.push(row.version);
    }
  }
  const active = getActiveVersion(db, funnelId);
  if (active !== null && stack[stack.length - 1] !== active) stack.push(active);
  return stack;
}

/** The version POST /admin/rollback would re-activate, or null when there is nothing to roll back to. */
function rollbackTarget(db: DB, funnelId: string): number | null {
  const stack = activationStack(db, funnelId);
  return stack.length >= 2 ? stack[stack.length - 2]! : null;
}

/**
 * Re-activates the version that was active before the current one, walking back through the
 * activation history (stack pop): seed v1 → publish v3 → publish v4 → rollback = v3 → rollback = v1
 * → rollback = 409 `no_previous_version`. A rollback never moves "forward" to the version that was
 * just rolled back from. Logged as 'rollback' with `previous_version` = the version rolled back from.
 */
export function rollback(db: DB, funnelId: string): ActivateResponse {
  return db
    .transaction((): ActivateResponse => {
      const target = rollbackTarget(db, funnelId);
      if (target === null) {
        throw new ServiceError(
          409,
          'no_previous_version',
          `Funnel "${funnelId}" has no previous version to roll back to`,
        );
      }
      const previousVersion = setActive(db, funnelId, target, 'rollback');
      return { activeVersion: target, previousVersion };
    })
    .immediate();
}
