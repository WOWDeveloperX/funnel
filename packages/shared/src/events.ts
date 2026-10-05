/**
 * Event names, ingest envelope/event schemas and the property whitelist (privacy) helpers.
 */
import { z } from 'zod';
import type { EventsConfig } from './config';

/** The seven core events: every config must allow them, and analytics is computed from them. */
export const CORE_EVENTS = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
] as const;
export type CoreEventName = (typeof CORE_EVENTS)[number];

/** Events only the server may emit (clients get `server_only_event`). */
export const SERVER_ONLY_EVENTS: readonly string[] = ['session_started'];

/** Introduced by funnel v3; the client emits it only if the pinned config allows it. */
export const RECOMMENDATION_EXPANDED = 'recommendation_expanded';

export const MAX_EVENTS_PER_BATCH = 500;
export const EVENT_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

/** Rejection reasons reported in IngestResponse.rejected[].reason (invalid_shape is suffixed with details). */
export const REJECT_REASONS = {
  invalidShape: 'invalid_shape',
  unknownSession: 'unknown_session',
  eventNotAllowed: 'event_not_allowed_for_version',
  serverOnly: 'server_only_event',
  unknownStep: 'unknown_step',
  /** step_viewed / answer_submitted / step_completed / back_clicked without a step_id. */
  missingStepId: 'missing_step_id',
  /** result_viewed / cta_clicked whose step_id is not the session's result step. */
  stepMismatch: 'step_mismatch',
  invalidTimestamp: 'invalid_timestamp',
} as const;

/** Core events that describe one question/info step: step_id is required. */
export const STEP_SCOPED_EVENTS: readonly string[] = [
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
];
/** Core events that only make sense on the result step: step_id must be the pinned result step. */
export const RESULT_SCOPED_EVENTS: readonly string[] = ['result_viewed', 'cta_clicked'];
export type RejectReason = (typeof REJECT_REASONS)[keyof typeof REJECT_REASONS];

const nullableShortString = z.string().max(200).nullable().optional();

/**
 * One client event. `client_timestamp` is only checked to be a string here; parseability is a
 * separate rejection reason (`invalid_timestamp`). Echo fields are accepted but ignored for storage.
 */
export const EventInputSchema = z.object({
  event_id: z.string().regex(EVENT_ID_PATTERN, 'event_id must match [A-Za-z0-9:_-]{8,128}'),
  session_id: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  client_timestamp: z.string().min(1).max(64),
  step_id: z.string().min(1).max(128).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  funnel_id: z.string().max(100).optional(),
  funnel_version: z.number().optional(),
  experiment_id: z.string().max(200).optional(),
  variant: z.string().max(32).optional(),
  utm_source: nullableShortString,
  utm_medium: nullableShortString,
  utm_campaign: nullableShortString,
});
export type EventInput = z.infer<typeof EventInputSchema>;

/** Envelope check only: events are validated one by one so a bad event never fails the batch. */
export const EventsEnvelopeSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

/** True if `ts` is an ISO-ish timestamp that Date can parse. */
export function isValidTimestamp(ts: unknown): boolean {
  return typeof ts === 'string' && ts.length > 0 && Number.isFinite(Date.parse(ts));
}

type HasEvents = { events: Pick<EventsConfig, 'allowed'> };

export function isEventAllowed(funnel: HasEvents, name: string): boolean {
  return funnel.events.allowed.some((e) => e.name === name);
}

/** Whitelisted property keys for `name`, or null if the event is not allowed in this config. */
export function allowedPropertiesFor(funnel: HasEvents, name: string): string[] | null {
  const def = funnel.events.allowed.find((e) => e.name === name);
  return def ? [...(def.properties ?? [])] : null;
}

export type EventPropertyValue = string | number | boolean | null;
export const MAX_PROPERTY_STRING_LENGTH = 256;

/**
 * Keeps only whitelisted keys with primitive values (string/number/boolean/null). Non-finite numbers,
 * objects and arrays are dropped; long strings are truncated. Unknown event → `{}`.
 */
export function filterProperties(
  funnel: HasEvents,
  name: string,
  properties: Record<string, unknown> | null | undefined,
): Record<string, EventPropertyValue> {
  const allowed = allowedPropertiesFor(funnel, name);
  const out: Record<string, EventPropertyValue> = {};
  if (!allowed || !properties) return out;
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    const v = properties[key];
    if (v === null || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'string') out[key] = v.slice(0, MAX_PROPERTY_STRING_LENGTH);
  }
  return out;
}
