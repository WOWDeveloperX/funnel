import { ApiError } from '../../lib/api';

/** Why the funnel could not start; the screen copy for each kind lives in the chrome strings. */
export type BootErrorKind = 'network' | 'server' | 'empty' | 'unknown';

/** Network failure or 5xx: the server may still have the session, so a cached snapshot is usable. */
export function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError ? err.status === 0 || err.status >= 500 : true;
}

export function bootErrorKind(err: unknown): BootErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network';
    if (err.status >= 500) return 'server';
    return 'unknown';
  }
  // fetch() rejects with a TypeError when the request never reached the server.
  return err instanceof TypeError ? 'network' : 'unknown';
}
