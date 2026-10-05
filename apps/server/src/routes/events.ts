/**
 * POST /api/events — batch ingestion. The envelope must hold 1..500 events (else 400); individual
 * events are validated one by one and reported in the 200 IngestResponse (see services/ingest.ts).
 */
import type { FastifyInstance } from 'fastify';
import { EventsEnvelopeSchema, type IngestResponse, MAX_EVENTS_PER_BATCH } from '@funnel/shared';
import { ServiceError } from '../lib/errors';
import { ingestEvents } from '../services/ingest';

export default async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // navigator.sendBeacon sends the JSON batch as text/plain; parse it as JSON when it parses
  // (otherwise the raw string fails the envelope check below). Scoped to this plugin only.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    try {
      done(null, text.length ? JSON.parse(text) : undefined);
    } catch {
      done(null, text);
    }
  });

  app.post('/events', async (request): Promise<IngestResponse> => {
    const envelope = EventsEnvelopeSchema.safeParse(request.body);
    if (!envelope.success) {
      throw new ServiceError(
        400,
        'invalid_batch',
        `Body must be { events: [...] } with 1..${MAX_EVENTS_PER_BATCH} events`,
      );
    }
    return ingestEvents(app.ctx.db, envelope.data.events);
  });
}
