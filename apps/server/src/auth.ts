/**
 * Admin auth: `requireAdmin` is the onRequest hook of the protected admin scope
 * (see routes/admin/index.ts for which routes are protected and why).
 * With no ADMIN_TOKEN configured every request passes (local development).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type ApiErrorBody, ADMIN_TOKEN_HEADER } from '@funnel/shared';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time comparison; hashing first makes both sides equal-length, so the token length does not leak. */
function tokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** Answers 401 unless the request carries the admin token. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const expected = request.server.ctx.adminToken;
  if (!expected) return undefined;
  const provided = request.headers[ADMIN_TOKEN_HEADER];
  if (typeof provided === 'string' && tokenMatches(provided, expected)) return undefined;
  const body: ApiErrorBody = { error: 'unauthorized', message: 'Admin token required' };
  return reply.code(401).send(body);
}
