/**
 * Funnel config model (mirrors configs/funnel-v*.json), zod schema and validateConfig().
 *
 * The TypeScript interfaces below describe the *parsed* config (zod defaults applied).
 * Unknown extra fields are tolerated everywhere (zod `looseObject` = passthrough), so a
 * newer config with additional fields still parses; they are just not typed.
 */
import { z } from 'zod';
import {
  type Condition,
  CONDITION_OPERATORS,
  conditionAnswerNames,
  conditionLeaves,
  isConditionOperator,
} from './conditions';
import { CORE_EVENTS } from './events';
import type { PluralForms } from './i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const STEP_TYPES = ['info', 'single-select', 'multi-select', 'number', 'result'] as const;
export type KnownStepType = (typeof STEP_TYPES)[number];
/** Known types autocomplete; any other string is allowed so the UI can render a forward-compatible fallback. */
export type StepType = KnownStepType | (string & {});

export const INTERACTIVE_STEP_TYPES = ['single-select', 'multi-select', 'number'] as const;

export interface StepContent {
  eyebrow?: string;
  title?: string;
  body?: string;
  helperText?: string;
  primaryActionLabel?: string;
  /** info steps: optional time estimate shown next to the question count on the intro ("about 2 min"). */
  durationHint?: string;
  /** result steps */
  loadingTitle?: string;
  errorTitle?: string;
  retryLabel?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface StepInput {
  /** Answer storage key (equals step id in the shipped configs). */
  name: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /**
   * Number steps: plural forms of `unit` for the display language. Never present in a config —
   * set by localizeFunnel() when the catalog has a plural entry for the unit; read via unitFor().
   */
  unitForms?: PluralForms;
  placeholder?: string;
}

export type ValidationMessageKey = 'required' | 'min' | 'max' | 'invalid' | 'minSelections' | 'maxSelections';

export interface StepValidation {
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
  messages?: Partial<Record<ValidationMessageKey, string>> & Record<string, string>;
}

export interface Step {
  id: string;
  type: StepType;
  content: StepContent;
  input?: StepInput;
  validation?: StepValidation;
  visibleWhen?: Condition;
  /** result steps: where the result comes from (`resultRules`). */
  resultSource?: string;
}

export interface ResultCta {
  label: string;
  action: string;
}

export interface ResultDef {
  id: string;
  title: string;
  summary: string;
  recommendations: string[];
  cta: ResultCta;
  badge?: string;
  /**
   * Optional 30-day plan revealed by an `expand_recommendation` CTA (one line per week). When absent
   * the client shows a generic rollout cadence — never a copy of `recommendations`.
   */
  plan?: string[];
}

/** Objects merge, arrays replace. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type StepOverride = DeepPartial<Step>;
export type ResultOverride = DeepPartial<ResultDef>;

export interface VariantConfig {
  weight: number;
  stepSequence: string[];
  stepOverrides: Record<string, StepOverride>;
  resultOverrides: Record<string, ResultOverride>;
}

export interface ExperimentConfig {
  id: string;
  assignment?: string;
  sticky?: boolean;
  /** Query parameter that forces a variant, e.g. `?variant=B`. Default `variant`. */
  overrideQueryParam: string;
  /** Keyed by variant key (`A`, `B`, ...). Assignment walks keys in sorted order. */
  variants: Record<string, VariantConfig>;
}

export interface SessionConfig {
  ttlHours: number;
  persistAnswers?: boolean;
  pinVersion?: boolean;
  pinExperimentVariant?: boolean;
}

export interface ProgressConfig {
  countVisibleOnly: boolean;
  excludeTypes: string[];
}

export interface ResultRule {
  resultId: string;
  when: Condition;
}

export interface EventDefinition {
  name: string;
  trigger?: string;
  /** Whitelist of event-specific property keys. Everything else is dropped on ingest. */
  properties: string[];
}

export interface EventPrivacy {
  storeRawAnswers: boolean;
  allowAnswerKinds: boolean;
}

export interface EventsConfig {
  baseProperties?: string[];
  allowed: EventDefinition[];
  privacy: EventPrivacy;
}

export interface FunnelConfig {
  schemaVersion: string;
  funnelId: string;
  version: number;
  status?: string;
  locale: string;
  title: string;
  description?: string;
  releaseNote?: string;
  session: SessionConfig;
  progress: ProgressConfig;
  experiment: ExperimentConfig;
  steps: Record<string, Step>;
  resultRules: ResultRule[];
  defaultResultId: string;
  results: Record<string, ResultDef>;
  events: EventsConfig;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.looseObject({ all: z.array(ConditionSchema) }),
    z.looseObject({ any: z.array(ConditionSchema) }),
    z.looseObject({ not: ConditionSchema }),
    z.looseObject({ answer: z.string().min(1), operator: z.string().min(1), value: z.unknown().optional() }),
  ]),
) as z.ZodType<Condition>;

