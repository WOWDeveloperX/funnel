/**
 * Content translation catalogs (configs/translations/<funnelId>.<lang>.json), loaded once at boot.
 *
 * Catalogs are data, not code: keyed by the source text of a config, so one catalog serves every
 * version of a funnel and the published configs stay untouched. A bad file is a startup error that
 * names the file — a typo must not silently ship an untranslated funnel. Display-only: catalogs
 * never affect version pinning, variant assignment, events or analytics.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type FunnelTranslationsResponse, type TranslationCatalog, TranslationCatalogSchema } from '@funnel/shared';
import type { DB } from '../db';
import { notFound } from '../lib/errors';
import { listVersionNumbers } from './versions';

/** funnelId → its catalogs, sorted by locale. Immutable after boot. */
export type TranslationStore = ReadonlyMap<string, readonly TranslationCatalog[]>;

export const EMPTY_TRANSLATIONS: TranslationStore = new Map();

const FILE_NAME = /^([^.]+)\.([^.]+)\.json$/;

/** Comparison key of a locale: `ru_RU`, `RU-ru` → `ru-ru`. */
const localeKey = (locale: string): string => locale.toLowerCase().replace(/_/g, '-');

function fail(file: string, reason: string, cause?: unknown): never {
  throw new Error(`Invalid translation catalog ${file}: ${reason}`, cause === undefined ? undefined : { cause });
}

function readCatalog(path: string): TranslationCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(path, err instanceof Error ? err.message : String(err), err);
  }
  const parsed = TranslationCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ');
    fail(path, issues);
  }
  const catalog = parsed.data;
  // The file name is the index a human looks for; it must agree with the content.
  const [, fileFunnelId, fileLocale] = FILE_NAME.exec(basename(path)) ?? [];
  if (fileFunnelId === undefined || fileLocale === undefined) fail(path, 'file name must be <funnelId>.<lang>.json');
  if (fileFunnelId !== catalog.funnelId) {
    fail(path, `funnelId "${catalog.funnelId}" does not match the file name`);
  }
  if (localeKey(fileLocale) !== localeKey(catalog.locale)) {
    fail(path, `locale "${catalog.locale}" does not match the file name`);
  }
  return catalog;
}

/**
 * Loads and validates every `*.json` in `dir`. A missing directory (or null) means "no
 * translations": the funnel is then shown in its source language only. Throws on any bad file or on
 * two catalogs for the same funnel + locale.
 */
export function loadTranslations(dir: string | null | undefined): TranslationStore {
  if (!dir || !existsSync(dir)) return EMPTY_TRANSLATIONS;
  if (!statSync(dir).isDirectory()) throw new Error(`TRANSLATIONS_DIR ${dir} is not a directory`);

  const store = new Map<string, TranslationCatalog[]>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const path = join(dir, file);
    const catalog = readCatalog(path);
    const list = store.get(catalog.funnelId) ?? [];
    if (list.some((c) => localeKey(c.locale) === localeKey(catalog.locale))) {
      fail(path, `duplicate catalog for ${catalog.funnelId} / ${catalog.locale}`);
    }
    list.push(catalog);
    store.set(catalog.funnelId, list);
  }
  for (const list of store.values()) list.sort((a, b) => a.locale.localeCompare(b.locale));
  return store;
}

/** Catalogs of one funnel (a fresh array; empty when the funnel has none). */
export function catalogsOf(store: TranslationStore, funnelId: string): TranslationCatalog[] {
  return [...(store.get(funnelId) ?? [])];
}

/** Summary for the boot log: `{ "workstyle-planner": ["ru"] }`. */
export function describeTranslations(store: TranslationStore): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [funnelId, list] of store) out[funnelId] = list.map((c) => c.locale);
  return out;
}

/** GET /api/funnels/:funnelId/translations — 404 `not_found` unless the funnel has a published version. */
export function getFunnelTranslations(db: DB, store: TranslationStore, funnelId: string): FunnelTranslationsResponse {
  if (listVersionNumbers(db, funnelId).length === 0) throw notFound(`Funnel "${funnelId}" not found`);
  return { funnelId, catalogs: catalogsOf(store, funnelId) };
}
