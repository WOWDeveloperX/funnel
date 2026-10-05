/**
 * Typed application errors. Services and routes throw them; the single error handler installed by
 * buildApp() (src/http/error-handler.ts) turns them into the `{ error, message, details? }` body.
 * Kept free of Fastify imports so services stay framework-agnostic.
 */
import type { z } from 'zod';

export class ServiceError extends Error {
  constructor(
    readonly statusCode: number,
    /** Machine-readable code: `not_found`, `expired`, `version_conflict`, `invalid_answers`, ... */
    readonly code: string,
    message: string,
    /** Per-field messages (e.g. per-step answer errors). */
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const notFound = (message: string): ServiceError => new ServiceError(404, 'not_found', message);
export const badRequest = (message: string): ServiceError => new ServiceError(400, 'bad_request', message);

/** Parses `input` with a zod schema or throws a 400 `bad_request` with a readable message. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, what = 'body'): z.output<S> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const msg = res.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : what}: ${i.message}`)
    .join('; ');
  throw badRequest(`Invalid ${what}: ${msg}`);
}
