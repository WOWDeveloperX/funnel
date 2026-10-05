import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FunnelTranslationsResponse, SessionState, TranslationCatalog } from '@funnel/shared';
import { loadConfig } from '../src/config';
import { loadTranslations } from '../src/services/translations';
import { CONFIG_V3, adminPost, createSession, ingest, makeApp, makeEvent, readJson } from './helpers';

const FUNNEL = 'workstyle-planner';
const RU: TranslationCatalog = {
  funnelId: FUNNEL,
  locale: 'ru',
  messages: {
    "Find your team's operating style": 'Найдите рабочий стиль команды',
    people: { one: 'человек', few: 'человека', many: 'человек', other: 'человека' },
  },
};
const OTHER: TranslationCatalog = { funnelId: 'other-funnel', locale: 'ru', messages: { Hello: 'Привет' } };

const tmpRoot = mkdtempSync(join(tmpdir(), 'funnel-translations-'));
let dirSeq = 0;

/** A fresh directory with the given files (`name → JSON value or raw string`). */
function catalogDir(files: Record<string, unknown>): string {
  dirSeq += 1;
  const dir = join(tmpRoot, `d${dirSeq}`);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('loadTranslations', () => {
  it('indexes valid catalogs by funnelId; ignores non-JSON files', () => {
    const store = loadTranslations(
      catalogDir({ [`${FUNNEL}.ru.json`]: RU, 'other-funnel.ru.json': OTHER, 'README.md': '# notes' }),
    );
    expect(store.get(FUNNEL)).toEqual([RU]);
    expect(store.get('other-funnel')).toEqual([OTHER]);
  });

  it('missing directory or null → no translations', () => {
    expect(loadTranslations(join(tmpRoot, 'does-not-exist')).size).toBe(0);
    expect(loadTranslations(null).size).toBe(0);
  });

  it.each([
    ['invalid JSON', { [`${FUNNEL}.ru.json`]: '{ not json' }, /Unexpected|JSON/],
    ['wrong shape', { [`${FUNNEL}.ru.json`]: { ...RU, messages: { a: 42 } } }, /messages\.a/],
    ['unknown plural category', { [`${FUNNEL}.ru.json`]: { ...RU, messages: { a: { several: 'x' } } } }, /messages/],
    ['funnelId ≠ file name', { 'wrong-funnel.ru.json': RU }, /funnelId "workstyle-planner" does not match/],
    ['locale ≠ file name', { [`${FUNNEL}.en.json`]: RU }, /locale "ru" does not match/],
    ['bad file name', { 'catalog.json': RU }, /file name must be/],
  ])('rejects %s and names the file', (_label, files, reason) => {
    const dir = catalogDir(files);
    const file = Object.keys(files)[0]!;
    expect(() => loadTranslations(dir)).toThrow(join(dir, file));
    expect(() => loadTranslations(dir)).toThrow(reason);
  });

  it('rejects two catalogs for the same funnel + locale', () => {
    const dir = catalogDir({
      [`${FUNNEL}.ru-RU.json`]: { ...RU, locale: 'ru-RU' },
      [`${FUNNEL}.ru_RU.json`]: { ...RU, locale: 'ru_RU' },
    });
    expect(() => loadTranslations(dir)).toThrow(/duplicate catalog/);
  });
});

describe('boot', () => {
  it('a bad catalog file fails startup with the file name', async () => {
    const dir = catalogDir({ [`${FUNNEL}.ru.json`]: { ...RU, locale: 42 } });
    await expect(makeApp({ translationsDir: dir })).rejects.toThrow(`${FUNNEL}.ru.json`);
  });

  it('TRANSLATIONS_DIR defaults to configs/translations and resolves to an absolute path', () => {
    expect(loadConfig({}).translationsDir).toBe(
      fileURLToPath(new URL('../../../configs/translations', import.meta.url)),
    );
    expect(loadConfig({ TRANSLATIONS_DIR: '/srv/tr' }).translationsDir).toBe('/srv/tr');
  });

  it('the shipped catalogs in configs/translations are valid', () => {
    const store = loadTranslations(loadConfig({}).translationsDir);
    for (const [funnelId, list] of store) {
      for (const c of list) expect(c.funnelId).toBe(funnelId);
    }
  });
});

describe('session payload', () => {
  it('carries the catalogs of the session funnel on create and restore', async () => {
    app = await makeApp({ translationsDir: catalogDir({ [`${FUNNEL}.ru.json`]: RU, 'other-funnel.ru.json': OTHER }) });
    const created = await createSession(app);
    expect(created.translations).toEqual([RU]);
    // the funnel itself stays in its source language
    expect(created.funnel.title).toBe("Find your team's operating style");
    expect(created.funnel.locale).toBe('en-AU');

    const res = await app.inject({ method: 'GET', url: `/api/sessions/${created.sessionId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<SessionState>().translations).toEqual([RU]);
  });

  it('is an empty list when the funnel has no catalogs', async () => {
    app = await makeApp({ translationsDir: null });
    expect((await createSession(app)).translations).toEqual([]);
  });

  it('translations do not affect pinning, variant or events', async () => {
    app = await makeApp({ translationsDir: catalogDir({ [`${FUNNEL}.ru.json`]: RU }) });
    const plain = await makeApp({ translationsDir: null });
    try {
      // `lang` is not a session input: same (forced) variant → identical pinned state with or without catalogs.
      const queries: Record<string, string>[] = [
        { variant: 'A' },
        { variant: 'B', lang: 'en' },
        { variant: 'A', lang: 'ru', utm_campaign: 'x' },
      ];
      for (const query of queries) {
        const a = await createSession(app, query);
        const b = await createSession(plain, query);
        expect(a.funnelVersion).toBe(b.funnelVersion);
        expect([a.variant, a.variantSource]).toEqual([b.variant, b.variantSource]);
        expect(a.funnel).toEqual(b.funnel);
        expect(a.utm).toEqual(b.utm);
      }
      const s = await createSession(app, { lang: 'ru' });
      const out = await ingest(app, [makeEvent(s)]);
      expect(out.accepted).toHaveLength(1);
    } finally {
      await plain.close();
    }
  });
});

describe('GET /api/funnels/:funnelId/translations', () => {
  it('200 with the catalogs of a known funnel', async () => {
    app = await makeApp({ translationsDir: catalogDir({ [`${FUNNEL}.ru.json`]: RU, 'other-funnel.ru.json': OTHER }) });
    const res = await app.inject({ method: 'GET', url: `/api/funnels/${FUNNEL}/translations` });
    expect(res.statusCode).toBe(200);
    expect(res.json<FunnelTranslationsResponse>()).toEqual({ funnelId: FUNNEL, catalogs: [RU] });
  });

  it('200 with an empty list for a known funnel without catalogs', async () => {
    app = await makeApp({ translationsDir: null });
    const res = await app.inject({ method: 'GET', url: `/api/funnels/${FUNNEL}/translations` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ funnelId: FUNNEL, catalogs: [] });
  });

  it('404 not_found for an unknown funnel, even if a catalog file exists for it', async () => {
    app = await makeApp({ translationsDir: catalogDir({ 'other-funnel.ru.json': OTHER }) });
    const res = await app.inject({ method: 'GET', url: '/api/funnels/other-funnel/translations' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('is public (no admin token needed) and serves every version of the funnel', async () => {
    const token = 't';
    app = await makeApp({ adminToken: token, translationsDir: catalogDir({ [`${FUNNEL}.ru.json`]: RU }) });
    const v1 = await createSession(app);
    expect((await adminPost(app, '/api/admin/versions', { config: readJson(CONFIG_V3) }, token)).statusCode).toBe(201);
    const v3 = await createSession(app);
    expect([v1.funnelVersion, v3.funnelVersion]).toEqual([1, 3]);
    expect(v3.translations).toEqual(v1.translations);
    const res = await app.inject({ method: 'GET', url: `/api/funnels/${FUNNEL}/translations` });
    expect(res.statusCode).toBe(200);
  });
});
