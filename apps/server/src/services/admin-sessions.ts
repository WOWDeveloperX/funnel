/**
 * Admin session list (GET /api/admin/sessions): recent sessions, newest first.
 * status: completed (result_id set) > expired (past expires_at) > in_progress.
 * `totals` counts statuses over every matching session, independent of `limit`.
 */
import type { AdminSessionRow, AdminSessionsResponse, SessionStatus, VariantSource } from '@funnel/shared';
import { type DB, statements } from '../db';

export interface AdminSessionsFilters {
  limit: number;
  funnelId: string | null;
  version: number | null;
  variant: string | null;
}

interface Row {
  id: string;
  funnel_version: number;
  variant: string;
  variant_source: VariantSource;
  utm_campaign: string | null;
  current_step_id: string | null;
  result_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  event_count: number;
}

type FilterParams = [string | null, string | null, number | null, number | null, string | null, string | null];

// NULL filters are no-ops, so one prepared statement covers every combination.
const stmts = statements((db: DB) => ({
  list: db.prepare<[...FilterParams, number], Row>(
    `SELECT s.id, s.funnel_version, s.variant, s.variant_source, s.utm_campaign, s.current_step_id, s.result_id,
            s.created_at, s.updated_at, s.expires_at,
            (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count
       FROM sessions s
      WHERE (? IS NULL OR s.funnel_id = ?)
        AND (? IS NULL OR s.funnel_version = ?)
        AND (? IS NULL OR s.variant = ?)
      ORDER BY s.created_at DESC, s.rowid DESC
      LIMIT ?`,
  ),
  totals: db.prepare<
    [string, ...FilterParams],
    { all_count: number; completed: number | null; expired: number | null }
  >(
    `SELECT COUNT(*) AS all_count,
            SUM(CASE WHEN s.result_id IS NOT NULL THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN s.result_id IS NULL AND s.expires_at <= ? THEN 1 ELSE 0 END) AS expired
       FROM sessions s
      WHERE (? IS NULL OR s.funnel_id = ?)
        AND (? IS NULL OR s.funnel_version = ?)
        AND (? IS NULL OR s.variant = ?)`,
  ),
}));

function sessionStatus(row: Pick<Row, 'result_id' | 'expires_at'>, now: string): SessionStatus {
  if (row.result_id) return 'completed';
  return row.expires_at <= now ? 'expired' : 'in_progress';
}

export function listAdminSessions(db: DB, filters: AdminSessionsFilters, now: string): AdminSessionsResponse {
  const { funnelId, version, variant } = filters;
  const params: FilterParams = [funnelId, funnelId, version, version, variant, variant];
  const s = stmts(db);

  const sessions: AdminSessionRow[] = s.list.all(...params, filters.limit).map((r) => ({
    id: r.id,
    funnelVersion: r.funnel_version,
    variant: r.variant,
    variantSource: r.variant_source,
    utmCampaign: r.utm_campaign,
    currentStepId: r.current_step_id,
    resultId: r.result_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
    status: sessionStatus(r, now),
    eventCount: r.event_count,
  }));

  const t = s.totals.get(now, ...params);
  const all = t?.all_count ?? 0;
  const completed = t?.completed ?? 0;
  const expired = t?.expired ?? 0;
  return { sessions, totals: { all, completed, expired, in_progress: all - completed - expired } };
}
