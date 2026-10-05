/**
 * Compact config summaries shown in the admin (validate preview, versions list).
 */
import type { ConfigSummary, VariantSummary } from './api';
import type { FunnelConfig } from './config';

export function summarizeVariants(config: FunnelConfig): VariantSummary[] {
  return Object.keys(config.experiment.variants)
    .sort()
    .map((key) => {
      const sequence = [...config.experiment.variants[key]!.stepSequence];
      return { key, stepCount: sequence.length, sequence };
    });
}

export function summarizeConfig(config: FunnelConfig): ConfigSummary {
  return {
    funnelId: config.funnelId,
    version: config.version,
    title: config.title,
    variants: summarizeVariants(config),
    eventNames: config.events.allowed.map((e) => e.name),
    resultIds: Object.keys(config.results),
  };
}
