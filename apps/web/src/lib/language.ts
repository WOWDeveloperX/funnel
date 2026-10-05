/**
 * The UI language preference — one for the whole app (public funnel and admin).
 *
 * Resolution order: `?lang=ru|en` in the URL (persisted when valid) → localStorage['fr.lang'] →
 * DEFAULT_LANGUAGE (ru). The language never reaches the server: it does not affect session
 * pinning, the variant, events or analytics; it only selects chrome strings and content catalogs.
 *
 * Storage access is guarded like everywhere else: private mode or disabled storage only loses the
 * persistence, never the page.
 */
import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@funnel/shared';
import { createContext, useContext } from 'react';

export const LANGUAGE_STORAGE_KEY = 'fr.lang';
/** URL query param that selects the language (e.g. a shared link `/?lang=en`). */
export const LANGUAGE_PARAM = 'lang';

/** Valid `?lang=` of a query string (case-insensitive), else null. */
export function languageFromSearch(search: string): Language | null {
  const raw = new URLSearchParams(search).get(LANGUAGE_PARAM)?.trim().toLowerCase();
  return isLanguage(raw) ? raw : null;
}

export function readStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* storage unavailable — the choice lasts for this page only */
  }
}

/** URL param > stored preference > default. A valid URL param is persisted (it is an explicit choice). */
export function resolveLanguage(search: string = currentSearch()): Language {
  const fromUrl = languageFromSearch(search);
  if (fromUrl) {
    storeLanguage(fromUrl);
    return fromUrl;
  }
  return readStoredLanguage() ?? DEFAULT_LANGUAGE;
}

/**
 * Keeps an existing `?lang=` in the address bar in line with a choice made in the UI, so a reload
 * or a copied link shows the language on screen. Adds nothing when the URL has no `lang` param, and
 * keeps the history entry's state (router / funnel step markers) intact.
 */
export function syncLanguageParam(language: Language): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(LANGUAGE_PARAM) || url.searchParams.get(LANGUAGE_PARAM) === language) return;
    url.searchParams.set(LANGUAGE_PARAM, language);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* no history API (tests, sandboxed frames) — the stored preference still applies */
  }
}

function currentSearch(): string {
  try {
    return window.location.search;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// React binding (the provider component lives in LanguageProvider.tsx)
// ---------------------------------------------------------------------------

export interface LanguageContextValue {
  language: Language;
  /** Switches the UI language at once (no reload, no new session) and remembers the choice. */
  setLanguage: (language: Language) => void;
}

export const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
});

/** The selected UI language and its setter (see LanguageProvider). */
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
