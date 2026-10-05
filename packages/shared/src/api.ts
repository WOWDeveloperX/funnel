/**
 * Every HTTP request/response type of the public and admin API. Server routes and the web client
 * both import from here, so the wire format has exactly one definition.
 */
import type { Answers } from './conditions';
import type { FunnelConfig } from './config';
import type { ConfigDiff } from './diff';
import type { EventInput, EventPropertyValue } from './events';
import type { TranslationCatalog } from './i18n';
import type { ResolvedFunnel, ResolvedResult } from './resolve';

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** Error body for every non-2xx response. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, string>;
}

export type VariantSource = 'hash' | 'override';
export type ActivationAction = 'seed' | 'publish' | 'activate' | 'rollback';
export type SessionStatus = 'in_progress' | 'completed' | 'expired';

/** Label used for sessions without utm_campaign in filters and breakdowns. */
export const NONE_CAMPAIGN = '(none)';

/** Default admin token header name. */
export const ADMIN_TOKEN_HEADER = 'x-admin-token';

export interface HealthResponse {
  ok: true;
  activeVersion: number | null;
  db: 'ok';
  /** True when ADMIN_TOKEN is set: the admin UI then shows its sign-in screen. */
  adminAuthRequired: boolean;
}

// ---------------------------------------------------------------------------
// Public: sessions
// ---------------------------------------------------------------------------

/** POST /api/sessions */
export interface CreateSessionRequest {
  funnelId?: string;
  /** All URL query params of the landing page (utm_*, variant override, ...). */
  query?: Record<string, string>;
}

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

/** 201 from POST /api/sessions, 200 from GET /api/sessions/:id */
export interface SessionState {
  sessionId: string;
  funnelId: string;
  funnelVersion: number;
  experimentId: string;
  variant: string;
  variantSource: VariantSource;
  utm: UtmParams;
  answers: Answers;
  currentStepId: string | null;
  resultId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  /** Resolved for the PINNED version + variant, in the config's source language (`funnel.locale`). */
  funnel: ResolvedFunnel;
  /**
   * Content translation catalogs of the session's funnel (every available language; empty when there
   * are none). Display-only: the client picks one with catalogFor() and applies localizeFunnel();
   * the display language never affects pinning, variant, events or analytics.
   */
  translations: TranslationCatalog[];
}

/** PUT /api/sessions/:id/state */
export interface UpdateSessionStateRequest {
  answers: Answers;
  currentStepId: string | null;
}

export interface UpdateSessionStateResponse {
  ok: true;
  updatedAt: string;
}

/** POST /api/sessions/:id/result */
export interface SubmitResultRequest {
  answers: Answers;
}

export interface SubmitResultResponse {
  resultId: string;
  result: ResolvedResult;
}

