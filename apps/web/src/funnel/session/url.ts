/**
 * URL & history helpers. The current step lives in `?step=<id>`; every other query param
 * (utm_*, the variant override, …) is preserved untouched.
 */

/** Our marker inside `history.state`: which step an entry shows and which step pushed it. */
export interface StepHistoryState {
  stepId: string;
  /** Step we navigated forward from when this entry was pushed (null when unknown). */
  from: string | null;
}

/**
 * Params that belong to the runtime itself and are not forwarded to POST /api/sessions
 * (`lang` is a UI preference: it never reaches the session, its variant or analytics).
 */
const INTERNAL_PARAMS = ['step', 'reset', 'lang'];

export function currentUrl(): URL {
  return new URL(window.location.href);
}

/** Landing query sent with POST /api/sessions (utm_*, the variant override param, …). */
export function landingQuery(url: URL = currentUrl()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!INTERNAL_PARAMS.includes(key)) out[key] = value;
  }
  return out;
}

export function readHistoryState(): StepHistoryState | null {
  const st: unknown = window.history.state;
  if (!st || typeof st !== 'object' || !('fr' in st)) return null;
  const fr = (st as { fr: unknown }).fr;
  if (!fr || typeof fr !== 'object' || typeof (fr as StepHistoryState).stepId !== 'string') return null;
  return fr as StepHistoryState;
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function urlForStep(stepId: string): string {
  const url = currentUrl();
  url.searchParams.set('step', stepId);
  url.searchParams.delete('reset');
  return relativeUrl(url);
}

/** Forward navigation: a new history entry. */
export function pushStep(stepId: string, from: string | null): void {
  window.history.pushState({ fr: { stepId, from } satisfies StepHistoryState }, '', urlForStep(stepId));
}

/**
 * Rewrites the current entry. Keeps the entry's `from` only when it already showed this step
 * (e.g. after a reload), and keeps foreign keys (the router's own state) intact.
 */
export function replaceStep(stepId: string): void {
  const existing = readHistoryState();
  const from = existing && existing.stepId === stepId ? existing.from : null;
  const base: unknown = window.history.state;
  const merged = base && typeof base === 'object' ? { ...(base as object) } : {};
  window.history.replaceState({ ...merged, fr: { stepId, from } satisfies StepHistoryState }, '', urlForStep(stepId));
}

/** Drops `?reset=1` once it has been honoured, so a reload does not start yet another session. */
export function removeResetParam(): void {
  const url = currentUrl();
  if (!url.searchParams.has('reset')) return;
  url.searchParams.delete('reset');
  window.history.replaceState(window.history.state, '', relativeUrl(url));
}
