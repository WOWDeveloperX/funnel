/**
 * Shared CLI plumbing: common flags, number parsing, small concurrency pool and table printing.
 */
import { connectionHint } from './http';

/** Flags every script accepts (spread into node:util parseArgs options). */
export const COMMON_OPTIONS = {
  url: { type: 'string' },
  token: { type: 'string' },
  funnel: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

const DEFAULT_URL = 'http://localhost:3000';

/** --url, else $FUNNEL_URL, else localhost:3000. */
export function resolveUrl(flag: string | undefined): string {
  return flag ?? process.env.FUNNEL_URL ?? DEFAULT_URL;
}

/** --token, else $ADMIN_TOKEN (unset → no auth header). */
export function resolveToken(flag: string | undefined): string | undefined {
  const t = flag ?? process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

export function intOption(value: string | undefined, name: string, fallback: number, min = 0): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min} (got "${value}")`);
  return n;
}

export function floatOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`--${name} must be a number in [0, 1] (got "${value}")`);
  return n;
}

/** Runs `fn` over items with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

type Align = 'l' | 'r';

/** Plain-text table with a header rule. Numbers are right-aligned by default. */
export function table(headers: string[], rows: (string | number)[][], align?: Align[]): string {
  const cells = rows.map((r) => r.map((c) => String(c)));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const al = (i: number): Align => align?.[i] ?? (rows.some((r) => typeof r[i] === 'number') ? 'r' : 'l');
  const fmt = (r: string[]): string =>
    r
      .map((c, i) => (al(i) === 'r' ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();
  return [fmt(headers), widths.map((w) => '─'.repeat(w)).join('  '), ...cells.map(fmt)].join('\n');
}

export const pct = (num: number, den: number): string => (den > 0 ? `${((100 * num) / den).toFixed(1)}%` : '—');

export const OK = '✓';
export const FAIL = '✗';

export function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/** Wraps a script's main(): prints friendly errors and sets the exit code. */
export function runMain(main: () => Promise<number>, baseUrlForHint?: () => string): void {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      const hint = baseUrlForHint ? connectionHint(err, baseUrlForHint()) : null;
      console.error(`\n${FAIL} ${err instanceof Error ? err.message : String(err)}`);
      if (hint) console.error(`  ${hint}`);
      process.exitCode = 1;
    },
  );
}
