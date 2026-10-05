/**
 * Public content translations:
 *   GET /api/funnels/:funnelId/translations → 200 { funnelId, catalogs } | 404 not_found
 *
 * Used by the admin UI to show funnel content (step and result titles, release notes) in the
 * selected language. The funnel itself receives the same catalogs inside its SessionState.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FunnelTranslationsResponse } from '@funnel/shared';
import { parseOrThrow } from '../lib/errors';
import { getFunnelTranslations } from '../services/translations';

const Params = z.object({ funnelId: z.string().min(1).max(100) });

export default async function translationsRoutes(app: FastifyInstance): Promise<void> {
  const { db, translations } = app.ctx;

  app.get('/funnels/:funnelId/translations', async (request): Promise<FunnelTranslationsResponse> => {
    const { funnelId } = parseOrThrow(Params, request.params, 'params');
    return getFunnelTranslations(db, translations, funnelId);
  });
}
