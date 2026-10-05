import { ApiError } from '../../lib/api';
import type { ToastApi } from '../components/toast-context';
import type { AdminMessages } from '../i18n';

type ErrorCopy = Pick<AdminMessages, 'errors'>;

/**
 * Human message for any thrown value (ApiError extends Error). Transport failures get UI copy in
 * the selected language; other API errors show the server's message (technical, English).
 */
export function errorMessage(err: unknown, t: ErrorCopy): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t.errors.unauthorized;
    if (err.status === 0) return t.errors.network;
    if (err.status >= 500) return t.errors.server;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Toast for a failed admin action. 401s are skipped: the api client already dispatches
 * `fr:unauthorized`, which AdminApp turns into a single "token required" toast.
 */
export function toastActionError(toast: ToastApi, title: string, err: unknown, t: ErrorCopy): void {
  if (err instanceof ApiError && err.status === 401) return;
  toast.error(title, errorMessage(err, t));
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
