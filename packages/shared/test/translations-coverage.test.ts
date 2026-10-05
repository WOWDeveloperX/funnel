import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type CatalogEntry,
  catalogFor,
  collectAdminMessages,
  collectMessages,
  type FunnelConfig,
  localizeFunnel,
  parseCatalog,
  type TranslationCatalog,
  unitFor,
} from '../src/index';
import { resolved, v1, v3 } from './helpers';

// Guards the shipped Russian catalog against the shipped configs: every end-user string of both
// versions (all variants) is translated, units carry plural forms, and the copy keeps product voice.
// A new config version with new copy fails here until its strings are added to the catalog.

const catalogPath = fileURLToPath(new URL('../../../configs/translations/workstyle-planner.ru.json', import.meta.url));
const catalog: TranslationCatalog = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')));

const configs: ReadonlyArray<readonly [string, FunnelConfig]> = [
  ['v1', v1()],
  ['v3', v3()],
];

/** Latin-script words allowed in end-user Russian copy. None expected: brand/product names would go here. */
const ACCEPTED_LATIN_USER: readonly string[] = [];
/** Admin-only copy may name technical identifiers: the experiment variant letter and event names. */
const ACCEPTED_LATIN_ADMIN: readonly string[] = ['B', 'recommendation_expanded'];
/** Meta-wording of the source configs that must not leak into product copy (lower-case stems). */
const BANNED_STEMS = ['демо', 'вымышлен', 'тестов', 'фиктив', 'задани'];

const userMessages = [...new Set(configs.flatMap(([, c]) => collectMessages(c)))];
const adminMessages = [...new Set(configs.flatMap(([, c]) => collectAdminMessages(c)))];

/** Every unit (base steps and step overrides of every variant) of both configs. */
const units = [
  ...new Set(
    configs.flatMap(([, c]) => {
      const steps = [
        ...Object.values(c.steps),
        ...Object.values(c.experiment.variants).flatMap((v) => Object.values(v.stepOverrides ?? {})),
      ];
      return steps.flatMap((s) => {
        const unit = (s as { input?: { unit?: unknown } }).input?.unit;
        return typeof unit === 'string' ? [unit] : [];
      });
    }),
  ),
];

function valuesOf(entry: CatalogEntry): string[] {
  return typeof entry === 'string' ? [entry] : Object.values(entry).filter((v): v is string => v !== undefined);
}

function latinWords(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
}

describe('ru catalog — shape', () => {
  it('belongs to the funnel and the ru locale', () => {
    expect(catalog.funnelId).toBe('workstyle-planner');
    expect(catalog.locale).toBe('ru');
    for (const [, c] of configs) expect(catalog.funnelId).toBe(c.funnelId);
  });

  it('is picked for Russian and not for English', () => {
    expect(catalogFor([catalog], 'ru')).toBe(catalog);
    expect(catalogFor([catalog], 'en')).toBeNull();
  });

  it('has no orphan entries (every msgid is a string of v1 or v3)', () => {
    const known = new Set([...userMessages, ...adminMessages]);
    expect(Object.keys(catalog.messages).filter((k) => !known.has(k))).toEqual([]);
  });
});

describe.each(configs)('ru catalog — coverage of %s', (_name, config) => {
  it('translates every end-user message (all steps, variants, results)', () => {
    const messages = collectMessages(config);
    expect(messages.length).toBeGreaterThan(30);
    const missing = messages.filter((m) => {
      const entry = catalog.messages[m];
      return entry === undefined || valuesOf(entry).every((v) => v.trim() === '');
    });
    expect(missing).toEqual([]);
  });

  it('translates the admin-facing release note and description', () => {
    const admin = collectAdminMessages(config);
    expect(admin.filter((m) => typeof catalog.messages[m] !== 'string' || catalog.messages[m] === '')).toEqual([]);
  });

  it.each(['A', 'B'] as const)('variant %s localizes to no leftover English source text', (variant) => {
    const sources = new Set(userMessages);
    const leftovers: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (sources.has(v)) leftovers.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        // `id` fields are technical (a result id like `balanced` equals its humanized tag).
        for (const [key, value] of Object.entries(v)) if (key !== 'id') walk(value);
      }
    };
    const localized = localizeFunnel(resolved(config, variant), catalog);
    walk({ title: localized.title, steps: localized.steps, results: localized.results });
    expect(leftovers).toEqual([]);
  });
});

