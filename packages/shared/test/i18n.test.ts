import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type TranslationCatalog,
  TranslationCatalogSchema,
  catalogFor,
  collectAdminMessages,
  humanizeResultId,
  resultTag,
  collectMessages,
  computeResultId,
  isLanguage,
  languageOf,
  localizeFunnel,
  localizeResult,
  parseCatalog,
  resolveFunnel,
  translate,
  unitFor,
} from '../src/index';
import { v1, v3 } from './helpers';

const PEOPLE = { one: 'человек', few: 'человека', many: 'человек', other: 'человека' };

const ru: TranslationCatalog = {
  funnelId: 'workstyle-planner',
  locale: 'ru',
  messages: {
    "Find your team's operating style": 'Найдите рабочий стиль команды',
    'How many people are on the team?': 'Сколько человек в команде?',
    people: PEOPLE,
    'Enter the team size.': 'Укажите размер команды.',
    'Fully remote': 'Полностью удалённо',
    'Balanced baseline': 'Сбалансированная основа',
    'How should your team really work?': 'Как на самом деле работать вашей команде?',
    'Empty entry': '',
  },
};

describe('languages', () => {
  it('RU is the default; RU and EN are supported', () => {
    expect(DEFAULT_LANGUAGE).toBe('ru');
    expect([...SUPPORTED_LANGUAGES]).toEqual(['ru', 'en']);
    expect(isLanguage('ru')).toBe(true);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage('RU')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it('languageOf takes the primary subtag', () => {
    expect(languageOf('en-AU')).toBe('en');
    expect(languageOf('ru-RU')).toBe('ru');
    expect(languageOf('RU_ru')).toBe('ru');
    expect(languageOf('ru')).toBe('ru');
    expect(languageOf('')).toBe('en');
    expect(languageOf(null)).toBe('en');
    expect(languageOf(undefined)).toBe('en');
  });
});

describe('catalogFor', () => {
  const ruRU: TranslationCatalog = { ...ru, locale: 'ru-RU', messages: {} };

  it('is null for the source language unless a catalog for it exists (override layer)', () => {
    expect(catalogFor([ru], 'en')).toBeNull();
    const en: TranslationCatalog = {
      funnelId: ru.funnelId,
      locale: 'en',
      messages: { people: { one: 'person', other: 'people' } },
    };
    expect(catalogFor([ru, en], 'en')).toBe(en);
  });

  it('finds the catalog of the language, preferring an exact locale', () => {
    expect(catalogFor([ru], 'ru')).toBe(ru);
    expect(catalogFor([ru, ruRU], 'ru-RU')).toBe(ruRU);
    expect(catalogFor([ruRU, ru], 'ru')).toBe(ru);
    expect(catalogFor([ruRU], 'ru')).toBe(ruRU);
  });

  it('is null when no catalog exists for the language', () => {
    expect(catalogFor([], 'ru')).toBeNull();
    expect(catalogFor([ru], 'de')).toBeNull();
  });
});

describe('translate', () => {
  it('string entry → translation; missing/empty → source text', () => {
    expect(translate('How many people are on the team?', ru)).toBe('Сколько человек в команде?');
    expect(translate('Not in the catalog', ru)).toBe('Not in the catalog');
    expect(translate('Empty entry', ru)).toBe('Empty entry');
    expect(translate('How many people are on the team?', null)).toBe('How many people are on the team?');
    expect(translate('', ru)).toBe('');
  });

  it('plural entry → other, then many, then the source', () => {
    expect(translate('people', ru)).toBe('человека');
    const cat: TranslationCatalog = { ...ru, messages: { days: { many: 'дней' }, x: { one: 'один' } } };
    expect(translate('days', cat)).toBe('дней');
    expect(translate('x', cat)).toBe('x');
  });

  it('does not resolve Object.prototype keys', () => {
    expect(translate('constructor', ru)).toBe('constructor');
    expect(translate('toString', ru)).toBe('toString');
  });
});

describe('unitFor', () => {
  it('picks the Intl plural form for the language', () => {
    const input = { unit: 'человека', unitForms: PEOPLE };
    expect(unitFor(input, 1, 'ru')).toBe('человек');
    expect(unitFor(input, 2, 'ru')).toBe('человека');
    expect(unitFor(input, 5, 'ru')).toBe('человек');
    expect(unitFor(input, 21, 'ru')).toBe('человек');
    expect(unitFor(input, 22, 'ru')).toBe('человека');
    expect(unitFor(input, 1.5, 'ru')).toBe('человека');
    expect(unitFor(input, Number.NaN, 'ru')).toBe('человека');
  });

  it('falls back to unit, then empty string', () => {
    expect(unitFor({ unit: 'people' }, 1, 'en')).toBe('people');
    expect(unitFor({}, 3, 'en')).toBe('');
    expect(unitFor({ unit: 'days', unitForms: { other: 'дня' } }, 5, 'ru')).toBe('дня');
    expect(unitFor({ unit: 'дня', unitForms: {} }, 5, 'ru')).toBe('дня');
  });
});

describe('collectMessages', () => {
  it('covers every user-facing string of v1, including variant B overrides', () => {
    const cfg = v1();
    const msgs = collectMessages(cfg);
    expect(msgs[0]).toBe(cfg.title);
    expect(new Set(msgs).size).toBe(msgs.length);
    for (const expected of [
      'people',
      'days',
      'tools',
      'Fully remote',
      'Enter the team size.',
      'For this demo, enter a value up to 200.',
      'Balanced baseline',
      // variant B
      'How should your team really work?',
      'Show me',
      'Your office model can be more intentional',
    ]) {
      expect(msgs).toContain(expected);
    }
    // every step content field and result string of the base config is covered
    for (const step of Object.values(cfg.steps)) {
      for (const value of Object.values(step.content)) if (typeof value === 'string') expect(msgs).toContain(value);
      for (const o of step.input?.options ?? []) expect(msgs).toContain(o.label);
      for (const m of Object.values(step.validation?.messages ?? {})) expect(msgs).toContain(m);
    }
    for (const r of Object.values(cfg.results)) {
      expect(msgs).toEqual(expect.arrayContaining([r.title, r.summary, r.cta.label, ...r.recommendations]));
    }
  });

  it('excludes technical and admin-only data', () => {
    const cfg = v3();
    const msgs = collectMessages(cfg);
    expect(msgs).not.toContain(cfg.description);
    expect(msgs).not.toContain(cfg.releaseNote);
    expect(msgs).not.toContain(cfg.locale);
    expect(msgs).not.toContain('team_size');
    expect(msgs).not.toContain('expand_recommendation');
    expect(msgs).not.toContain('remote');
    expect(msgs).toContain('Open the implementation details');
    expect(collectAdminMessages(cfg)).toEqual([cfg.description, cfg.releaseNote]);
    expect(collectAdminMessages({})).toEqual([]);
  });

  it('collects the humanized id of a result without a badge (its tag on the result screen)', () => {
    const cfg = v3();
    const msgs = collectMessages(cfg);
    expect(msgs).toContain('regulated scale');
    expect(msgs).toContain('async native');
    expect(msgs).not.toContain('regulated_scale');
    expect(resultTag('async_native', {})).toBe('async native');
    expect(resultTag('async_native', { badge: 'Top pick' })).toBe('Top pick');
    expect(humanizeResultId('office-core_x')).toBe('office core x');
  });

  it('is stable and covers every string a resolved v1/v3 funnel can show', () => {
    for (const cfg of [v1(), v3()]) {
      expect(collectMessages(cfg)).toEqual(collectMessages(cfg));
      const msgs = new Set(collectMessages(cfg));
      for (const variant of ['A', 'B']) {
        const f = resolveFunnel(cfg, variant);
        // Translating with an identity catalog of exactly the collected messages must touch every string:
        const marker: TranslationCatalog = {
          funnelId: cfg.funnelId,
          locale: 'ru',
          messages: Object.fromEntries([...msgs].map((m) => [m, `«${m}»`])),
        };
        const loc = localizeFunnel(f, marker);
        const unmarked = collectMessages({
          ...cfg,
          title: loc.title,
          steps: loc.steps,
          results: loc.results,
          experiment: { ...cfg.experiment, variants: {} },
        }).filter((s) => !s.startsWith('«'));
        expect(unmarked).toEqual([]);
      }
    }
  });
});

describe('localizeFunnel / localizeResult', () => {
  it('translates the tag of a result without badge into a badge only when the catalog has it', () => {
    const result = resolveFunnel(v3(), 'A').results.balanced!;
    expect(result.badge).toBeUndefined();
    const withTag: TranslationCatalog = { funnelId: 'f', locale: 'ru', messages: { balanced: 'баланс' } };
    expect(localizeResult(result, withTag, 'balanced').badge).toBe('баланс');
    expect(localizeResult(result, withTag).badge).toBeUndefined();
    expect('badge' in localizeResult(result, { ...withTag, messages: {} }, 'balanced')).toBe(false);
    expect(localizeFunnel(resolveFunnel(v3(), 'A'), withTag).results.balanced!.badge).toBe('баланс');
  });

  it('translates content, keeps ids/values/locale, sets unit plural forms; input untouched', () => {
    const f = resolveFunnel(v1(), 'A');
    const before = JSON.stringify(f);
    const loc = localizeFunnel(f, ru);
    expect(JSON.stringify(f)).toBe(before);
    expect(loc).not.toBe(f);

    expect(loc.title).toBe('Найдите рабочий стиль команды');
    expect(loc.locale).toBe(f.locale);
    expect(loc.stepSequence).toEqual(f.stepSequence);
    expect(loc.resultRules).toEqual(f.resultRules);
    expect(loc.events).toEqual(f.events);

    const team = loc.steps.team_size!;
    expect(team.content.title).toBe('Сколько человек в команде?');
    expect(team.input?.unit).toBe('человека');
    expect(team.input?.unitForms).toEqual(PEOPLE);
    expect(team.input?.name).toBe('team_size');
    expect(team.input?.min).toBe(1);
    expect(team.validation?.messages?.required).toBe('Укажите размер команды.');
    // untranslated strings fall back to the source
    expect(team.validation?.messages?.max).toBe('For this demo, enter a value up to 200.');
    expect(loc.steps.office_days!.input?.unit).toBe('days');
    expect(loc.steps.office_days!.input?.unitForms).toBeUndefined();

    const opt = loc.steps.work_mode!.input!.options![0]!;
    expect(opt).toEqual({ value: 'remote', label: 'Полностью удалённо' });
    expect(loc.results.balanced!.title).toBe('Сбалансированная основа');
    expect(loc.results.balanced!.cta.action).toBe(f.results.balanced!.cta.action);
  });

  it('does not add absent optional fields', () => {
    const f = resolveFunnel(v1(), 'A');
    const loc = localizeFunnel(f, ru);
    expect('durationHint' in loc.steps.intro!.content).toBe(false);
    expect('plan' in loc.results.balanced!).toBe(false);
    expect('badge' in loc.results.balanced!).toBe(false);
  });

  it('navigation and results are identical whatever the language', () => {
    const f = resolveFunnel(v3(), 'B');
    const loc = localizeFunnel(f, ru);
    const answers = { work_mode: 'office', timezone_span: 'same', team_size: 12, async_maturity: 'low' };
    expect(computeResultId(loc, answers)).toBe(computeResultId(f, answers));
  });

  it('variant B overrides are translated from their own source text', () => {
    const loc = localizeFunnel(resolveFunnel(v1(), 'B'), ru);
    expect(loc.steps.intro!.content.title).toBe('Как на самом деле работать вашей команде?');
  });

  it('null catalog returns the input unchanged', () => {
    const f = resolveFunnel(v1(), 'A');
    expect(localizeFunnel(f, null)).toBe(f);
    expect(localizeResult(f.results.balanced!, null)).toBe(f.results.balanced);
  });

  it('localizeResult translates the result including plan and badge', () => {
    const cat: TranslationCatalog = {
      ...ru,
      messages: { ...ru.messages, 'Week 1': 'Неделя 1', New: 'Новое', 'Book a call': 'Записаться' },
    };
    const result = {
      id: 'x',
      title: 'Balanced baseline',
      summary: 'Untranslated summary',
      recommendations: ['Fully remote'],
      cta: { label: 'Book a call', action: 'book' },
      badge: 'New',
      plan: ['Week 1'],
    };
    expect(localizeResult(result, cat)).toEqual({
      id: 'x',
      title: 'Сбалансированная основа',
      summary: 'Untranslated summary',
      recommendations: ['Полностью удалённо'],
      cta: { label: 'Записаться', action: 'book' },
      badge: 'Новое',
      plan: ['Неделя 1'],
    });
  });
});

describe('TranslationCatalogSchema', () => {
  it('accepts string and plural entries', () => {
    expect(parseCatalog(ru)).toEqual(ru);
  });

  it('rejects malformed catalogs', () => {
    const bad = (raw: unknown) => TranslationCatalogSchema.safeParse(raw).success;
    expect(bad({ ...ru, funnelId: '' })).toBe(false);
    expect(bad({ ...ru, locale: 'russian language' })).toBe(false);
    expect(bad({ ...ru, messages: { a: 1 } })).toBe(false);
    expect(bad({ ...ru, messages: { a: { fewer: 'x' } } })).toBe(false);
    expect(bad({ ...ru, messages: { a: {} } })).toBe(false);
    expect(bad({ ...ru, extra: true })).toBe(false);
    expect(bad({ funnelId: 'f', locale: 'ru' })).toBe(false);
  });
});
