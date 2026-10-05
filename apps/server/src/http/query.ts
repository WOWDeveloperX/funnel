/**
 * Lenient querystring building blocks for dashboard endpoints: a repeated param uses its first
 * value, and blank or non-string values count as absent instead of failing the request.
 * (`z.unknown().optional()` before a transform lets the field be missing from the object.)
 */
import { z } from 'zod';

/** First value of a possibly repeated query param (`?a=1&a=2` → '1'). */
export const firstValue = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Trimmed string, or null when missing / blank / not a string. */
export const optionalString = z
  .unknown()
  .optional()
  .transform((v): string | null => {
    const s = firstValue(v);
    return typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
  });

/** Every value of a list param, accepting both repetition and commas (`?c=a,b&c=c` → [a, b, c]), deduplicated. */
export function listValues(...raw: unknown[]): string[] {
  const out: string[] = [];
  for (const value of raw.flat()) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const v = part.trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** 1 / true / yes (case-insensitive) → true; anything else → false. */
export const flag = z
  .unknown()
  .optional()
  .transform((v) => {
    const s = firstValue(v);
    return typeof s === 'string' && ['1', 'true', 'yes'].includes(s.trim().toLowerCase());
  });
