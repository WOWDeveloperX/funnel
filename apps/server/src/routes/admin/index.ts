/**
 * Admin API, registered under /api/admin. Access is decided by the scope a route lives in:
 *
 * - open scope: configs and aggregates only (no session ids, no answers) — readable without a token,
 *   so the read-only dashboard can be shared;
 * - protected scope (`requireAdmin` onRequest hook): every mutation, plus the reads that list
 *   session ids. A session id is the bearer capability for /api/sessions/:id (answers, PUT /state),
 *   so those lists must never be public.
 *
 * Auth runs against the matched route, so percent-encoded paths (`/api/%61dmin/rollback`) cannot
 * bypass it, and unknown /api/admin/* paths answer 401 before revealing that they do not exist.
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../auth';
import { sendNotFound } from '../../http/error-handler';
import analyticsRoutes from './analytics';
import eventLogRoutes from './events';
import sessionListRoutes from './sessions';
import { versionReadRoutes, versionWriteRoutes } from './versions';

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.setNotFoundHandler({ preHandler: requireAdmin }, sendNotFound);

  // Open: GET /versions, GET /versions/:version, GET /analytics.
  await app.register(versionReadRoutes);
  await app.register(analyticsRoutes);

  // Protected: GET /sessions, GET /events, POST /versions, /versions/validate, /versions/:v/activate, /rollback.
  await app.register(async (protectedScope) => {
    protectedScope.addHook('onRequest', requireAdmin);
    await protectedScope.register(sessionListRoutes);
    await protectedScope.register(eventLogRoutes);
    await protectedScope.register(versionWriteRoutes);
  });
}
