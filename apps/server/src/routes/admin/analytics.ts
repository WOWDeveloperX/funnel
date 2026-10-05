/**
 * GET /analytics — read-only aggregates (open even when ADMIN_TOKEN is set).
 * Query: funnelId=&version=all|<n>&variant=all|A|B&campaign=<c1,c2>&excludeOverride=0|1
 * `campaign` (alias `campaigns`) may be repeated or comma-separated; `(none)` = sessions without utm_campaign.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AnalyticsFilters, AnalyticsResponse } from '@funnel/shared';
import { firstValue, flag, listValues, optionalString } from '../../http/query';
import { badRequest } from '../../lib/errors';
import { computeAnalytics } from '../../services/analytics';

/** `all` (or empty) → 'all'; `3` / `v3` → 3; anything else is a 400. */
const VersionParam = z
  .unknown()
  .optional()
  .transform((v, ctx): number | 'all' => {
    const first = firstValue(v);
    const raw = typeof first === 'string' ? first.trim() : '';
    if (raw === '' || raw === 'all') return 'all';
    if (/^v?\d+$/i.test(raw)) return Number(raw.replace(/^v/i, ''));
    ctx.issues.push({ code: 'custom', message: `Invalid version "${raw}"`, input: v });
    return z.NEVER;
  });

const Query = z.object({
  funnelId: optionalString,
  version: VersionParam,
  variant: optionalString,
  campaign: z.unknown().optional(),
  campaigns: z.unknown().optional(),
  excludeOverride: flag,
});

export default async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/analytics', async (request, reply): Promise<AnalyticsResponse> => {
    const parsed = Query.safeParse(request.query ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid query');
    const q = parsed.data;
    const filters: AnalyticsFilters = {
      funnelId: q.funnelId ?? app.ctx.defaultFunnelId,
      version: q.version,
      variant: q.variant ?? 'all',
      campaigns: listValues(q.campaign, q.campaigns),
      excludeOverride: q.excludeOverride,
    };
    void reply.header('cache-control', 'no-store');
    return computeAnalytics(app.ctx.db, filters);
  });
}
