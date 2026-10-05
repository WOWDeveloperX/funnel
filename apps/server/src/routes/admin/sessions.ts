/**
 * GET /sessions?limit=50&version=&variant=&funnelId= — recent sessions, newest first (protected).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminSessionsResponse } from '@funnel/shared';
import { parseOrThrow } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { listAdminSessions } from '../../services/admin-sessions';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  version: z.coerce.number().int().positive().optional(),
  variant: z.string().min(1).max(32).optional(),
  funnelId: z.string().min(1).max(100).optional(),
});

export default async function sessionListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions', async (request): Promise<AdminSessionsResponse> => {
    const q = parseOrThrow(Query, request.query, 'query');
    return listAdminSessions(
      app.ctx.db,
      { limit: q.limit, funnelId: q.funnelId ?? null, version: q.version ?? null, variant: q.variant ?? null },
      nowIso(),
    );
  });
}