/** 400 body of POST /result when some visible answer is invalid/missing. details: { [stepId]: message } */
export interface InvalidAnswersErrorBody extends ApiErrorBody {
  error: 'invalid_answers';
  details: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Public: translations
// ---------------------------------------------------------------------------

/** GET /api/funnels/:funnelId/translations → 200 (empty list when untranslated) | 404 not_found */
export interface FunnelTranslationsResponse {
  funnelId: string;
  catalogs: TranslationCatalog[];
}

// ---------------------------------------------------------------------------
// Public: events
// ---------------------------------------------------------------------------

/** POST /api/events (1..500 events) */
export interface EventsRequest {
  events: EventInput[];
}

export interface IngestRejection {
  index: number;
  event_id: string | null;
  reason: string;
}

export interface IngestResponse {
  batchId: string;
  accepted: string[];
  duplicates: string[];
  rejected: IngestRejection[];
}

// ---------------------------------------------------------------------------
// Admin: versions
// ---------------------------------------------------------------------------

export interface VariantSummary {
  key: string;
  stepCount: number;
  sequence: string[];
}

export interface VersionSummary {
  version: number;
  title: string;
  releaseNote: string | null;
  createdAt: string;
  isActive: boolean;
  configHash: string;
  sessionCount: number;
  /** Not expired and result_id null. */
  inProgressCount: number;
  /** result_id not null. */
  completedCount: number;
  variants: VariantSummary[];
  eventNames: string[];
}

export interface VersionActivation {
  id: number;
  version: number;
  previousVersion: number | null;
  action: ActivationAction;
  createdAt: string;
}

/** GET /api/admin/versions?funnelId= */
export interface AdminVersionsResponse {
  funnelId: string;
  activeVersion: number | null;
  /** Newest version first. */
  versions: VersionSummary[];
  /** Newest first. */
  activations: VersionActivation[];
  /**
   * The version POST /api/admin/rollback would re-activate (stack semantics over the activation
   * log: publish/activate push, rollback pops), or null when there is nothing to roll back to.
   */
  rollbackTarget: number | null;
}

/** GET /api/admin/versions/:version?funnelId= */
export interface AdminVersionDetailResponse {
  version: number;
  config: FunnelConfig;
}

/** POST /api/admin/versions/validate and POST /api/admin/versions */
export interface ConfigRequest {
  config: unknown;
}

export interface ConfigSummary {
  funnelId: string;
  version: number;
  title: string;
  variants: VariantSummary[];
  eventNames: string[];
  resultIds: string[];
}

export type ExistingVersionState = 'new' | 'identical' | 'conflict';

/** 200 from validate; also the 422 body of publish when invalid. */
export interface ValidateResponse {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: ConfigSummary | null;
  /** Diff vs the currently active version (null if nothing active or config invalid). */
  diff: ConfigDiff | null;
  existing: ExistingVersionState;
}

/** 201 (publish) / 200 (identical version re-activated) from POST /api/admin/versions */
export interface PublishResponse {
  version: number;
  activeVersion: number;
  action: 'publish' | 'activate';
}

/** POST /api/admin/versions/:version/activate and POST /api/admin/rollback */
export interface ActivateResponse {
  activeVersion: number;
  previousVersion: number | null;
}

export interface RollbackRequest {
  funnelId?: string;
}

export type RollbackResponse = ActivateResponse;

// ---------------------------------------------------------------------------
// Admin: sessions & events
// ---------------------------------------------------------------------------

export interface AdminSessionsQuery {
  limit?: number;
  version?: number;
  variant?: string;
}

export interface AdminSessionRow {
  id: string;
  funnelVersion: number;
  variant: string;
  variantSource: VariantSource;
  utmCampaign: string | null;
  currentStepId: string | null;
  resultId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: SessionStatus;
  eventCount: number;
}

/** GET /api/admin/sessions */
export interface AdminSessionsResponse {
  sessions: AdminSessionRow[];
  /** Status totals over ALL sessions matching the filters (not only the `limit` rows returned). */
  totals: Record<SessionStatus, number> & { all: number };
}

export interface AdminEventsQuery {
  limit?: number;
  sessionId?: string;
  name?: string;
}

export interface AdminEventRow {
  eventId: string;
  sessionId: string;
  name: string;
  stepId: string | null;
  funnelVersion: number;
  variant: string;
  utmCampaign: string | null;
  clientTs: string | null;
  serverTs: string;
  properties: Record<string, EventPropertyValue>;
}

export interface IngestTotals {
  batches: number;
  received: number;
  accepted: number;
  duplicates: number;
  rejected: number;
}

export interface RejectedEventRow {
  eventId: string | null;
  reason: string;
  receivedAt: string;
}

export type AdminFeedKind = 'accepted' | 'duplicate' | 'rejected';

/**
 * One line of the live ingest log. `accepted` = stored event; `duplicate` = a later delivery of an
 * already stored event_id (fields taken from the stored original); `rejected` = refused event
 * (fields best-effort from the raw payload, `reason` set).
 */
export interface AdminFeedRow {
  kind: AdminFeedKind;
  /** Stable key for list rendering: `${kind}:${id}`. */
  key: string;
  eventId: string | null;
  receivedAt: string;
  name: string | null;
  sessionId: string | null;
  stepId: string | null;
  funnelVersion: number | null;
  variant: string | null;
  clientTs: string | null;
  properties: Record<string, EventPropertyValue>;
  reason: string | null;
}

/** GET /api/admin/events */
export interface AdminEventsResponse {
  /** Newest server_ts first. */
  events: AdminEventRow[];
  /** Accepted + duplicate + rejected deliveries, newest first, same filters/limit as `events`. */
  feed: AdminFeedRow[];
  totals: IngestTotals;
  /** Last 20. */
  recentRejected: RejectedEventRow[];
}

// ---------------------------------------------------------------------------
// Admin: analytics
// ---------------------------------------------------------------------------

export interface AnalyticsQuery {
  funnelId?: string;
  version?: number | 'all';
  variant?: string | 'all';
  /** Campaign names; use NONE_CAMPAIGN for sessions without utm_campaign. Empty = all. */
  campaigns?: string[];
  excludeOverride?: boolean;
}

/** All rates are fractions in [0, 1]; a zero denominator yields 0. */
export interface Kpis {
  started: number;
  reachedResult: number;
  ctaClicked: number;
  completionRate: number;
  /** Primary A/B metric. */
  ctrFromStarted: number;
  ctrFromResult: number;
  backRate: number;
  /**
   * Guardrail: median seconds from a session's first client event to its first result_viewed,
   * over sessions that reached the result (negative spans from client clock skew clamp to 0).
   * null when no session in the scope reached the result.
   */
  medianTimeToResultSec: number | null;
}

export interface StepMetrics {
  stepId: string;
  type: string;
  /** Base config title. */
  title: string;
  /** Has visibleWhen. */
  conditional: boolean;
  arrived: number;
  viewed: number;
  progressed: number;
  dropOff: number;
  dropOffRate: number;
  conversion: number;
  /**
   * Sessions whose pinned (version, variant) sequence contains this step — the only sessions that
   * could ever see it. Equals the cohort's started count unless the step exists only in some
   * versions/variants (e.g. tool_count only in v3 A).
   */
  eligible: number;
  /** viewed / eligible (NOT viewed / started: a step absent from a variant is not a drop-off). */
  fromStart: number;
  /**
   * Where the step exists when not every (version, variant) of the cohort has it, e.g. "A",
   * "v3", "v3 A"; null when all of them have it.
   */
  onlyIn: string | null;
  /** viewed / arrived — below 1 only for branch steps. */
  shownRate: number;
  backFrom: number;
  avgViewsPerSession: number;
}

export interface VariantAnalytics {
  variant: string;
  kpis: Kpis;
  steps: StepMetrics[];
}

export interface AbArm {
  variant: string;
  rate: number;
  n: number;
  /** Full KPI set of this arm on the test cohort (same version, randomized sessions only). */
  kpis: Kpis;
}

/**
 * A/B test of ONE experiment: the sessions of a single funnel version (each version carries its own
 * experiment — v1 and v3 test different treatments), randomized traffic only (variant_source
 * 'override' is always excluded: a forced variant is not a random assignment).
 */
export interface AbTestResult {
  metric: 'ctrFromStarted';
  /** Funnel version whose experiment is tested: the version filter, else the active version (if it has sessions in the cohort), else the newest version with sessions. */
  version: number;
  experimentId: string | null;
  /** Override (QA) sessions of that version left out of the test. */
  overrideExcluded: number;
  /** Other versions present in the cohort (version filter = all) that are NOT part of the test. */
  otherVersions: number[];
  a: AbArm;
  b: AbArm;
  /** (b.rate - a.rate) * 100 */
  diffPp: number;
  z: number | null;
  pValue: number | null;
  /** p < 0.05 */
  significant: boolean;
  /** each n >= 30 */
  enoughData: boolean;
}

export interface AnalyticsFilters {
  funnelId: string;
  version: number | 'all';
  variant: string | 'all';
  campaigns: string[];
  excludeOverride: boolean;
}

export interface AnalyticsResponse {
  generatedAt: string;
  filters: AnalyticsFilters;
  available: { versions: number[]; variants: string[]; campaigns: string[] };
  kpis: Kpis;
  steps: StepMetrics[];
  /** Ignores the variant filter. */
  variants: VariantAnalytics[];
  abTest: AbTestResult | null;
  /** Ignores the version filter. */
  versions: { version: number; kpis: Kpis }[];
  results: { resultId: string; title: string; sessions: number; ctaClicked: number; ctr: number }[];
  /** Ignores the campaign filter. */
  campaigns: { campaign: string; kpis: Kpis }[];
  /**
   * Non-core events, e.g. recommendation_expanded. `eligible` = cohort sessions whose version allows
   * the event (share = sessions / eligible).
   */
  extraEvents: { name: string; sessions: number; eligible: number }[];
  dataQuality: {
    duplicatesDropped: number;
    rejected: number;
    outOfOrderSessions: number;
    /** Sessions with result_viewed / cta_clicked but no server-side result (not counted as reached). */
    unverifiedResultSessions: number;
  };
}
