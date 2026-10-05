/**
 * Admin i18n: `const t = useT()` → the dictionary of the selected UI language (lib/language) plus
 * `t.lang` and the language-bound formatters `t.fmt`. Dictionaries live in ./ru.ts (default, defines
 * the shape) and ./en.ts; both are plain data so non-React helpers can take `t` as an argument.
 */
import type { Language } from '@funnel/shared';
import { useLanguage } from '../../lib/language';
import { createFormatters, type Formatters } from '../lib/format';
import { en } from './en';
import { type AdminMessages, ru } from './ru';

export type { AdminMessages } from './ru';

export type AdminI18n = AdminMessages & { lang: Language; fmt: Formatters };

const DICTIONARIES: Record<Language, AdminMessages> = { ru, en };
const cache = new Map<Language, AdminI18n>();

/** Dictionary + formatters for `lang` (memoized: one stable object per language). */
export function adminI18n(lang: Language): AdminI18n {
  let i18n = cache.get(lang);
  if (!i18n) {
    const messages = DICTIONARIES[lang];
    i18n = { ...messages, lang, fmt: createFormatters(messages) };
    cache.set(lang, i18n);
  }
  return i18n;
}

/** Admin copy and formatters in the selected UI language. */
export function useT(): AdminI18n {
  return adminI18n(useLanguage().language);
}
