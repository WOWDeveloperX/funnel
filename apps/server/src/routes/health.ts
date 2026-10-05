/**
 * GET /api/health — liveness for the platform health check and the admin UI (which reads
 * adminAuthRequired to decide whether to show its sign-in screen).
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@funnel/shared';
import { pingDb } from '../db';
import { getActiveVersion } from '../services/versions';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => {
    const { db, defaultFunnelId, adminToken } = app.ctx;
    pingDb(db);
    return {
      ok: true,
      activeVersion: getActiveVersion(db, defaultFunnelId),
      db: 'ok',
      adminAuthRequired: adminToken !== null,
    };
  });
}
