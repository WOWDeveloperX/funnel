/**
 * Formatters shared by every admin page, bound to the selected UI language (see useT(): `t.fmt`).
 * Numbers and dates go through Intl with the dictionary's locale; unit words come from the
 * dictionary. Language-independent helpers (p-value, m:ss, log time, short ids) are plain exports.
 */
import type { AdminMessages } from '../i18n/ru';

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Language-independent
// ---------------------------------------------------------------------------

/** Seconds → "m:ss". */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "14:20:05.123" — milliseconds matter in a live event log. */
export function fmtTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function shortId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) : id;
}

// ---------------------------------------------------------------------------
// Language-bound
// ---------------------------------------------------------------------------

export interface Formatters {
  /** 12345 → "12 345" (ru) / "12,345" (en). */
  int: (n: number) => string;
  /** Fraction in [0,1] → "42,5 %" (ru) / "42.5%" (en); digits = 0 → "43 %". */
  pct: (rate: number, digits?: number) => string;
  /** Fixed decimals with the language's separator: 1.07 → "1,07" (ru) / "1.07" (en). */
  decimal: (n: number, digits: number) => string;
  /** "p<0,001", "p=0,004", "p=0,12" (ru) / "p<0.001" … (en). */
  pValue: (p: number | null) => string;
  /** Percentage points with an explicit sign: "+3.2 п.п." / "+3.2 pp" ("±0.0 …" when it rounds to zero). */
  pp: (points: number, digits?: number) => string;
  /** Signed seconds delta: "+12 с" / "+12s", "−1:05". */
  durationDelta: (sec: number) => string;
  /** "03.10 14:20" (ru) / "3 Oct 14:20" (en); the year is added when it is not the current one. */
  dateTime: (iso: string | null | undefined) => string;
  /** Full localized date and time (tooltips). */
  full: (iso: string | null | undefined) => string;
  /** "5 мин назад" / "5 min ago", "через 2 ч" / "in 2 h", "только что" / "just now". */
  relative: (iso: string | null | undefined, now?: number) => string;
}

export function createFormatters(t: Pick<AdminMessages, 'locale' | 'format'>): Formatters {
  const intFmt = new Intl.NumberFormat(t.locale);
  const dayMonth = new Intl.DateTimeFormat(t.locale, t.format.dayMonth);
  const dayMonthYear = new Intl.DateTimeFormat(t.locale, { ...t.format.dayMonth, year: 'numeric' });
  const fullFmt = new Intl.DateTimeFormat(t.locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const f = t.format;

  const decimal = (n: number, digits: number) =>
    new Intl.NumberFormat(t.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

  return {
    int: (n) => intFmt.format(Math.round(n)),

    pct: (rate, digits = 1) =>
      Number.isFinite(rate)
        ? new Intl.NumberFormat(t.locale, {
            style: 'percent',
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          }).format(rate)
        : '—',

    decimal,

    pValue: (p) => {
      if (p === null || !Number.isFinite(p)) return 'p=—';
      if (p < 0.001) return `p<${decimal(0.001, 3)}`;
      return `p=${decimal(p, p < 0.01 ? 3 : 2)}`;
    },

    pp: (points, digits = 1) => {
      if (!Number.isFinite(points)) return '—';
      const r = Number(Math.abs(points).toFixed(digits));
      const sign = r === 0 ? '±' : points > 0 ? '+' : '−';
      return `${sign}${decimal(r, digits)} ${f.pp}`;
    },

    durationDelta: (sec) => {
      const s = Math.round(sec);
      const sign = s === 0 ? '±' : s > 0 ? '+' : '−';
      const a = Math.abs(s);
      return `${sign}${a < 60 ? f.seconds(a) : fmtDuration(a)}`;
    },

    dateTime: (iso) => {
      const d = toDate(iso);
      if (!d) return '—';
      const date = (d.getFullYear() !== new Date().getFullYear() ? dayMonthYear : dayMonth).format(d);
      return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    full: (iso) => {
      const d = toDate(iso);
      return d ? fullFmt.format(d) : '';
    },

    relative: (iso, now = Date.now()) => {
      const d = toDate(iso);
      if (!d) return '—';
      const sec = Math.round((now - d.getTime()) / 1000);
      const abs = Math.abs(sec);
      if (abs < 5) return f.justNow;
      const value =
        abs < 60
          ? f.seconds(abs)
          : abs < 3600
            ? f.minutes(Math.round(abs / 60))
            : abs < 86400
              ? f.hours(Math.round(abs / 3600))
              : f.days(Math.round(abs / 86400));
      return sec >= 0 ? f.ago(value) : f.in(value);
    },
  };
}
