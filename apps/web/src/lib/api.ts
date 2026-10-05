/**
 * Typed fetch client for every API endpoint. All request/response types come from @funnel/shared.
 *
 * - Non-2xx responses throw ApiError (status + parsed body, e.g. { error, message, details }).
 * - Network failures throw ApiError with status 0 and error 'network_error'.
 * - Admin POSTs and the session-level admin GETs (sessions, events) send `x-admin-token` from
 *   localStorage['fr.adminToken']. A 401 on any admin call (or any mutating call) dispatches the
 *   window event `fr:unauthorized`: the admin shell then returns to its sign-in screen with a toast.
 */
import {
  ADMIN_TOKEN_HEADER,
  type ActivateResponse,
  type AdminEventsQuery,
  type AdminEventsResponse,
  type AdminSessionsQuery,
  type AdminSessionsResponse,
  type AdminVersionDetailResponse,
  type AdminVersionsResponse,
  type AnalyticsQuery,
  type AnalyticsResponse,
  type ApiErrorBody,
  type CreateSessionRequest,
  type EventInput,
  type FunnelTranslationsResponse,
  type HealthResponse,
  type IngestResponse,
  type PublishResponse,
  type RollbackResponse,
  type SessionState,
  type SubmitResultResponse,
  type UpdateSessionStateRequest,
  type UpdateSessionStateResponse,
  type ValidateResponse,
} from '@funnel/shared';

const ADMIN_TOKEN_STORAGE_KEY = 'fr.adminToken';
export const UNAUTHORIZED_EVENT = 'fr:unauthorized';

export class ApiError extends Error {
  readonly status: number;
  /** Parsed JSON body (usually ApiErrorBody, or ValidateResponse for a 422 publish). */
  readonly body: unknown;
  /** Machine-readable code from body.error (e.g. 'not_found', 'expired', 'invalid_answers'). */
  readonly code: string;

  constructor(status: number, body: unknown, fallbackMessage?: string) {
    const b = (body && typeof body === 'object' ? body : {}) as Partial<ApiErrorBody>;
    super(b.message ?? fallbackMessage ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = typeof b.error === 'string' ? b.error : status === 0 ? 'network_error' : `http_${status}`;
  }

  /** `details` of an invalid_answers error: { [stepId]: message }. */
  get details(): Record<string, string> | undefined {
    const b = this.body as Partial<ApiErrorBody> | null;
    return b && typeof b === 'object' ? b.details : undefined;
  }
}

// ---------------------------------------------------------------------------
// Admin token
// ---------------------------------------------------------------------------

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable — token simply won't persist */
  }
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  query?: Query;
  admin?: boolean;
  signal?: AbortSignal;
  keepalive?: boolean;
  /** Use this token instead of the stored one (sign-in check). */
  adminToken?: string;
  /** Dispatch `fr:unauthorized` on 401 (default true). */
  notifyUnauthorized?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.admin) {
    const token = opts.adminToken ?? getAdminToken();
    if (token) headers[ADMIN_TOKEN_HEADER] = token;
  }

  let res: Response;
  try {
    res = await fetch(withQuery(`/api${path}`, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      keepalive: opts.keepalive,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: 'network_error', message: 'Network request failed' });
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: `http_${res.status}`, message: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      opts.notifyUnauthorized !== false &&
      (opts.admin || (opts.method ?? 'GET') !== 'GET') &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/health', { signal });
}

/** POST /api/sessions → 201 SessionState */
export function createSession(body: CreateSessionRequest = {}): Promise<SessionState> {
  return request('/sessions', { method: 'POST', body });
}

/** GET /api/sessions/:id → SessionState; ApiError 404 (not_found) / 410 (expired). */
export function getSession(sessionId: string, signal?: AbortSignal): Promise<SessionState> {
  return request(`/sessions/${enc(sessionId)}`, { signal });
}

