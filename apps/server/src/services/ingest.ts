/**
 * Event ingestion (POST /api/events). Each event is validated on its own and never fails the batch:
 *
 * 1. shape (EventInputSchema)            → `invalid_shape: …`
 * 2. session must exist                  → `unknown_session`
 * 3. name: client `session_started`      → `server_only_event`;
 *          not in the pinned config       → `event_not_allowed_for_version`
 * 4. step_id must be a step of the session's pinned version + variant → `unknown_step`;
 *    step events (step_viewed, answer_submitted, step_completed, back_clicked) need one
 *    → `missing_step_id`; result_viewed / cta_clicked must be on the pinned result step
 *    → `step_mismatch` (so a client cannot "reach the result" from the intro)
 * 5. client_timestamp must parse         → `invalid_timestamp`
 * 6. properties filtered to the event's whitelist (primitives only) — raw answers never get in
 * 7. funnel/version/experiment/variant/utm copied from the session row (client echoes ignored)
 * 8. INSERT … ON CONFLICT(event_id) DO NOTHING; no change → duplicate (also within one batch),
 *    and each duplicate delivery is logged in `duplicate_deliveries` (shown in the admin live log)
 *
 * The whole batch runs in one transaction, every rejection is stored in `rejected_events`, and an
 * `ingest_batches` row records the totals. Retrying the same batch is therefore safe.
 */
import { randomUUID } from 'node:crypto';
import {
  EventInputSchema,
  type IngestRejection,
  type IngestResponse,
  REJECT_REASONS,
  RESULT_SCOPED_EVENTS,
  type ResolvedFunnel,
  SERVER_ONLY_EVENTS,
  STEP_SCOPED_EVENTS,
  filterProperties,
  findResultStepId,
  isEventAllowed,
  isValidTimestamp,
} from '@funnel/shared';
import { type DB, statements } from '../db';
import { nowIso } from '../lib/time';
import { type SessionRow, getSessionRow, sessionFunnel } from './sessions';

/** Rejected payloads are stored for debugging, capped so a hostile client cannot bloat the DB. */
const MAX_REJECTED_PAYLOAD = 4096;

const stmts = statements((db: DB) => ({
  insertEvent: db.prepare<
    [
      string,
      string,
      string,
      string | null,
      string,
      number,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string,
      string,
      string,
      string,
    ]
  >(
    `INSERT INTO events (event_id, session_id, name, step_id, funnel_id, funnel_version, experiment_id, variant,
                         utm_source, utm_medium, utm_campaign, client_ts, server_ts, properties_json, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`,
  ),
  insertRejected: db.prepare<[string | null, string, string, string | null, string]>(
    `INSERT INTO rejected_events (event_id, batch_id, reason, payload_json, received_at) VALUES (?, ?, ?, ?, ?)`,
  ),
  insertDuplicate: db.prepare<[string, string, string]>(
    `INSERT INTO duplicate_deliveries (event_id, batch_id, received_at) VALUES (?, ?, ?)`,
  ),
  insertBatch: db.prepare<[string, string, number, number, number, number]>(
    `INSERT INTO ingest_batches (id, received_at, total, accepted, duplicates, rejected) VALUES (?, ?, ?, ?, ?, ?)`,
  ),
}));

/** Best-effort event_id of an invalid payload (for the rejection report). */
function rawEventId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = (raw as { event_id?: unknown }).event_id;
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 128) : null;
}

/**
 * Payload stored with a rejection. Property *values* are replaced by their keys — a rejected event
 * may carry raw answers we must not persist (privacy), while the keys are enough for debugging.
 */
function rejectedPayload(raw: unknown): string | null {
  let value: unknown = raw;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const { properties, ...rest } = raw as Record<string, unknown>;
    value =
      properties && typeof properties === 'object'
        ? { ...rest, property_keys: Object.keys(properties as object).slice(0, 50) }
        : rest;
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    return json.length <= MAX_REJECTED_PAYLOAD
      ? json
      : JSON.stringify({ truncated: json.slice(0, MAX_REJECTED_PAYLOAD) });
  } catch {
    return null;
  }
}

