/**
 * Content translations: gettext-style catalogs keyed by the SOURCE TEXT of a config.
 *
 * Funnel configs are authored in one language (`config.locale`, e.g. en-AU) and are immutable once
 * published, so translations live next to them as data — `configs/translations/<funnelId>.<lang>.json`
 * — keyed by the exact source string (msgid). One catalog therefore serves every version of a funnel
 * (unchanged strings are shared), and a string without an entry falls back to the source text: a new
 * version with untranslated copy degrades to the source language, it never breaks.
 *
 * Units of number steps may carry plural forms (Intl.PluralRules categories); unitFor() picks the
 * form for a value. Everything here is pure and runs in the browser, on the server and in scripts.
 */
import { z } from 'zod';
import type { FunnelConfig, ResultDef, SelectOption, Step, StepContent, StepInput, StepValidation } from './config';
import type { ResolvedFunnel, ResolvedResult } from './resolve';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type PluralForms = Partial<Record<PluralCategory, string>>;
export type CatalogEntry = string | PluralForms;

export interface TranslationCatalog {
  funnelId: string;
  /** BCP 47 locale of the translations, e.g. `ru`. */
  locale: string;
  /** Source text (msgid) → translation. */
  messages: Record<string, CatalogEntry>;
}

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export const SUPPORTED_LANGUAGES = ['ru', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ru';

export function isLanguage(x: unknown): x is Language {
  return typeof x === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(x);
}

/** Primary language subtag, lower-cased: `en-AU` → `en`, `ru_RU` → `ru`; empty/missing → `en`. */
export function languageOf(locale: string | null | undefined): string {
  const lang = (locale ?? '').trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  return lang || 'en';
}

// ---------------------------------------------------------------------------
// Schema (catalog files)
// ---------------------------------------------------------------------------

const PluralFormsSchema = z
  .strictObject({
    zero: z.string().min(1).optional(),
    one: z.string().min(1).optional(),
    two: z.string().min(1).optional(),
    few: z.string().min(1).optional(),
    many: z.string().min(1).optional(),
    other: z.string().min(1).optional(),
  })
  .refine((forms) => Object.keys(forms).length > 0, { message: 'Plural entry needs at least one form' });

/** Shape of a `configs/translations/<funnelId>.<lang>.json` file. Unknown top-level keys are rejected. */
export const TranslationCatalogSchema = z.strictObject({
  funnelId: z.string().min(1).max(100),
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/, 'locale must be a BCP 47 tag such as "ru" or "ru-RU"'),
  messages: z.record(z.string().min(1), z.union([z.string(), PluralFormsSchema])),
});

// Compile-time guard: the parsed schema output must satisfy the hand-written type.
const _catalogSchemaMatchesType = (x: z.output<typeof TranslationCatalogSchema>): TranslationCatalog => x;
void _catalogSchemaMatchesType;