describe('ru catalog — units', () => {
  it('found the units of both configs', () => {
    expect(units.sort()).toEqual(['days', 'hours', 'people', 'tools']);
  });

  it.each(units)('%s is a plural entry with one/few/many/other', (unit) => {
    const entry = catalog.messages[unit];
    expect(typeof entry).toBe('object');
    const forms = entry as Exclude<CatalogEntry, string>;
    for (const category of ['one', 'few', 'many', 'other'] as const) {
      expect(forms[category], `${unit}.${category}`).toMatch(/^\p{Script=Cyrillic}+$/u);
    }
  });

  it('agrees with numbers in Russian', () => {
    const forms = (unit: string): string[] =>
      [1, 2, 5, 11, 21, 22, 25].map((n) => unitFor({ unit, unitForms: catalog.messages[unit] as never }, n, 'ru'));
    expect(forms('people')).toEqual(['человек', 'человека', 'человек', 'человек', 'человек', 'человека', 'человек']);
    expect(forms('days')).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней']);
    expect(forms('tools')).toEqual([
      'инструмент',
      'инструмента',
      'инструментов',
      'инструментов',
      'инструмент',
      'инструмента',
      'инструментов',
    ]);
    expect(forms('hours')).toEqual(['час', 'часа', 'часов', 'часов', 'час', 'часа', 'часов']);
  });

  it('localizeFunnel carries the plural forms onto number inputs', () => {
    const team = localizeFunnel(resolved(v1(), 'A'), catalog).steps.team_size;
    expect(team?.input?.unit).toBe('человека');
    expect(team?.input?.unitForms?.many).toBe('человек');
    expect(unitFor(team?.input ?? {}, 3, 'ru')).toBe('человека');
  });
});

describe('ru catalog — product voice and typography', () => {
  const entries = Object.entries(catalog.messages);

  it('no translation equals its English source', () => {
    expect(entries.filter(([source, entry]) => valuesOf(entry).includes(source)).map(([s]) => s)).toEqual([]);
  });

  it('end-user copy has no Latin-script words', () => {
    const leaks = userMessages.flatMap((m) => {
      const entry = catalog.messages[m];
      if (entry === undefined) return [];
      return valuesOf(entry)
        .flatMap(latinWords)
        .filter((w) => !ACCEPTED_LATIN_USER.includes(w))
        .map((w) => `${m} → ${w}`);
    });
    expect(leaks).toEqual([]);
  });

  it('admin copy names only accepted technical identifiers in Latin script', () => {
    const leaks = adminMessages.flatMap((m) => {
      const entry = catalog.messages[m];
      if (entry === undefined) return [];
      return valuesOf(entry)
        .flatMap(latinWords)
        .filter((w) => !ACCEPTED_LATIN_ADMIN.includes(w))
        .map((w) => `${m} → ${w}`);
    });
    expect(leaks).toEqual([]);
  });

  it('does not carry the meta-wording of the source configs (demo, fictional, test)', () => {
    const hits = entries.flatMap(([source, entry]) =>
      valuesOf(entry)
        .filter((v) => BANNED_STEMS.some((stem) => v.toLowerCase().includes(stem)))
        .map((v) => `${source} → ${v}`),
    );
    expect(hits).toEqual([]);
  });

  it('uses «ёлочки», a real ellipsis, spaced dashes and lower-case «вы» mid-sentence', () => {
    const problems = entries.flatMap(([source, entry]) =>
      valuesOf(entry).flatMap((v) => {
        const out: string[] = [];
        if (/["„“”]/.test(v)) out.push('straight or English quotes');
        if (v.includes('...')) out.push('three dots instead of …');
        if (/\s-\s/.test(v)) out.push('hyphen used as a dash');
        if (/ —/.test(v)) out.push('dash after a breaking space (use a no-break space)');
        if (/[^.!?…»\s]\s+(?:Вы|Вас|Вам|Вами|Ваш\p{L}*)(?!\p{L})/u.test(v)) out.push('capitalised «Вы»');
        if (/^\s|\s$|\s{2,}/.test(v)) out.push('stray whitespace');
        return out.map((p) => `${source} → ${p}`);
      }),
    );
    expect(problems).toEqual([]);
  });

  it('sentences end with a full stop where the source does, and labels do not', () => {
    const mismatched = entries.flatMap(([source, entry]) =>
      typeof entry === 'string' && /[.?]$/.test(source) !== /[.?]$/.test(entry) ? [`${source} → ${entry}`] : [],
    );
    expect(mismatched).toEqual([]);
  });
});
