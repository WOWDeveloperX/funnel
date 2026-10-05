/** UI language preference: ?lang= > localStorage['fr.lang'] > default ru, persistence and URL sync. */
import { DEFAULT_LANGUAGE } from '@funnel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_STORAGE_KEY,
  languageFromSearch,
  readStoredLanguage,
  resolveLanguage,
  storeLanguage,
  syncLanguageParam,
} from '../src/lib/language';
import { FakeWindow, MemoryStorage } from './support/browser';

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('language resolution', () => {
  it('defaults to Russian when nothing is chosen', () => {
    expect(DEFAULT_LANGUAGE).toBe('ru');
    expect(resolveLanguage('')).toBe('ru');
    expect(resolveLanguage('?utm_source=x')).toBe('ru');
  });

  it('a stored choice wins over the default', () => {
    storeLanguage('en');
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(resolveLanguage('')).toBe('en');
  });

  it('?lang= wins over the stored choice and is persisted (case-insensitive)', () => {
    storeLanguage('ru');
    expect(resolveLanguage('?lang=EN&step=team_size')).toBe('en');
    expect(readStoredLanguage()).toBe('en');
    // A later visit without the param keeps the choice.
    expect(resolveLanguage('?step=team_size')).toBe('en');
  });

  it('unsupported values are ignored, never stored', () => {
    expect(languageFromSearch('?lang=de')).toBeNull();
    expect(resolveLanguage('?lang=de')).toBe('ru');
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();

    storage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(readStoredLanguage()).toBeNull();
    expect(resolveLanguage('')).toBe('ru');
  });

  it('unavailable storage (private mode) never throws and falls back to the URL / default', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => storeLanguage('en')).not.toThrow();
    expect(readStoredLanguage()).toBeNull();
    expect(resolveLanguage('?lang=en')).toBe('en');
    expect(resolveLanguage('')).toBe('ru');
  });
});

describe('?lang= in the address bar', () => {
  it('is rewritten to the language picked in the UI, keeping other params and the history state', () => {
    const win = new FakeWindow('http://localhost/?lang=en&step=work_mode&utm_campaign=spring');
    win.history.replaceState({ fr: { stepId: 'work_mode', from: 'intro' } }, '', win.location.href);
    vi.stubGlobal('window', win);

    syncLanguageParam('ru');
    expect(win.url.searchParams.get('lang')).toBe('ru');
    expect(win.url.searchParams.get('step')).toBe('work_mode');
    expect(win.url.searchParams.get('utm_campaign')).toBe('spring');
    expect(win.history.state).toEqual({ fr: { stepId: 'work_mode', from: 'intro' } });
  });

  it('is not added when the URL has none (the stored preference is enough)', () => {
    const win = new FakeWindow('http://localhost/?step=work_mode');
    vi.stubGlobal('window', win);
    syncLanguageParam('en');
    expect(win.url.searchParams.has('lang')).toBe(false);
  });
});