/** Parses a catalog; throws a ZodError on shape errors. */
export function parseCatalog(raw: unknown): TranslationCatalog {
  return TranslationCatalogSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * The catalog that displays a funnel in `language`, or null when none exists. A catalog in the source language itself is allowed and acts as an override layer (e.g.
 * English plural forms for units the config only gives as "people"); without one the source text
 * is shown as is. An exact locale match wins over a language match (`ru-RU` before `ru`).
 */
export function catalogFor(catalogs: readonly TranslationCatalog[], language: string): TranslationCatalog | null {
  const lang = languageOf(language);
  const wanted = language.trim().toLowerCase().replace(/_/g, '-');
  return (
    catalogs.find((c) => c.locale.toLowerCase().replace(/_/g, '-') === wanted) ??
    catalogs.find((c) => languageOf(c.locale) === lang) ??
    null
  );
}

function isPluralForms(entry: CatalogEntry | undefined): entry is PluralForms {
  return typeof entry === 'object' && entry !== null;
}

function entryOf(text: string, catalog: TranslationCatalog | null): CatalogEntry | undefined {
  if (!catalog || !text) return undefined;
  return Object.prototype.hasOwnProperty.call(catalog.messages, text) ? catalog.messages[text] : undefined;
}

/**
 * Translation of `text`: a string entry as is; a plural entry → its `other` (else `many`) form;
 * missing or empty entry → `text` itself (source-language fallback).
 */
export function translate(text: string, catalog: TranslationCatalog | null): string {
  const entry = entryOf(text, catalog);
  if (entry === undefined) return text;
  if (isPluralForms(entry)) return entry.other || entry.many || text;
  return entry || text;
}

/** Plural forms for `text` when the catalog has a plural entry for it, else null. */
export function pluralFormsOf(text: string, catalog: TranslationCatalog | null): PluralForms | null {
  const entry = entryOf(text, catalog);
  return isPluralForms(entry) ? { ...entry } : null;
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRules(language: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(language);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(language);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRulesCache.set(language, rules);
  }
  return rules;
}

/**
 * Unit label for a number value in `language`: the matching plural form when the input carries
 * `unitForms` (set by localizeFunnel), else `unit`, else ''. `unitFor({unitForms: ru people}, 2, 'ru')`
 * → «человека».
 */
export function unitFor(input: { unit?: string; unitForms?: PluralForms }, value: number, language: string): string {
  const forms = input.unitForms;
  if (forms && Object.keys(forms).length > 0) {
    const category = Number.isFinite(value) ? (pluralRules(language).select(value) as PluralCategory) : 'other';
    return forms[category] || forms.other || forms.many || input.unit || '';
  }
  return input.unit ?? '';
}

// ---------------------------------------------------------------------------
// Message collection (what a catalog must cover)
// ---------------------------------------------------------------------------

/** End-user-facing step content fields, in display order. */
const CONTENT_FIELDS = [
  'eyebrow',
  'title',
  'body',
  'helperText',
  'durationHint',
  'primaryActionLabel',
  'loadingTitle',
  'errorTitle',
  'retryLabel',
] as const satisfies readonly (keyof StepContent)[];

type Sink = (text: unknown) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Step or (partial) step override. Defensive: overrides are DeepPartial and loosely typed. */
function collectStep(step: unknown, add: Sink): void {
  if (!isRecord(step)) return;
  const content = step.content;
  if (isRecord(content)) for (const field of CONTENT_FIELDS) add(content[field]);
  const input = step.input;
  if (isRecord(input)) {
    add(input.placeholder);
    add(input.unit);
    if (Array.isArray(input.options)) {
      for (const option of input.options) {
        if (!isRecord(option)) continue;
        add(option.label);
        add(option.description);
      }
    }
  }
  const validation = step.validation;
  if (isRecord(validation) && isRecord(validation.messages)) {
    for (const message of Object.values(validation.messages)) add(message);
  }
}

/** Result or (partial) result override. */
function collectResult(result: unknown, add: Sink): void {
  if (!isRecord(result)) return;
  add(result.badge);
  add(result.title);
  add(result.summary);
  if (Array.isArray(result.recommendations)) for (const r of result.recommendations) add(r);
  if (Array.isArray(result.plan)) for (const p of result.plan) add(p);
  if (isRecord(result.cta)) add(result.cta.label);
}

/** `async_native` → `async native`: the result tag shown when a result has no `badge`. */
export function humanizeResultId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

/** The tag a result screen shows: the result's `badge`, else its humanized id. */
export function resultTag(resultId: string, result: Pick<ResultDef, 'badge'>): string {
  return result.badge ?? humanizeResultId(resultId);
}

function collector(): { add: Sink; list: string[] } {
  const seen = new Set<string>();
  const list: string[] = [];
  const add: Sink = (text) => {
    if (typeof text !== 'string' || text.trim() === '' || seen.has(text)) return;
    seen.add(text);
    list.push(text);
  };
  return { add, list };
}

/**
 * Every end-user-facing string of a config — funnel title, step content, input units, placeholders,
 * option labels/descriptions, validation messages, results (badge — or, without one, the humanized
 * result id the result screen shows as its tag — title, summary, recommendations, plan, CTA label) —
 * including every variant's stepOverrides/resultOverrides. Deduplicated, in a stable order: title,
 * base steps, base results, then each variant's overrides (variants sorted). Admin-only data
 * (description, releaseNote) is NOT included; see collectAdminMessages().
 */
export function collectMessages(config: FunnelConfig): string[] {
  const { add, list } = collector();
  add(config.title);
  for (const step of Object.values(config.steps ?? {})) collectStep(step, add);
  for (const [id, result] of Object.entries(config.results ?? {})) {
    collectResult(result, add);
    if (isRecord(result) && result.badge === undefined) add(humanizeResultId(id));
  }
  const variants = config.experiment?.variants ?? {};
  for (const key of Object.keys(variants).sort()) {
    const variant = variants[key];
    if (!variant) continue;
    for (const override of Object.values(variant.stepOverrides ?? {})) collectStep(override, add);
    for (const override of Object.values(variant.resultOverrides ?? {})) collectResult(override, add);
  }
  return list;
}

/** Admin-only strings worth translating for the admin UI: the funnel description and release note. */
export function collectAdminMessages(config: Partial<Pick<FunnelConfig, 'description' | 'releaseNote'>>): string[] {
  const { add, list } = collector();
  add(config.description);
  add(config.releaseNote);
  return list;
}

// ---------------------------------------------------------------------------
// Localization of resolved funnels/results
// ---------------------------------------------------------------------------

function tOpt(text: string | undefined, catalog: TranslationCatalog): string | undefined {
  return text === undefined ? undefined : translate(text, catalog);
}

/** Assigns only defined values so optional fields stay absent (not `undefined`) in the output. */
function setDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function localizeContent(content: StepContent, catalog: TranslationCatalog): StepContent {
  const out: StepContent = { ...content };
  for (const field of CONTENT_FIELDS) setDefined(out, field, tOpt(content[field], catalog));
  return out;
}

function localizeInput(input: StepInput, catalog: TranslationCatalog): StepInput {
  const out: StepInput = { ...input };
  setDefined(out, 'placeholder', tOpt(input.placeholder, catalog));
  if (input.unit !== undefined) {
    out.unit = translate(input.unit, catalog);
    const forms = pluralFormsOf(input.unit, catalog);
    if (forms) out.unitForms = forms;
    else delete out.unitForms;
  }
  if (input.options) {
    out.options = input.options.map((option): SelectOption => {
      const o: SelectOption = { ...option, label: translate(option.label, catalog) };
      setDefined(o, 'description', tOpt(option.description, catalog));
      return o;
    });
  }
  return out;
}

function localizeValidation(validation: StepValidation, catalog: TranslationCatalog): StepValidation {
  if (!validation.messages) return { ...validation };
  const messages: Record<string, string> = {};
  for (const [key, message] of Object.entries(validation.messages)) messages[key] = translate(message, catalog);
  return { ...validation, messages };
}

function localizeStep(step: Step, catalog: TranslationCatalog): Step {
  const out: Step = { ...step, content: localizeContent(step.content ?? {}, catalog) };
  if (step.input) out.input = localizeInput(step.input, catalog);
  if (step.validation) out.validation = localizeValidation(step.validation, catalog);
  return out;
}

/**
 * The result with every user-facing string translated. Null catalog → the same object. Pure.
 * With `resultId`, a result without `badge` whose tag (the humanized id) has a catalog entry gets
 * that translation as its `badge`, so the result screen's tag is localized too.
 */
export function localizeResult(
  result: ResolvedResult,
  catalog: TranslationCatalog | null,
  resultId?: string,
): ResolvedResult {
  if (!catalog) return result;
  const out: ResultDef = {
    ...result,
    title: translate(result.title, catalog),
    summary: translate(result.summary, catalog),
    recommendations: result.recommendations.map((r) => translate(r, catalog)),
    cta: { ...result.cta, label: translate(result.cta.label, catalog) },
  };
  if (result.badge !== undefined) out.badge = translate(result.badge, catalog);
  else if (resultId !== undefined) {
    const tag = humanizeResultId(resultId);
    const translated = translate(tag, catalog);
    if (translated !== tag) out.badge = translated;
  }
  if (result.plan) out.plan = result.plan.map((p) => translate(p, catalog));
  return out;
}

/**
 * The funnel with every string collectMessages() covers translated (title, steps, results — a
 * result's tag becomes a translated `badge`, see localizeResult); ids,
 * values, conditions, events and `locale` are untouched, so navigation, validation and analytics
 * behave identically in every language. Units with a plural entry also get `input.unitForms`.
 * Null catalog → the same object (no translation needed). Pure: the input is never mutated.
 */
export function localizeFunnel(funnel: ResolvedFunnel, catalog: TranslationCatalog | null): ResolvedFunnel {
  if (!catalog) return funnel;
  const steps: Record<string, Step> = {};
  for (const [id, step] of Object.entries(funnel.steps)) steps[id] = localizeStep(step, catalog);
  const results: Record<string, ResolvedResult> = {};
  for (const [id, result] of Object.entries(funnel.results)) results[id] = localizeResult(result, catalog, id);
  return { ...funnel, title: translate(funnel.title, catalog), steps, results };
}
