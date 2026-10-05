/**
 * Funnel versions.
 *   GET  /versions?funnelId=                  (open)
 *   GET  /versions/:version?funnelId=         (open)
 *   POST /versions/validate        { config } (protected)
 *   POST /versions                 { config } (protected) → 201 publish | 200 activate | 422 | 409
 *   POST /versions/:version/activate          (protected; funnelId in query or body)
 *   POST /rollback                 { funnelId? } (protected)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ActivateResponse,
  AdminVersionDetailResponse,
  AdminVersionsResponse,
  PublishResponse,
  RollbackResponse,
  ValidateResponse,
} from '@funnel/shared';
import { badRequest, parseOrThrow } from '../../lib/errors';
import {
  activateVersion,
  getVersionDetail,
  listVersions,
  publishConfig,
  rollback,
  validateCandidate,
} from '../../services/versions';

const FunnelQuery = z.object({ funnelId: z.string().min(1).max(100).optional() });
const VersionParams = z.object({ version: z.coerce.number().int().positive() });
const OptionalFunnelBody = z.object({ funnelId: z.string().min(1).max(100).optional() }).nullish();
/** `{ config }` is required; its content is validated by validateConfig (errors come back in the response). */
const ConfigBody = z.object({ config: z.unknown() }).refine((body) => body.config !== undefined);

function configFromBody(body: unknown): unknown {
  const parsed = ConfigBody.safeParse(body);
  if (!parsed.success) throw badRequest('Body must be { config: <funnel config JSON> }');
  return parsed.data.config;
}

export async function versionReadRoutes(app: FastifyInstance): Promise<void> {
  const { db, defaultFunnelId } = app.ctx;

  app.get('/versions', async (request): Promise<AdminVersionsResponse> => {
    const { funnelId } = parseOrThrow(FunnelQuery, request.query, 'query');
    return listVersions(db, funnelId ?? defaultFunnelId);
  });

  app.get('/versions/:version', async (request): Promise<AdminVersionDetailResponse> => {
    const { version } = parseOrThrow(VersionParams, request.params, 'params');
    const { funnelId } = parseOrThrow(FunnelQuery, request.query, 'query');
    return getVersionDetail(db, funnelId ?? defaultFunnelId, version);
  });
}

export async function versionWriteRoutes(app: FastifyInstance): Promise<void> {
  const { db, defaultFunnelId } = app.ctx;

  app.post('/versions/validate', async (request): Promise<ValidateResponse> => {
    return validateCandidate(db, configFromBody(request.body));
  });

  app.post('/versions', async (request, reply): Promise<PublishResponse | ValidateResponse> => {
    const outcome = publishConfig(db, configFromBody(request.body));
    switch (outcome.kind) {
      case 'invalid':
        return reply.code(422).send(outcome.validation);
      case 'published':
        return reply.code(201).send(outcome.body);
      case 'activated':
        return outcome.body;
    }
  });

  app.post('/versions/:version/activate', async (request): Promise<ActivateResponse> => {
    const { version } = parseOrThrow(VersionParams, request.params, 'params');
    const fromQuery = parseOrThrow(FunnelQuery, request.query, 'query').funnelId;
    const fromBody = parseOrThrow(OptionalFunnelBody, request.body)?.funnelId;
    return activateVersion(db, fromQuery ?? fromBody ?? defaultFunnelId, version);
  });

  app.post('/rollback', async (request): Promise<RollbackResponse> => {
    const body = parseOrThrow(OptionalFunnelBody, request.body);
    return rollback(db, body?.funnelId ?? defaultFunnelId);
  });
}
