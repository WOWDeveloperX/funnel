/**
 * Public session endpoints:
 *   POST /api/sessions                 → 201 SessionState
 *   GET  /api/sessions/:id             → 200 SessionState | 404 not_found | 410 expired
 *   PUT  /api/sessions/:id/state       → 200 { ok, updatedAt }
 *   POST /api/sessions/:id/result      → 200 { resultId, result } | 400 invalid_answers
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  CreateSessionRequest,
  SessionState,
  SubmitResultResponse,
  UpdateSessionStateResponse,
} from '@funnel/shared';
import { parseOrThrow } from '../lib/errors';
import { createSession, getSession, submitResult, updateSessionState } from '../services/sessions';

const CreateBody = z
  .object({
    funnelId: z.string().min(1).max(100).optional(),
    // URL query params of the landing page; only string values are meaningful.
    query: z.record(z.string(), z.unknown()).optional(),
  })
  .nullish();

const AnswersSchema = z.record(z.string().max(100), z.unknown());

const StateBody = z.object({
  answers: AnswersSchema,
  currentStepId: z.string().min(1).max(128).nullable(),
});

const ResultBody = z.object({ answers: AnswersSchema });

const Params = z.object({ id: z.string().min(1) });

export default async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  const { db, defaultFunnelId, translations } = app.ctx;

  app.post('/sessions', async (request, reply): Promise<SessionState> => {
    const body = parseOrThrow(CreateBody, request.body) ?? {};
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.query ?? {})) if (typeof v === 'string') query[k] = v;
    const req: CreateSessionRequest = { query };
    if (body.funnelId) req.funnelId = body.funnelId;
    const state = createSession(db, req, { defaultFunnelId, translations });
    void reply.code(201);
    return state;
  });

  app.get('/sessions/:id', async (request): Promise<SessionState> => {
    const { id } = parseOrThrow(Params, request.params, 'params');
    return getSession(db, id, translations);
  });

  app.put('/sessions/:id/state', async (request): Promise<UpdateSessionStateResponse> => {
    const { id } = parseOrThrow(Params, request.params, 'params');
    const body = parseOrThrow(StateBody, request.body);
    return updateSessionState(db, id, body);
  });

  app.post('/sessions/:id/result', async (request): Promise<SubmitResultResponse> => {
    const { id } = parseOrThrow(Params, request.params, 'params');
    const body = parseOrThrow(ResultBody, request.body);
    return submitResult(db, id, body);
  });
}
