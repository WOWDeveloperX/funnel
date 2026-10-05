/**
 * The one error handler of the app (installed by buildApp, inherited by every route plugin):
 * - ServiceError            → its status and `{ error: code, message, details? }`;
 * - Fastify 4xx errors      → `{ error, message }` (malformed JSON, unsupported media type, ...);
 * - everything else (≥ 500) → logged, and masked as `internal_error` / 'Internal server error'.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@funnel/shared';
import { ServiceError } from '../lib/errors';

function errorCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 404:
      return 'not_found';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'too_many_requests';
    default:
      return status >= 500 ? 'internal_error' : 'error';
  }
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ServiceError) {
    const body: ApiErrorBody = { error: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return reply.code(error.statusCode).send(body);
  }
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, 'request failed');
  const body: ApiErrorBody = {
    error: errorCode(status),
    message: status >= 500 ? 'Internal server error' : error.message,
  };
  return reply.code(status).send(body);
}

/** The JSON 404 body used for unknown API routes. */
export function sendNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const path = request.url.split('?')[0] ?? '';
  const body: ApiErrorBody = { error: 'not_found', message: `Route ${request.method} ${path} not found` };
  return reply.code(404).send(body);
}