const SelectOptionSchema = z.looseObject({
  value: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
});

const StepInputSchema = z.looseObject({
  name: z.string().min(1),
  options: z.array(SelectOptionSchema).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
  unit: z.string().optional(),
  placeholder: z.string().optional(),
});

const StepValidationSchema = z.looseObject({
  required: z.boolean().optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
  messages: z.record(z.string(), z.string()).optional(),
});

const StepContentSchema = z.looseObject({
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  helperText: z.string().optional(),
  primaryActionLabel: z.string().optional(),
  durationHint: z.string().optional(),
  loadingTitle: z.string().optional(),
  errorTitle: z.string().optional(),
  retryLabel: z.string().optional(),
});

export const StepSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  content: StepContentSchema.default({}),
  input: StepInputSchema.optional(),
  validation: StepValidationSchema.optional(),
  visibleWhen: ConditionSchema.optional(),
  resultSource: z.string().optional(),
});

const ResultDefSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  recommendations: z.array(z.string()),
  cta: z.looseObject({ label: z.string(), action: z.string() }),
  badge: z.string().optional(),
  plan: z.array(z.string()).optional(),
});

const PlainObject = z.record(z.string(), z.unknown());

const VariantSchema = z.looseObject({
  weight: z.number().finite().nonnegative(),
  stepSequence: z.array(z.string().min(1)).min(1),
  stepOverrides: z.record(z.string(), PlainObject).default({}),
  resultOverrides: z.record(z.string(), PlainObject).default({}),
});

const EventDefinitionSchema = z.looseObject({
  name: z.string().min(1).max(64),
  trigger: z.string().optional(),
  properties: z.array(z.string()).default([]),
});

export const FunnelConfigSchema = z.looseObject({
  schemaVersion: z.string().default('1.0'),
  funnelId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  status: z.string().optional(),
  locale: z.string().default('en'),
  title: z.string(),
  description: z.string().optional(),
  releaseNote: z.string().optional(),
  session: z
    .looseObject({
      ttlHours: z.number().positive().finite(),
      persistAnswers: z.boolean().optional(),
      pinVersion: z.boolean().optional(),
      pinExperimentVariant: z.boolean().optional(),
    })
    .default({ ttlHours: 72 }),
  progress: z
    .looseObject({
      countVisibleOnly: z.boolean().default(true),
      excludeTypes: z.array(z.string()).default(['info', 'result']),
    })
    .default({ countVisibleOnly: true, excludeTypes: ['info', 'result'] }),
  experiment: z.looseObject({
    id: z.string().min(1),
    assignment: z.string().optional(),
    sticky: z.boolean().optional(),
    overrideQueryParam: z.string().min(1).default('variant'),
    variants: z.record(z.string().min(1), VariantSchema),
  }),
  steps: z.record(z.string(), StepSchema),
  resultRules: z.array(z.looseObject({ resultId: z.string().min(1), when: ConditionSchema })).default([]),
  defaultResultId: z.string({ error: 'defaultResultId is required' }).min(1, 'defaultResultId is required'),
  results: z.record(z.string(), ResultDefSchema),
  events: z.looseObject({
    baseProperties: z.array(z.string()).optional(),
    allowed: z.array(EventDefinitionSchema),
    privacy: z
      .looseObject({ storeRawAnswers: z.boolean().default(false), allowAnswerKinds: z.boolean().default(true) })
      .default({ storeRawAnswers: false, allowAnswerKinds: true }),
  }),
});

// Compile-time guard: the parsed schema output must satisfy the hand-written FunnelConfig type.
const _schemaMatchesType = (x: z.output<typeof FunnelConfigSchema>): FunnelConfig => x;
void _schemaMatchesType;

/** Parses (and applies defaults to) a config. Throws a ZodError on shape errors; does NOT run semantic checks. */
export function parseConfig(raw: unknown): FunnelConfig {
  return FunnelConfigSchema.parse(raw) as FunnelConfig;
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Present only when ok === true (parsed, defaults applied). */
  config?: FunnelConfig;
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join('');
}

const VALUE_ARRAY_OPS = new Set(['in', 'nin']);
const VALUE_NUMBER_OPS = new Set(['gte', 'gt', 'lte', 'lt']);

