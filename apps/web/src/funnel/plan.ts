/**
 * The plan panel content: the result's own `plan` (config, variant resultOverrides included), else
 * `fallback`, the generic cadence from the chrome strings in the funnel's language.
 */
export function planFor(result: { plan?: string[] }, fallback: readonly string[]): readonly string[] {
  return result.plan && result.plan.length > 0 ? result.plan : fallback;
}
