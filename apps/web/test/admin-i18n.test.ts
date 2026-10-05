/**
 * Admin dictionaries and language-bound formatting: identical keys in every language, the Russian
 * default renders exactly as before, English is complete, and funnel content shown in the admin goes
 * through the content catalogs.
 */
import { parseCatalog, validateConfig, type ValidateResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import ruCatalogJson from '../../../configs/translations/workstyle-planner.ru.json';
import { adminI18n } from '../src/admin/i18n';
import { en } from '../src/admin/i18n/en';
import { ru } from '../src/admin/i18n/ru';
import { contentText } from '../src/admin/lib/contentText';
import { buildCheckRows, diffLines, translateIssue } from '../src/admin/versions/validationModel';

/** Dot paths of every leaf (functions and arrays are leaves; `reasons` / `issues` are data maps). */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    const isMap = k === 'reasons' || k === 'issues' || k === 'dayMonth';
    return v && typeof v === 'object' && !Array.isArray(v) && !isMap
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

const hasCyrillic = (s: string) => /[А-Яа-яЁё]/.test(s);

describe('admin dictionaries', () => {
  it('ru and en have exactly the same keys', () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(ru).sort());
  });

  it('English has no Russian left in it', () => {
    const strings = JSON.stringify(en, (_k, v: unknown) => (typeof v === 'function' ? String(v) : v));
    expect(hasCyrillic(strings)).toBe(false);
    expect(en.analytics.rules).toHaveLength(ru.analytics.rules.length);
  });

  it('plurals follow Intl.PluralRules in each language', () => {
    expect(ru.common.sessions('1', 1)).toBe('1 сессия');
    expect(ru.common.sessions('3', 3)).toBe('3 сессии');
    expect(ru.common.sessions('11', 11)).toBe('11 сессий');
    expect(ru.publish.errors(22)).toBe('22 ошибки');
    expect(en.common.sessions('1', 1)).toBe('1 session');
    expect(en.common.sessions('3', 3)).toBe('3 sessions');
    expect(en.validation.steps(1)).toBe('1 step');
  });
});

describe('admin formatters', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');

  it('Russian (default) uses Russian number formatting', () => {
    const f = adminI18n('ru').fmt;
    expect(f.int(12345)).toBe('12 345');
    expect(f.pp(3.21)).toBe('+3,2 п.п.');
    expect(f.pp(-0.01)).toBe('±0,0 п.п.');
    expect(f.pct(0.425).replace(/\s/g, ' ')).toBe('42,5 %');
    expect(f.pct(0.425, 0).replace(/\s/g, ' ')).toBe('43 %');
    expect(f.decimal(1.068, 2)).toBe('1,07');
    expect(f.pValue(0.0004)).toBe('p<0,001');
    expect(f.pValue(0.004)).toBe('p=0,004');
    expect(f.pValue(0.123)).toBe('p=0,12');
    expect(f.durationDelta(12)).toBe('+12 с');
    expect(f.durationDelta(-65)).toBe('−1:05');
    expect(f.relative('2026-10-05T11:59:58Z', now)).toBe('только что');
    expect(f.relative('2026-10-05T11:55:00Z', now)).toBe('5 мин назад');
    expect(f.relative('2026-10-05T14:00:00Z', now)).toBe('через 2 ч');
    const d = new Date(2020, 2, 7, 9, 5);
    expect(f.dateTime(d.toISOString())).toBe('07.03.2020 09:05');
  });

  it('English uses English units and Intl formatting', () => {
    const f = adminI18n('en').fmt;
    expect(f.int(12345)).toBe('12,345');
    expect(f.pp(3.21)).toBe('+3.2 pp');
    expect(f.pct(0.425)).toBe('42.5%');
    expect(f.decimal(1.068, 2)).toBe('1.07');
    expect(f.pValue(0.004)).toBe('p=0.004');
    expect(f.durationDelta(12)).toBe('+12s');
    expect(f.relative('2026-10-05T11:55:00Z', now)).toBe('5 min ago');
    expect(f.relative('2026-10-05T14:00:00Z', now)).toBe('in 2 h');
    expect(f.relative('2026-10-05T11:59:58Z', now)).toBe('just now');
    const d = new Date(2020, 2, 7, 9, 5);
    expect(f.dateTime(d.toISOString())).toBe('7 Mar 2020 09:05');
  });

  it('one stable object per language (safe as a memo dependency)', () => {
    expect(adminI18n('ru')).toBe(adminI18n('ru'));
    expect(adminI18n('en').lang).toBe('en');
  });
});

describe('publish checklist in English', () => {
  it('server issues stay in their original English, check titles come from the dictionary', () => {
    const raw = structuredClone(v1Config) as Record<string, unknown> & { defaultResultId: string };
    raw.defaultResultId = 'missing';
    const { ok, errors, warnings } = validateConfig(raw);
    const result: ValidateResponse = { ok, errors, warnings, summary: null, diff: null, existing: 'new' };

    const rows = buildCheckRows(result, raw, en.validation);
    for (const row of rows) expect(hasCyrillic(row.text), row.text).toBe(false);
    expect(rows.some((r) => r.text === en.validation.checks.schema)).toBe(true);
    // Russian stays the default of the pure model.
    expect(hasCyrillic(translateIssue('unknown step "x"'))).toBe(true);
    expect(translateIssue('unknown step "x"', null, en.validation)).toBe('unknown step "x"');
  });

  it('diff lines use the dictionary for "no changes"', () => {
    const diff = {
      fromVersion: 1,
      toVersion: 3,
      stepsAdded: [],
      stepsRemoved: [],
      stepsChanged: [],
      variants: {},
      experimentChanged: false,
      eventsAdded: [],
      eventsRemoved: [],
      resultsAdded: [],
      resultsRemoved: [],
    } as unknown as Parameters<typeof diffLines>[0];
    expect(diffLines(diff, en.validation).map((l) => l.text)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(diffLines(diff).map((l) => l.text)).toEqual(['без изменений', 'без изменений', 'без изменений']);
  });
});

describe('funnel content in the admin', () => {
  const catalogs = [parseCatalog(ruCatalogJson)];
  const title = v1Config.title;

  it('Russian shows the catalog translation of result / step / version copy', () => {
    const text = contentText(catalogs, 'ru');
    expect(text(title)).toBe(catalogs[0]!.messages[title]);
    expect(hasCyrillic(text(title))).toBe(true);
  });

  it('falls back to the source text: untranslated strings, no catalog, or the source language', () => {
    expect(contentText(catalogs, 'ru')('Some brand new copy')).toBe('Some brand new copy');
    expect(contentText([], 'ru')(title)).toBe(title);
    expect(contentText(catalogs, 'en')(title)).toBe(title);
  });
});