/**
 * Full validation: zod shape + semantic checks. Errors block publishing; warnings are informational.
 * Messages are human readable and reference the offending path.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const parsed = FunnelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
    // Required top-level keys get an explicit message too (zod says "expected string, received undefined").
    if (raw && typeof raw === 'object' && !('defaultResultId' in raw)) {
      if (!errors.some((e) => e.includes('defaultResultId'))) errors.push('defaultResultId is required');
    }
    return { ok: false, errors, warnings: [] };
  }

  const config = parsed.data as FunnelConfig;
  const errors: string[] = [];
  const warnings: string[] = [];
  const stepIds = Object.keys(config.steps);
  const resultIds = new Set(Object.keys(config.results));

  // --- steps -------------------------------------------------------------
  /** answer name -> step id that produces it */
  const answerOwner = new Map<string, string>();
  for (const [key, step] of Object.entries(config.steps)) {
    if (step.id !== key) errors.push(`steps.${key}: id "${step.id}" does not match its key "${key}"`);
    const known = (STEP_TYPES as readonly string[]).includes(step.type);
    if (!known) errors.push(`steps.${key}: unknown step type "${step.type}"`);
    const interactive = (INTERACTIVE_STEP_TYPES as readonly string[]).includes(step.type);

    if (interactive && !step.input?.name) errors.push(`steps.${key}: interactive step requires input.name`);
    if (step.input?.name) {
      const owner = answerOwner.get(step.input.name);
      if (owner) errors.push(`steps.${key}: input.name "${step.input.name}" is already used by step "${owner}"`);
      else answerOwner.set(step.input.name, key);
    }

    if (step.type === 'single-select' || step.type === 'multi-select') {
      const options = step.input?.options;
      if (!options || options.length === 0) {
        errors.push(`steps.${key}: ${step.type} step requires input.options`);
      } else {
        const values = options.map((o) => o.value);
        const dup = values.find((v, i) => values.indexOf(v) !== i);
        if (dup !== undefined) errors.push(`steps.${key}: duplicate option value "${dup}"`);
      }
    }
    if (step.type === 'number') {
      const { min, max } = step.input ?? {};
      if (min !== undefined && max !== undefined && min > max) {
        errors.push(`steps.${key}: input.min (${min}) is greater than input.max (${max})`);
      }
    }
    if (step.type === 'multi-select') {
      const { minSelections, maxSelections } = step.validation ?? {};
      if (minSelections !== undefined && maxSelections !== undefined && minSelections > maxSelections) {
        errors.push(
          `steps.${key}: validation.minSelections (${minSelections}) is greater than maxSelections (${maxSelections})`,
        );
      }
      const optionCount = step.input?.options?.length ?? 0;
      if (maxSelections !== undefined && optionCount > 0 && maxSelections > optionCount) {
        warnings.push(`steps.${key}: maxSelections (${maxSelections}) exceeds the number of options (${optionCount})`);
      }
    }
  }

  // --- conditions (visibleWhen + resultRules) ------------------------------
  const checkCondition = (cond: Condition | undefined, where: string): void => {
    if (!cond) return;
    for (const name of conditionAnswerNames(cond)) {
      if (!answerOwner.has(name)) errors.push(`${where}: references unknown answer "${name}"`);
    }
    for (const leaf of conditionLeaves(cond)) {
      if (!isConditionOperator(leaf.operator)) {
        errors.push(
          `${where}: unknown operator "${String(leaf.operator)}" (allowed: ${CONDITION_OPERATORS.join(', ')})`,
        );
      } else if (VALUE_ARRAY_OPS.has(leaf.operator) && !Array.isArray(leaf.value)) {
        errors.push(`${where}: operator "${leaf.operator}" on "${leaf.answer}" requires an array value`);
      } else if (VALUE_NUMBER_OPS.has(leaf.operator) && typeof leaf.value !== 'number') {
        errors.push(`${where}: operator "${leaf.operator}" on "${leaf.answer}" requires a numeric value`);
      }
    }
  };
  for (const [key, step] of Object.entries(config.steps)) checkCondition(step.visibleWhen, `steps.${key}.visibleWhen`);
  config.resultRules.forEach((rule, i) => {
    if (!resultIds.has(rule.resultId)) errors.push(`resultRules[${i}]: unknown resultId "${rule.resultId}"`);
    checkCondition(rule.when, `resultRules[${i}].when`);
  });

  // --- results -------------------------------------------------------------
  for (const [key, result] of Object.entries(config.results)) {
    if (result.id !== key) errors.push(`results.${key}: id "${result.id}" does not match its key "${key}"`);
  }
  if (!resultIds.has(config.defaultResultId)) {
    errors.push(`defaultResultId: unknown result "${config.defaultResultId}"`);
  }

  // --- experiment / variants -----------------------------------------------
  const variantEntries = Object.entries(config.experiment.variants);
  if (variantEntries.length === 0) errors.push('experiment.variants: at least one variant is required');
  const totalWeight = variantEntries.reduce((sum, [, v]) => sum + v.weight, 0);
  if (variantEntries.length > 0 && totalWeight <= 0) errors.push('experiment.variants: weights are all zero');

  const usedSteps = new Set<string>();
  for (const [vk, variant] of variantEntries) {
    const where = `experiment.variants.${vk}`;
    const seq = variant.stepSequence;
    const seen = new Set<string>();
    seq.forEach((id, i) => {
      usedSteps.add(id);
      if (seen.has(id)) errors.push(`${where}.stepSequence: duplicate step "${id}"`);
      seen.add(id);
      const step = config.steps[id];
      if (!step) {
        errors.push(`${where}.stepSequence: unknown step "${id}"`);
        return;
      }
      if (step.type === 'result' && i !== seq.length - 1) {
        errors.push(`${where}.stepSequence: result step "${id}" must be the last step`);
      }
    });
    const lastId = seq[seq.length - 1];
    const last = lastId !== undefined ? config.steps[lastId] : undefined;
    if (!last || last.type !== 'result') {
      errors.push(`${where}.stepSequence: must end with a result step`);
    }

    for (const [sid, override] of Object.entries(variant.stepOverrides)) {
      if (!config.steps[sid]) errors.push(`${where}.stepOverrides: unknown step "${sid}"`);
      else if (!seq.includes(sid))
        warnings.push(`${where}.stepOverrides: step "${sid}" is not in this variant's sequence`);
      const o = override as Record<string, unknown>;
      if ('id' in o && o.id !== sid) errors.push(`${where}.stepOverrides.${sid}: overriding "id" is not allowed`);
      if ('type' in o && typeof o.type === 'string' && !(STEP_TYPES as readonly string[]).includes(o.type)) {
        errors.push(`${where}.stepOverrides.${sid}: unknown step type "${o.type}"`);
      }
      if ('visibleWhen' in o) checkCondition(o.visibleWhen as Condition, `${where}.stepOverrides.${sid}.visibleWhen`);
    }
    for (const rid of Object.keys(variant.resultOverrides)) {
      if (!resultIds.has(rid)) errors.push(`${where}.resultOverrides: unknown result "${rid}"`);
    }

    // Warnings: a branch condition / result rule depends on an answer this variant asks later or never.
    const position = new Map(seq.map((id, i) => [id, i] as const));
    seq.forEach((id, i) => {
      const step = config.steps[id];
      const visibleWhen = (variant.stepOverrides[id]?.visibleWhen as Condition | undefined) ?? step?.visibleWhen;
      for (const name of conditionAnswerNames(visibleWhen)) {
        const owner = answerOwner.get(name);
        if (!owner) continue; // already an error
        const ownerPos = position.get(owner);
        if (ownerPos === undefined) {
          warnings.push(`${where}: step "${id}" visibleWhen references "${name}", which this variant never asks`);
        } else if (ownerPos >= i) {
          warnings.push(
            `${where}: step "${id}" visibleWhen references "${name}", which is asked later in this variant`,
          );
        }
      }
    });
    const ruleAnswers = new Set(config.resultRules.flatMap((r) => conditionAnswerNames(r.when)));
    for (const name of ruleAnswers) {
      const owner = answerOwner.get(name);
      if (owner && !position.has(owner)) {
        warnings.push(`${where}: resultRules reference "${name}", which this variant never asks`);
      }
    }
  }
  for (const id of stepIds) {
    if (!usedSteps.has(id)) warnings.push(`steps.${id}: defined but not used by any variant`);
  }

  // --- events ----------------------------------------------------------------
  const eventNames = config.events.allowed.map((e) => e.name);
  for (const core of CORE_EVENTS) {
    if (!eventNames.includes(core)) errors.push(`events.allowed: missing core event "${core}"`);
  }
  const dupEvent = eventNames.find((n, i) => eventNames.indexOf(n) !== i);
  if (dupEvent) errors.push(`events.allowed: duplicate event "${dupEvent}"`);

  const ok = errors.length === 0;
  return ok ? { ok, errors, warnings, config } : { ok, errors, warnings };
}
