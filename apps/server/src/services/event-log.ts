/**
 * Admin event log (GET /api/admin/events): stored events, the merged delivery feed and ingest totals.
 */
import type { AdminEventRow, AdminEventsResponse, AdminFeedRow, EventPropertyValue } from '@funnel/shared';
import { type DB, statements } from '../db';

export interface AdminEventsFilters {
  limit: number;
  sessionId: string | null;
  name: string | null;
}

interface AdminEventDbRow {
  event_id: string;
  session_id: string;
  name: string;
  step_id: string | null;
  funnel_version: number;
  variant: string;
  utm_campaign: string | null;
  client_ts: string | null;
  server_ts: string;
  properties_json: string;
}

function parseProperties(json: string): Record<string, EventPropertyValue> {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, EventPropertyValue>) : {};
  } catch {
    return {};
  }
}

/** Best-effort string field of a rejected payload (it was refused, so nothing about it is trusted). */
function payloadString(payload: Record<string, unknown>, key: string, max = 128): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

function parsePayload(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface DuplicateDbRow extends Omit<AdminEventDbRow, 'utm_campaign' | 'server_ts'> {
  id: number;
  received_at: string;
}

interface RejectedDbRow {
  id: number;
  event_id: string | null;
  reason: string;
  payload_json: string | null;
  received_at: string;
  funnel_version: number | null;
  variant: string | null;
}

/** Filter params as bound by every statement below: (sessionId, sessionId, name, name, limit). */
type FilterParams = [string | null, string | null, string | null, string | null, number];

// NULL filters are no-ops, so one static statement per source covers every combination.
// Rejected payload fields are extracted in SQL only for filtering; json_valid guards non-JSON payloads.
const stmts = statements((db: DB) => ({
  events: db.prepare<FilterParams, AdminEventDbRow>(
    `SELECT event_id, session_id, name, step_id, funnel_version, variant, utm_campaign, client_ts, server_ts,
            properties_json
       FROM events
      WHERE (? IS NULL OR session_id = ?) AND (? IS NULL OR name = ?)
      ORDER BY server_ts DESC, rowid DESC
      LIMIT ?`,
  ),
  duplicates: db.prepare<FilterParams, DuplicateDbRow>(
    `SELECT d.id, d.event_id, d.received_at, e.session_id, e.name, e.step_id, e.funnel_version, e.variant,
            e.client_ts, e.properties_json
       FROM duplicate_deliveries d JOIN events e ON e.event_id = d.event_id
      WHERE (? IS NULL OR e.session_id = ?) AND (? IS NULL OR e.name = ?)
      ORDER BY d.received_at DESC, d.id DESC
      LIMIT ?`,
  ),
  rejected: db.prepare<FilterParams, RejectedDbRow>(
    `SELECT r.id, r.event_id, r.reason, r.payload_json, r.received_at, s.funnel_version, s.variant
       FROM rejected_events r
       LEFT JOIN sessions s
         ON s.id = (CASE WHEN json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.session_id') END)
      WHERE (? IS NULL OR (CASE WHEN json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.session_id') END) = ?)
        AND (? IS NULL OR (CASE WHEN json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.name') END) = ?)
      ORDER BY r.received_at DESC, r.id DESC
      LIMIT ?`,
  ),
  totals: db.prepare<[], AdminEventsResponse['totals']>(
    `SELECT COUNT(*) AS batches, COALESCE(SUM(total), 0) AS received, COALESCE(SUM(accepted), 0) AS accepted,
            COALESCE(SUM(duplicates), 0) AS duplicates, COALESCE(SUM(rejected), 0) AS rejected
       FROM ingest_batches`,
  ),
  recentRejected: db.prepare<[], { event_id: string | null; reason: string; received_at: string }>(
    'SELECT event_id, reason, received_at FROM rejected_events ORDER BY id DESC LIMIT 20',
  ),
}));

const FEED_KIND_ORDER: Record<AdminFeedRow['kind'], number> = { rejected: 0, duplicate: 1, accepted: 2 };

function filterParams(filters: AdminEventsFilters): FilterParams {
  return [filters.sessionId, filters.sessionId, filters.name, filters.name, filters.limit];
}

/**
 * GET /api/admin/events: newest events first (server_ts, then insertion order), the merged delivery
 * feed (accepted + duplicate + rejected, newest received first), global ingest totals.
 */
export function listAdminEvents(db: DB, filters: AdminEventsFilters): AdminEventsResponse {
  const s = stmts(db);
  const events: AdminEventRow[] = s.events.all(...filterParams(filters)).map((r) => ({
    eventId: r.event_id,
    sessionId: r.session_id,
    name: r.name,
    stepId: r.step_id,
    funnelVersion: r.funnel_version,
    variant: r.variant,
    utmCampaign: r.utm_campaign,
    clientTs: r.client_ts,
    serverTs: r.server_ts,
    properties: parseProperties(r.properties_json),
  }));

  const feed = listFeed(db, filters, events);
  const totals = s.totals.get() as AdminEventsResponse['totals'];
  const recentRejected = s.recentRejected
    .all()
    .map((r) => ({ eventId: r.event_id, reason: r.reason, receivedAt: r.received_at }));

  return { events, feed, totals, recentRejected };
}

/**
 * The live ingest log: every delivery, not only stored events.
 * - accepted  = rows of `events` (receivedAt = server_ts) — the same rows as `events`;
 * - duplicate = rows of `duplicate_deliveries`, described by the stored original event;
 * - rejected  = rows of `rejected_events`; name/session/step/client time are best-effort from the
 *   stored payload (property values are never stored), version/variant from the session if it exists.
 * Each source is read newest-first up to `limit` with the same sessionId/name filters, then merged by
 * receivedAt (ties: rejected, duplicate, accepted; then each source's own order) and cut to `limit`.
 */
function listFeed(db: DB, filters: AdminEventsFilters, accepted: readonly AdminEventRow[]): AdminFeedRow[] {
  const s = stmts(db);
  const params = filterParams(filters);
  type Ranked = { row: AdminFeedRow; seq: number };
  const out: Ranked[] = [];
  let seq = 0;

  for (const e of accepted) {
    out.push({
      seq: seq++,
      row: {
        kind: 'accepted',
        key: `accepted:${e.eventId}`,
        eventId: e.eventId,
        receivedAt: e.serverTs,
        name: e.name,
        sessionId: e.sessionId,
        stepId: e.stepId,
        funnelVersion: e.funnelVersion,
        variant: e.variant,
        clientTs: e.clientTs,
        properties: e.properties,
        reason: null,
      },
    });
  }

  for (const d of s.duplicates.all(...params)) {
    out.push({
      seq: seq++,
      row: {
        kind: 'duplicate',
        key: `duplicate:${d.id}`,
        eventId: d.event_id,
        receivedAt: d.received_at,
        name: d.name,
        sessionId: d.session_id,
        stepId: d.step_id,
        funnelVersion: d.funnel_version,
        variant: d.variant,
        clientTs: d.client_ts,
        properties: parseProperties(d.properties_json),
        reason: null,
      },
    });
  }

  for (const r of s.rejected.all(...params)) {
    const payload = parsePayload(r.payload_json);
    out.push({
      seq: seq++,
      row: {
        kind: 'rejected',
        key: `rejected:${r.id}`,
        eventId: r.event_id,
        receivedAt: r.received_at,
        name: payloadString(payload, 'name', 64),
        sessionId: payloadString(payload, 'session_id'),
        stepId: payloadString(payload, 'step_id'),
        funnelVersion: r.funnel_version,
        variant: r.variant,
        clientTs: payloadString(payload, 'client_timestamp', 64),
        properties: {},
        reason: r.reason,
      },
    });
  }

  out.sort(
    (a, b) =>
      (a.row.receivedAt < b.row.receivedAt ? 1 : a.row.receivedAt > b.row.receivedAt ? -1 : 0) ||
      FEED_KIND_ORDER[a.row.kind] - FEED_KIND_ORDER[b.row.kind] ||
      a.seq - b.seq,
  );
  return out.slice(0, filters.limit).map((r) => r.row);
}
