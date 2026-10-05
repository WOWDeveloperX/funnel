/**
 * Structural diff between two funnel configs (used by the admin "publish" preview).
 */
import type { FunnelConfig } from './config';
import { canonicalJson } from './canonical';

export interface VariantDiff {
  /** Steps in the new sequence that were not in the old one (new sequence order). */
  added: string[];
  /** Steps of the old sequence that are gone (old sequence order). */
  removed: string[];
  /** True if steps present in both sequences changed their relative order. */
  reordered: boolean;
  /** The new sequence (empty if the variant was removed). */
  sequence: string[];
}

export interface ConfigDiff {
  fromVersion: number;
  toVersion: number;
  variants: Record<string, VariantDiff>;
  stepsAdded: string[];
  stepsRemoved: string[];
  /** Steps present in both whose type/content/input/validation/visibleWhen changed. */
  stepsChanged: string[];
  eventsAdded: string[];
  eventsRemoved: string[];
  resultsAdded: string[];
  resultsRemoved: string[];
  /** Experiment id, variant keys or weights changed. */
  experimentChanged: boolean;
}

const minus = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));

export function diffConfigs(from: FunnelConfig, to: FunnelConfig): ConfigDiff {
  const variantKeys = [
    ...new Set([...Object.keys(from.experiment.variants), ...Object.keys(to.experiment.variants)]),
  ].sort();

  const variants: Record<string, VariantDiff> = {};
  for (const key of variantKeys) {
    const a = from.experiment.variants[key]?.stepSequence ?? [];
    const b = to.experiment.variants[key]?.stepSequence ?? [];
    const commonA = a.filter((id) => b.includes(id));
    const commonB = b.filter((id) => a.includes(id));
    variants[key] = {
      added: minus(b, a),
      removed: minus(a, b),
      reordered: commonA.some((id, i) => commonB[i] !== id),
      sequence: [...b],
    };
  }

  const fromSteps = Object.keys(from.steps);
  const toSteps = Object.keys(to.steps);
  const stepFingerprint = (s: FunnelConfig['steps'][string]): string =>
    canonicalJson({
      type: s.type,
      content: s.content,
      input: s.input,
      validation: s.validation,
      visibleWhen: s.visibleWhen,
    });
  const stepsChanged = fromSteps.filter(
    (id) => to.steps[id] !== undefined && stepFingerprint(from.steps[id]!) !== stepFingerprint(to.steps[id]!),
  );

  const fromEvents = from.events.allowed.map((e) => e.name);
  const toEvents = to.events.allowed.map((e) => e.name);
  const fromResults = Object.keys(from.results);
  const toResults = Object.keys(to.results);

  const experimentFingerprint = (c: FunnelConfig): string =>
    canonicalJson({
      id: c.experiment.id,
      weights: Object.fromEntries(Object.entries(c.experiment.variants).map(([k, v]) => [k, v.weight])),
    });

  return {
    fromVersion: from.version,
    toVersion: to.version,
    variants,
    stepsAdded: minus(toSteps, fromSteps),
    stepsRemoved: minus(fromSteps, toSteps),
    stepsChanged,
    eventsAdded: minus(toEvents, fromEvents),
    eventsRemoved: minus(fromEvents, toEvents),
    resultsAdded: minus(toResults, fromResults),
    resultsRemoved: minus(fromResults, toResults),
    experimentChanged: experimentFingerprint(from) !== experimentFingerprint(to),
  };
}
