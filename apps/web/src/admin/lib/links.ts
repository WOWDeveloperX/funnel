/**
 * Funnel link that starts a fresh session in a given variant (QA / "open as A/B"). `variant` matches
 * `experiment.overrideQueryParam` of the supplied configs; `reset=1` drops the stored session first,
 * because the override only applies when a session is created.
 */
export function openAsHref(variant: string): string {
  return `/?variant=${encodeURIComponent(variant)}&reset=1`;
}