function formatShapeError(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const first = issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
  return `${REJECT_REASONS.invalidShape}: ${first}`;
}

interface SessionInfo {
  row: SessionRow;
  funnel: ResolvedFunnel;
}

/** Ingests an already envelope-validated list of raw events (1..MAX_EVENTS_PER_BATCH). */
export function ingestEvents(db: DB, events: readonly unknown[]): IngestResponse {
  const s = stmts(db);
  const batchId = randomUUID();
  const receivedAt = nowIso();
  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: IngestRejection[] = [];

  // Session lookups are cached for the batch (a batch usually belongs to one session).
  const sessions = new Map<string, SessionInfo | null>();
  const lookup = (id: string): SessionInfo | null => {
    if (!sessions.has(id)) {
      const row = getSessionRow(db, id);
      sessions.set(id, row ? { row, funnel: sessionFunnel(db, row) } : null);
    }
    return sessions.get(id) ?? null;
  };

  db.transaction(() => {
    events.forEach((raw, index) => {
      const reject = (reason: string, eventId: string | null = rawEventId(raw)): void => {
        rejected.push({ index, event_id: eventId, reason });
        s.insertRejected.run(eventId, batchId, reason, rejectedPayload(raw), receivedAt);
      };

      // 1. shape
      const parsed = EventInputSchema.safeParse(raw);
      if (!parsed.success) return reject(formatShapeError(parsed.error.issues));
      const ev = parsed.data;

      // 2. session
      const session = lookup(ev.session_id);
      if (!session) return reject(REJECT_REASONS.unknownSession, ev.event_id);
      const { row, funnel } = session;

      // 3. event name vs the pinned config
      if (SERVER_ONLY_EVENTS.includes(ev.name)) return reject(REJECT_REASONS.serverOnly, ev.event_id);
      if (!isEventAllowed(funnel, ev.name)) return reject(REJECT_REASONS.eventNotAllowed, ev.event_id);

      // 4. step must belong to the pinned version + variant
      const stepId = ev.step_id ?? null;
      if (stepId !== null && !Object.prototype.hasOwnProperty.call(funnel.steps, stepId)) {
        return reject(REJECT_REASONS.unknownStep, ev.event_id);
      }
      if (stepId === null && STEP_SCOPED_EVENTS.includes(ev.name)) {
        return reject(REJECT_REASONS.missingStepId, ev.event_id);
      }
      if (RESULT_SCOPED_EVENTS.includes(ev.name) && stepId !== findResultStepId(funnel)) {
        return reject(REJECT_REASONS.stepMismatch, ev.event_id);
      }

      // 5. timestamp (stored normalized to ISO-8601 UTC)
      if (!isValidTimestamp(ev.client_timestamp)) return reject(REJECT_REASONS.invalidTimestamp, ev.event_id);
      const clientTs = new Date(ev.client_timestamp).toISOString();

      // 6. property whitelist
      const properties = filterProperties(funnel, ev.name, ev.properties);

      // 7 + 8. session row is the source of truth; idempotent insert
      const info = s.insertEvent.run(
        ev.event_id,
        row.id,
        ev.name,
        stepId,
        row.funnel_id,
        row.funnel_version,
        row.experiment_id,
        row.variant,
        row.utm_source,
        row.utm_medium,
        row.utm_campaign,
        clientTs,
        receivedAt,
        JSON.stringify(properties),
        batchId,
      );
      if (info.changes > 0) {
        accepted.push(ev.event_id);
      } else {
        duplicates.push(ev.event_id);
        s.insertDuplicate.run(ev.event_id, batchId, receivedAt);
      }
    });

    s.insertBatch.run(batchId, receivedAt, events.length, accepted.length, duplicates.length, rejected.length);
  })();

  return { batchId, accepted, duplicates, rejected };
}
