/**
 * Minimal JSON HTTP client over global fetch, used by every script. Non-2xx statuses are returned
 * (request) or thrown as ApiCallError (call); network failures become status 0.
 */
import { ADMIN_TOKEN_HEADER } from '@funnel/shared';

export interface HttpResponse<T> {
  status: number;
  data: T;
}

export class ApiCallError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status === 0 ? 'network error' : `HTTP ${status}`}: ${describeBody(body)}`);
    this.name = 'ApiCallError';
  }

  /** `error` field of the JSON error body (`not_found`, `invalid_answers`, ...). */
  get code(): string | undefined {
    const b = this.body as { error?: unknown } | null;
    return b && typeof b.error === 'string' ? b.error : undefined;
  }
}

function describeBody(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return `${b.error}${typeof b.message === 'string' ? ` — ${b.message}` : ''}`;
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return (text ?? '').slice(0, 300);
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    if (cause?.message) return `${err.message} (${cause.message})`;
    return err.message;
  }
  return String(err);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  /** Retries on network errors / timeouts only (never on HTTP statuses). Use only for idempotent calls. */
  retries?: number;
  timeoutMs?: number;
}

export class ApiClient {
  /** Number of network-level retries performed so far (they can turn into extra duplicates). */
  networkRetries = 0;
  private readonly base: string;

  constructor(
    baseUrl: string,
    readonly token?: string,
    private readonly defaultTimeoutMs = 15_000,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  get baseUrl(): string {
    return this.base;
  }

  /** Sends a request; resolves for any HTTP status. Rejects with ApiCallError(status 0) on network failure. */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    if (this.token) headers[ADMIN_TOKEN_HEADER] = this.token;

    const retries = opts.retries ?? 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(this.base + path, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(opts.timeoutMs ?? this.defaultTimeoutMs),
        });
        const text = await res.text();
        let data: unknown = text;
        if (text.length > 0) {
          try {
            data = JSON.parse(text);
          } catch {
            // keep the raw text (e.g. an HTML error page)
          }
        } else {
          data = null;
        }
        return { status: res.status, data: data as T };
      } catch (err) {
        if (attempt < retries) {
          this.networkRetries++;
          await sleep(200 * 2 ** attempt);
          continue;
        }
        throw new ApiCallError(method, path, 0, { error: 'network_error', message: describeNetworkError(err) });
      }
    }
  }

  /** Like request(), but throws ApiCallError unless the status is one of `expect`. */
  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    expect: number | readonly number[] = [200, 201],
    opts: RequestOptions = {},
  ): Promise<T> {
    const res = await this.request<T>(method, path, body, opts);
    const ok = typeof expect === 'number' ? res.status === expect : expect.includes(res.status);
    if (!ok) throw new ApiCallError(method, path, res.status, res.data);
    return res.data;
  }

  get<T>(path: string, expect: number | readonly number[] = 200): Promise<T> {
    return this.call<T>('GET', path, undefined, expect, { retries: 2 });
  }

  post<T>(path: string, body: unknown = {}, expect: number | readonly number[] = [200, 201]): Promise<T> {
    return this.call<T>('POST', path, body, expect);
  }

  put<T>(path: string, body: unknown, expect: number | readonly number[] = 200): Promise<T> {
    return this.call<T>('PUT', path, body, expect, { retries: 2 });
  }
}

/** Builds `?a=1&b=2`, skipping undefined/null/empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** A one-line hint for the most common failure: the server is not running. */
export function connectionHint(err: unknown, baseUrl: string): string | null {
  if (err instanceof ApiCallError && err.status === 0) {
    return `Cannot reach ${baseUrl}. Is the server running? (npm run dev, or npm start after npm run build)`;
  }
  if (err instanceof ApiCallError && err.status === 401) {
    return 'Admin endpoint returned 401: pass --token <ADMIN_TOKEN> or set the ADMIN_TOKEN env var.';
  }
  return null;
}
