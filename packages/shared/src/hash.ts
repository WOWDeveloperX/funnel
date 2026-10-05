/**
 * Deterministic hashing for sticky variant assignment.
 */

const utf8 = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `input`; returns an unsigned integer. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface AssignableExperiment {
  id: string;
  variants: Record<string, { weight: number }>;
}

/**
 * `h = fnv1a32(experimentId + ":" + sessionId) % totalWeight`, then walk variants in sorted key
 * order (A, B, ...) by cumulative weight. Deterministic for the same experiment + session.
 */
export function assignVariant(experiment: AssignableExperiment, sessionId: string): string {
  const keys = Object.keys(experiment.variants).sort();
  if (keys.length === 0) throw new Error(`Experiment "${experiment.id}" has no variants`);
  const raw = keys.map((k) => Math.max(0, experiment.variants[k]!.weight || 0));
  // Integer weights are used as-is (contract); fractional weights are scaled to keep proportions.
  const weights = raw.every(Number.isInteger) ? raw : raw.map((w) => Math.round(w * 1000));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return keys[0]!;
  const h = fnv1a32(`${experiment.id}:${sessionId}`) % total;
  let cumulative = 0;
  for (let i = 0; i < keys.length; i++) {
    cumulative += weights[i]!;
    if (h < cumulative) return keys[i]!;
  }
  return keys[keys.length - 1]!;
}
