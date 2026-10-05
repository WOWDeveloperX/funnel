/**
 * GET /events?limit=100&sessionId=&name= — live event log for the admin UI (protected):
 * newest server_ts first, the merged delivery feed, global ingest totals and the 20 latest rejections.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminEventsResponse } from '@funnel/shared';
import { firstValue, optionalString } from '../../http/query';
import { listAdminEvents } from '../../services/event-log';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// Lenient on purpose (polled by the dashboard): a bad limit falls back to the default.
const Query = z.object({
  limit: z
    .preprocess(firstValue, z.coerce.number().min(1).catch(DEFAULT_LIMIT))
    .transform((n) => Math.min(MAX_LIMIT, Math.floor(n))),
  sessionId: optionalString,
  name: optionalString,
});

export default async function eventLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/events', async (request, reply): Promise<AdminEventsResponse> => {
    const filters = Query.parse(request.query ?? {});
    void reply.header('cache-control', 'no-store');
    return listAdminEvents(app.ctx.db, filters);
  });
}