/** PUT /api/sessions/:id/state (last write wins). */
export function putSessionState(
  sessionId: string,
  body: UpdateSessionStateRequest,
  opts: { keepalive?: boolean } = {},
): Promise<UpdateSessionStateResponse> {
  return request(`/sessions/${enc(sessionId)}/state`, { method: 'PUT', body, keepalive: opts.keepalive });
}

/** POST /api/sessions/:id/result; ApiError 400 with code 'invalid_answers' and `details`. */
export function submitResult(sessionId: string, answers: Record<string, unknown>): Promise<SubmitResultResponse> {
  return request(`/sessions/${enc(sessionId)}/result`, { method: 'POST', body: { answers } });
}

/** GET /api/funnels/:funnelId/translations → content catalogs (empty list when untranslated); 404 unknown funnel. */
export function getFunnelTranslations(funnelId: string, signal?: AbortSignal): Promise<FunnelTranslationsResponse> {
  return request(`/funnels/${enc(funnelId)}/translations`, { signal });
}

/** POST /api/events (1..500 events) → IngestResponse. */
export function postEvents(events: EventInput[], opts: { keepalive?: boolean } = {}): Promise<IngestResponse> {
  return request('/events', { method: 'POST', body: { events }, keepalive: opts.keepalive });
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

export function getVersions(funnelId?: string, signal?: AbortSignal): Promise<AdminVersionsResponse> {
  return request('/admin/versions', { query: { funnelId }, signal });
}

export function getVersion(
  version: number,
  funnelId?: string,
  signal?: AbortSignal,
): Promise<AdminVersionDetailResponse> {
  return request(`/admin/versions/${version}`, { query: { funnelId }, signal });
}

/** Always 200 with ok/errors/warnings/summary/diff/existing. */
export function validateConfig(config: unknown, signal?: AbortSignal): Promise<ValidateResponse> {
  return request('/admin/versions/validate', { method: 'POST', body: { config }, admin: true, signal });
}

/** 201 publish / 200 identical re-activate; ApiError 422 (body: ValidateResponse) or 409 (conflict). */
export function publishConfig(config: unknown): Promise<PublishResponse> {
  return request('/admin/versions', { method: 'POST', body: { config }, admin: true });
}

export function activateVersion(version: number, funnelId?: string): Promise<ActivateResponse> {
  return request(`/admin/versions/${version}/activate`, {
    method: 'POST',
    body: {},
    query: { funnelId },
    admin: true,
  });
}

/** ApiError 409 if there is no previous version to roll back to. */
export function rollback(funnelId?: string): Promise<RollbackResponse> {
  return request('/admin/rollback', { method: 'POST', body: funnelId ? { funnelId } : {}, admin: true });
}

export function getAdminSessions(query: AdminSessionsQuery = {}, signal?: AbortSignal): Promise<AdminSessionsResponse> {
  return request('/admin/sessions', { query: { ...query }, signal, admin: true });
}

export function getAdminEvents(query: AdminEventsQuery = {}, signal?: AbortSignal): Promise<AdminEventsResponse> {
  return request('/admin/events', { query: { ...query }, signal, admin: true });
}

/**
 * Checks an admin token against a protected read (GET /admin/sessions?limit=1) without storing it
 * and without triggering the global 401 handler. true = accepted, false = 401; other failures throw.
 */
export async function verifyAdminToken(token: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await request<AdminSessionsResponse>('/admin/sessions', {
      query: { limit: 1 },
      admin: true,
      adminToken: token,
      notifyUnauthorized: false,
      signal,
    });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}

/** campaigns → `campaign=c1,c2` ('(none)' = no campaign); excludeOverride → 0|1. */
export function getAnalytics(query: AnalyticsQuery = {}, signal?: AbortSignal): Promise<AnalyticsResponse> {
  return request('/admin/analytics', {
    query: {
      funnelId: query.funnelId,
      version: query.version ?? 'all',
      variant: query.variant ?? 'all',
      campaign: query.campaigns && query.campaigns.length ? query.campaigns : undefined,
      excludeOverride: query.excludeOverride ? 1 : 0,
    },
    signal,
  });
}
