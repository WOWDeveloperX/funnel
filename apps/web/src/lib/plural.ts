/**
 * Plural forms through Intl.PluralRules, for chrome strings of the funnel and the admin
 * (content units use unitFor() from @funnel/shared with the catalog's plural entries).
 *
 *   plural('ru', 5, ru3('сессия', 'сессии', 'сессий')) → 'сессий'
 *   plural('en', 1, en2('session', 'sessions'))       → 'session'
 */
import type { PluralCategory, PluralForms } from '@funnel/shared';

const rulesCache = new Map<string, Intl.PluralRules>();

function rulesFor(language: string): Intl.PluralRules {
  let rules = rulesCache.get(language);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(language);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    rulesCache.set(language, rules);
  }
  return rules;
}

/** The form of `forms` for `n` in `language`; falls back to `other`, then to any given form. */
export function plural(language: string, n: number, forms: PluralForms): string {
  const category = (Number.isFinite(n) ? rulesFor(language).select(n) : 'other') as PluralCategory;
  return forms[category] ?? forms.other ?? forms.many ?? forms.one ?? '';
}

/** Russian forms: one (1, 21), few (2–4, 22–24), many (0, 5–20, 25…); fractions use `few`. */
export const ru3 = (one: string, few: string, many: string): PluralForms => ({ one, few, many, other: few });

/** English forms: one / other. */
export const en2 = (one: string, other: string): PluralForms => ({ one, other });
