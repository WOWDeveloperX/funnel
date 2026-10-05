/**
 * Variant colours, used identically in badges, charts and panels: A = blue #2F9BFF, B = amber #F5A524.
 * Class strings are literal so Tailwind can detect them.
 */

const VARIANT_HEX: Record<string, string> = {
  A: '#2F9BFF',
  B: '#F5A524',
};

/** Light text tint per variant (on dark admin surfaces). */
const VARIANT_INK_HEX: Record<string, string> = {
  A: '#8CC4FF',
  B: '#FFD08A',
};

/** Colours for unexpected extra variants (C, D, …) — still distinct, never blue/amber. */
const FALLBACK_HEX = ['#3DD68C', '#C084FC', '#F472B6', '#8A97A8'];

export function variantHex(key: string, index = 0): string {
  return VARIANT_HEX[key] ?? FALLBACK_HEX[index % FALLBACK_HEX.length]!;
}

export function variantInkHex(key: string, index = 0): string {
  return VARIANT_INK_HEX[key] ?? variantHex(key, index);
}

export interface VariantClasses {
  /** Soft badge on dark surfaces: tinted background + border + light text. */
  badge: string;
  /** Badge variant for override (QA) sessions: dashed border. */
  badgeOverride: string;
  /** Solid dot / bar fill. */
  dot: string;
  /** Light text colour. */
  text: string;
  /** Tinted panel (vertical gradient) + top accent border. */
  panel: string;
}

const A: VariantClasses = {
  badge: 'bg-variant-a/10 border border-variant-a/35 text-variant-a-ink',
  badgeOverride: 'border border-dashed border-variant-a/55 text-variant-a-ink',
  dot: 'bg-variant-a',
  text: 'text-variant-a-ink',
  panel: 'bg-linear-to-b from-variant-a/12 to-variant-a/[0.02] border-t-2 border-variant-a',
};
const B: VariantClasses = {
  badge: 'bg-variant-b/10 border border-variant-b/35 text-variant-b-ink',
  badgeOverride: 'border border-dashed border-variant-b/55 text-variant-b-ink',
  dot: 'bg-variant-b',
  text: 'text-variant-b-ink',
  panel: 'bg-linear-to-b from-variant-b/12 to-variant-b/[0.02] border-t-2 border-variant-b',
};
const OTHER: VariantClasses = {
  badge: 'bg-ad-chip border border-ad-line-3 text-ad-text-2',
  badgeOverride: 'border border-dashed border-ad-line-3 text-ad-text-2',
  dot: 'bg-ad-muted',
  text: 'text-ad-text-2',
  panel: 'bg-ad-panel border-t-2 border-ad-line-3',
};

export function variantClasses(key: string): VariantClasses {
  if (key === 'A') return A;
  if (key === 'B') return B;
  return OTHER;
}
