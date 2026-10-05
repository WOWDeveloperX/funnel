/**
 * resolveFunnel(config, variant): the per-variant view of a config that the backend sends to the
 * client. Only the variant's own sequence/overrides are included — never the other variant's data.
 */
import type { EventPrivacy, FunnelConfig, ProgressConfig, ResultDef, ResultRule, Step } from './config';

export type ResolvedResult = ResultDef;

export interface ResolvedEventDefinition {
  name: string;
  properties: string[];
}

export interface ResolvedFunnel {
  funnelId: string;
  version: number;
  title: string;
  description: string | null;
  locale: string;
  experimentId: string;
  /** URL query param that forces a variant when a session is created (experiment.overrideQueryParam). */
  overrideQueryParam: string;
  variant: string;
  sessionTtlHours: number;
  progress: ProgressConfig;
  /** The variant's step order. */
  stepSequence: string[];
  /** Only steps present in stepSequence, with the variant's stepOverrides deep-merged. */
  steps: Record<string, Step>;
  resultRules: ResultRule[];
  defaultResultId: string;
  /** All results with the variant's resultOverrides deep-merged. */
  results: Record<string, ResolvedResult>;
  events: { allowed: ResolvedEventDefinition[]; privacy: EventPrivacy };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep merge used for overrides: plain objects merge recursively, arrays and primitives replace,
 * `undefined` in the override is ignored. Inputs are never mutated.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return structuredCloneJson(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredCloneJson(override) as T;
  const out: Record<string, unknown> = { ...structuredCloneJson(base) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = key in out ? deepMerge(out[key], value) : structuredCloneJson(value);
  }
  return out as T;
}

/** JSON-safe clone (configs are pure JSON). */
function structuredCloneJson<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export class UnknownVariantError extends Error {
  constructor(
    readonly variant: string,
    readonly available: string[],
  ) {
    super(`Unknown variant "${variant}" (available: ${available.join(', ')})`);
    this.name = 'UnknownVariantError';
  }
}

/** Sorted variant keys (`A`, `B`, ...) — the order used for assignment and display. */
export function variantKeys(config: Pick<FunnelConfig, 'experiment'>): string[] {
  return Object.keys(config.experiment.variants).sort();
}

export function resolveFunnel(config: FunnelConfig, variant: string): ResolvedFunnel {
  const v = config.experiment.variants[variant];
  if (!v) throw new UnknownVariantError(variant, variantKeys(config));

  const stepOverrides = v.stepOverrides ?? {};
  const resultOverrides = v.resultOverrides ?? {};

  const steps: Record<string, Step> = {};
  for (const id of v.stepSequence) {
    const base = config.steps[id];
    if (!base) continue; // validateConfig rejects this; stay defensive at runtime
    steps[id] = deepMerge(base, stepOverrides[id]);
  }

  const results: Record<string, ResolvedResult> = {};
  for (const [id, base] of Object.entries(config.results)) {
    results[id] = deepMerge(base, resultOverrides[id]);
  }

  return {
    funnelId: config.funnelId,
    version: config.version,
    title: config.title,
    description: config.description ?? null,
    locale: config.locale ?? 'en',
    experimentId: config.experiment.id,
    overrideQueryParam: config.experiment.overrideQueryParam ?? 'variant',
    variant,
    sessionTtlHours: config.session?.ttlHours ?? 72,
    progress: {
      countVisibleOnly: config.progress?.countVisibleOnly ?? true,
      excludeTypes: [...(config.progress?.excludeTypes ?? ['info', 'result'])],
    },
    stepSequence: v.stepSequence.filter((id) => id in steps),
    steps,
    resultRules: structuredCloneJson(config.resultRules ?? []),
    defaultResultId: config.defaultResultId,
    results,
    events: {
      allowed: config.events.allowed.map((e) => ({ name: e.name, properties: [...(e.properties ?? [])] })),
      privacy: {
        storeRawAnswers: config.events.privacy?.storeRawAnswers ?? false,
        allowAnswerKinds: config.events.privacy?.allowAnswerKinds ?? true,
      },
    },
  };
}
