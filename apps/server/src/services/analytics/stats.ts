/**
 * Small statistics helpers for analytics (pure functions, no I/O).
 */

/** erf(x), Abramowitz & Stegun 7.1.26 (max abs error 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF Φ(z). */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

interface ZTestResult {
  z: number | null;
  pValue: number | null;
}

/**
 * Two-proportion pooled z-test of x2/n2 vs x1/n1 (z > 0 ⇔ the second rate is higher).
 * p-value is two-sided. Returns nulls when either group is empty. When the pooled rate is 0 or 1
 * both rates are identical, so z = 0 and p = 1.
 */
export function twoProportionZTest(x1: number, n1: number, x2: number, n2: number): ZTestResult {
  if (n1 <= 0 || n2 <= 0) return { z: null, pValue: null };
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return { z: 0, pValue: 1 };
  const z = (x2 / n2 - x1 / n1) / se;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
  return { z, pValue };
}

/** a / b, or 0 for an empty denominator (all rates in the API follow this rule). */
export function ratio(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/** Median of a list of numbers (mean of the two middle values for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
