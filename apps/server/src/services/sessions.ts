/**
 * Funnel sessions: creation (version + variant pinning, UTM capture, server-side `session_started`),
 * restore, state mirroring and server-side result computation.
 *
 * A session is pinned forever to the funnel version that was active at creation and to its variant;
 * every read resolves the funnel from that pinned version, never from the currently active one.
 */
import { randomUUID } from 'node:crypto';
import {
  type Answers,
  type CreateSessionRequest,
  type ResolvedFunnel,
  type SessionState,
  type SubmitResultResponse,
  type UpdateSessionStateResponse,
  type UtmParams,
  type VariantSource,
  answerKey,
  assignVariant,
  computeResultId,
  findResultStepId,
  isInteractive,
  resolveResult,
  validateVisibleAnswers,
} from '@funnel/shared';
import { type DB, statements } from '../db';
import { ServiceError, badRequest, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { type TranslationStore, catalogsOf } from './translations';
import { getActiveVersion, getResolvedFunnel, getVersionConfig } from './versions';

const SESSION_STARTED_PREFIX = 'session_started:';
const MAX_UTM_LENGTH = 100;
/** Caps for stored answer values (answers are user input mirrored from the client). */
const MAX_ANSWER_STRING = 500;
const MAX_ANSWER_ARRAY = 50;
const MAX_SESSION_ID_LENGTH = 128;

export interface SessionRow {
  id: string;
  funnel_id: string;
  funnel_version: number;
  experiment_id: string;
  variant: string;
  variant_source: VariantSource;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  answers_json: string;
  current_step_id: string | null;
  result_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const stmts = statements((db: DB) => ({
  insertSession: db.prepare<
    [
      string,
      string,
      number,
      string,
      string,
      VariantSource,
      string | null,
      string | null,
      string | null,
      string,
      string,
      string,
    ]
  >(
    `INSERT INTO sessions (id, funnel_id, funnel_version, experiment_id, variant, variant_source,
                           utm_source, utm_medium, utm_campaign, answers_json, current_step_id, result_id,
                           created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', NULL, NULL, ?, ?, ?)`,
  ),
  insertStartedEvent: db.prepare<
    [string, string, string, number, string, string, string | null, string | null, string | null, string]
  >(
    `INSERT INTO events (event_id, session_id, name, step_id, funnel_id, funnel_version, experiment_id, variant,
                         utm_source, utm_medium, utm_campaign, client_ts, server_ts, properties_json, batch_id)
     VALUES (?, ?, 'session_started', NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}', NULL)
     ON CONFLICT(event_id) DO NOTHING`,
  ),
  byId: db.prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?'),
  updateState: db.prepare<[string, string | null, string, string]>(
    'UPDATE sessions SET answers_json = ?, current_step_id = ?, updated_at = ? WHERE id = ?',
  ),
  saveAnswers: db.prepare<[string, string, string]>(
    'UPDATE sessions SET answers_json = ?, updated_at = ? WHERE id = ?',
  ),
  saveResult: db.prepare<[string, string, string | null, string, string]>(
    `UPDATE sessions SET answers_json = ?, result_id = ?, current_step_id = COALESCE(?, current_step_id),
                         updated_at = ? WHERE id = ?`,
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trimmed, capped UTM value; empty/non-string → null. */
function normalizeUtm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, MAX_UTM_LENGTH);
  return v.length ? v : null;
}

function isExpired(row: Pick<SessionRow, 'expires_at'>, now: string): boolean {
  return row.expires_at <= now;
}

/** The resolved funnel of the session's pinned version + variant. */
export function sessionFunnel(
  db: DB,
  row: Pick<SessionRow, 'funnel_id' | 'funnel_version' | 'variant'>,
): ResolvedFunnel {
  const funnel = getResolvedFunnel(db, row.funnel_id, row.funnel_version, row.variant);
  // Versions are immutable and never deleted, so this only fails on manual DB edits.
  if (!funnel) throw new Error(`Pinned funnel ${row.funnel_id}@${row.funnel_version}/${row.variant} is missing`);
  return funnel;
}

function parseAnswers(json: string): Answers {
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Answers) : {};
  } catch {
    return {};
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_ANSWER_STRING ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_ANSWER_ARRAY) return undefined;
    const ok = value.every(
      (v) => (typeof v === 'string' && v.length <= MAX_ANSWER_STRING) || (typeof v === 'number' && Number.isFinite(v)),
    );
    return ok ? [...value] : undefined;
  }
  return undefined; // null, objects, ... are dropped
}

/**
 * Keeps only answers keyed by an input name of an interactive step of the pinned funnel, with
 * primitive (or primitive-array) values under the size caps. Everything else is silently dropped.
 * Answers of currently hidden steps are kept — they come back if the branch reopens.
 */
function sanitizeAnswers(funnel: ResolvedFunnel, answers: Answers): Answers {
  const keys = new Set<string>();
  for (const id of funnel.stepSequence) {
    const step = funnel.steps[id];
    if (!isInteractive(step)) continue;
    const key = answerKey(step);
    if (key) keys.add(key);
  }
  const out: Answers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!keys.has(key)) continue;
    const clean = sanitizeValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function toState(row: SessionRow, funnel: ResolvedFunnel, translations: TranslationStore): SessionState {
  const utm: UtmParams = { source: row.utm_source, medium: row.utm_medium, campaign: row.utm_campaign };
  return {
    sessionId: row.id,
    funnelId: row.funnel_id,
    funnelVersion: row.funnel_version,
    experimentId: row.experiment_id,
    variant: row.variant,
    variantSource: row.variant_source,
    utm,
    answers: parseAnswers(row.answers_json),
    currentStepId: row.current_step_id,
    resultId: row.result_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    funnel,
    translations: catalogsOf(translations, row.funnel_id),
  };
}

/** Loads a live session: 404 `not_found` if unknown, 410 `expired` past its TTL. */
function loadLive(db: DB, sessionId: string): SessionRow {
  const row = sessionId.length <= MAX_SESSION_ID_LENGTH ? stmts(db).byId.get(sessionId) : undefined;
  if (!row) throw notFound('Session not found');
  if (isExpired(row, nowIso())) throw new ServiceError(410, 'expired', 'Session has expired');
  return row;
}

export function getSessionRow(db: DB, sessionId: string): SessionRow | null {
  return stmts(db).byId.get(sessionId) ?? null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

interface CreateSessionOptions {
  /** Used when the request omits funnelId. */
  defaultFunnelId: string;
  /** Catalogs attached to the state (display-only; never affect pinning or variant). */
  translations: TranslationStore;
  /** Injectable for tests. */
  now?: Date;
  sessionId?: string;
}

/**
 * POST /api/sessions: pins the active version of the funnel and a variant (valid query override →
 * 'override', else deterministic hash → 'hash'), captures UTM, and inserts the server-side
 * `session_started` event in the same transaction.
 */
export function createSession(db: DB, req: CreateSessionRequest, opts: CreateSessionOptions): SessionState {
  const funnelId = req.funnelId ?? opts.defaultFunnelId;
  const version = getActiveVersion(db, funnelId);
  const config = version === null ? null : getVersionConfig(db, funnelId, version);
  if (version === null || !config) throw notFound(`Funnel "${funnelId}" has no active version`);

  const query = req.query ?? {};
  const sessionId = opts.sessionId ?? randomUUID();
  const { experiment } = config;

  const override = query[experiment.overrideQueryParam];
  const isValidOverride =
    typeof override === 'string' && Object.prototype.hasOwnProperty.call(experiment.variants, override);
  const variant = isValidOverride ? override : assignVariant(experiment, sessionId);
  const variantSource: VariantSource = isValidOverride ? 'override' : 'hash';

  const utmSource = normalizeUtm(query.utm_source);
  const utmMedium = normalizeUtm(query.utm_medium);
  const utmCampaign = normalizeUtm(query.utm_campaign);

  const nowDate = opts.now ?? new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + config.session.ttlHours * 3_600_000).toISOString();

  const s = stmts(db);
  db.transaction(() => {
    s.insertSession.run(
      sessionId,
      funnelId,
      version,
      experiment.id,
      variant,
      variantSource,
      utmSource,
      utmMedium,
      utmCampaign,
      now,
      now,
      expiresAt,
    );
    s.insertStartedEvent.run(
      SESSION_STARTED_PREFIX + sessionId,
      sessionId,
      funnelId,
      version,
      experiment.id,
      variant,
      utmSource,
      utmMedium,
      utmCampaign,
      now,
    );
  })();

  const row = s.byId.get(sessionId)!;
  return toState(row, sessionFunnel(db, row), opts.translations);
}

/** GET /api/sessions/:id — state resolved for the pinned version + variant, plus the funnel's catalogs. */
export function getSession(db: DB, sessionId: string, translations: TranslationStore): SessionState {
  const row = loadLive(db, sessionId);
  return toState(row, sessionFunnel(db, row), translations);
}

/** PUT /api/sessions/:id/state — last write wins; answers are replaced by the sanitized payload. */
export function updateSessionState(
  db: DB,
  sessionId: string,
  body: { answers: Answers; currentStepId: string | null },
): UpdateSessionStateResponse {
  const row = loadLive(db, sessionId);
  const funnel = sessionFunnel(db, row);
  if (body.currentStepId !== null && !funnel.stepSequence.includes(body.currentStepId)) {
    throw badRequest(`Unknown step "${body.currentStepId}" for this session`);
  }
  const answers = sanitizeAnswers(funnel, body.answers);
  const updatedAt = nowIso();
  stmts(db).updateState.run(JSON.stringify(answers), body.currentStepId, updatedAt, row.id);
  return { ok: true, updatedAt };
}

/**
 * POST /api/sessions/:id/result — saves the answers, validates every visible interactive step
 * (400 `invalid_answers` with per-step details), then computes the result on the pinned
 * version + variant and stores it. Idempotent for the same answers.
 */
export function submitResult(db: DB, sessionId: string, body: { answers: Answers }): SubmitResultResponse {
  const row = loadLive(db, sessionId);
  const funnel = sessionFunnel(db, row);
  const answers = sanitizeAnswers(funnel, body.answers);
  const answersJson = JSON.stringify(answers);
  const s = stmts(db);

  const details = validateVisibleAnswers(funnel, answers);
  if (Object.keys(details).length > 0) {
    s.saveAnswers.run(answersJson, nowIso(), row.id);
    throw new ServiceError(400, 'invalid_answers', 'Some answers are missing or invalid', details);
  }

  const resultId = computeResultId(funnel, answers);
  const result = resolveResult(funnel, resultId);
  if (!result) throw new Error(`Result "${resultId}" is not defined in ${row.funnel_id}@${row.funnel_version}`);
  s.saveResult.run(answersJson, resultId, findResultStepId(funnel), nowIso(), row.id);
  return { resultId, result };
}
