import type { AbTestResult, Kpis, VariantAnalytics } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { type AdminMessages, useT } from '../i18n';
import { fmtDuration } from '../lib/format';
import { variantHex, variantInkHex } from '../lib/variants';
import { useTween } from './hooks';
import { MainBadge, Notice, Shimmer } from './kit';

interface Row {
  title: keyof AdminMessages['analytics'] & `kpi${string}`;
  main?: boolean;
  guard?: boolean;
  get: (k: Kpis) => number | null;
}

const ROWS: Row[] = [
  { title: 'kpiCtrFromStarted', main: true, get: (k) => k.ctrFromStarted },
  { title: 'kpiCompletion', get: (k) => k.completionRate },
  { title: 'kpiCtrFromViewedResult', get: (k) => k.ctrFromResult },
  { title: 'kpiTime', guard: true, get: (k) => k.medianTimeToResultSec ?? null },
];

/** A vs B on one experiment (one version, randomized sessions only) — `ab` undefined = loading. */
export function AbPanel({ ab, variants }: { ab: AbTestResult | null | undefined; variants: VariantAnalytics[] }) {
  const t = useT();
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-ad-line-2 bg-ad-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-[18px] pb-3.5">
        <h2 className="font-display text-base font-semibold text-ad-text">A vs B</h2>
        <div className="flex flex-wrap items-center gap-2">
          {ab && <ScopeChip ab={ab} />}
          {ab !== undefined && <Verdict ab={ab} />}
        </div>
      </div>

      {ab === undefined ? (
        <Loading />
      ) : ab === null ? (
        <Notice title={t.analytics.abNeedBoth} className="flex-1 py-12">
          {t.analytics.abNeedBothText}
        </Notice>
      ) : (
        <Body ab={ab} variants={variants} />
      )}
    </section>
  );
}

function Verdict({ ab }: { ab: AbTestResult | null }) {
  const t = useT();
  let dot = 'bg-ad-faint';
  let cls = 'bg-ad-chip text-ad-muted';
  let text = t.analytics.notEnoughData;
  if (ab && ab.enoughData) {
    if (ab.significant) {
      dot = 'bg-ok';
      cls = 'border border-ok-line bg-ok-bg text-ok-ink';
      text = t.analytics.significant(t.fmt.pValue(ab.pValue));
    } else {
      dot = 'bg-ad-muted';
      cls = 'bg-ad-chip text-ad-text-2';
      text = t.analytics.notSignificant(t.fmt.pValue(ab.pValue));
    }
  } else if (!ab) {
    text = t.analytics.noData;
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium',
        cls,
      )}
      title={ab && ab.z !== null ? `z = ${t.fmt.decimal(ab.z, 2)}` : undefined}
    >
      <span aria-hidden className={clsx('size-1.5 rounded-full', dot)} />
      {text}
    </span>
  );
}

/** Which slice of the cohort the test ran on — data only, shown when it differs from the cohort. */
function ScopeChip({ ab }: { ab: AbTestResult }) {
  const t = useT();
  if (ab.otherVersions.length === 0 && ab.overrideExcluded === 0) return null;
  const parts = [`v${ab.version}`];
  if (ab.overrideExcluded > 0) parts.push(t.analytics.overrideExcluded(t.fmt.int(ab.overrideExcluded)));
  return (
    <span className="rounded-full border border-ad-line-3 px-2.5 py-[3px] font-mono text-[11px] font-medium text-ad-muted">
      {parts.join(' · ')}
    </span>
  );
}

function Loading() {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-2">
        {['A', 'B'].map((v) => (
          <ArmTile key={v} variant={v} n={null} />
        ))}
      </div>
      {ROWS.map((r) => (
        <div key={r.title} className="flex flex-col gap-2 border-t border-ad-row px-[18px] py-3">
          <span className="text-[13px] text-ad-text-2">{t.analytics[r.title]}</span>
          <Shimmer className="h-4" />
        </div>
      ))}
    </>
  );
}

function ArmTile({ variant, n, index = 0 }: { variant: string; n: number | null; index?: number }) {
  const t = useT();
  const hex = variantHex(variant, index);
  return (
    <div
      className="flex items-end justify-between px-[18px] py-3.5"
      style={{ background: `linear-gradient(180deg, ${hex}1F, ${hex}05)`, borderTop: `2px solid ${hex}` }}
    >
      <span className="font-display text-[44px] leading-[0.8] font-extrabold" style={{ color: hex }}>
        {variant}
      </span>
      <span className="font-mono text-[11px] font-medium" style={{ color: variantInkHex(variant, index) }}>
        {t.analytics.armSessions(n === null ? '—' : t.fmt.int(n))}
      </span>
    </div>
  );
}

function Body({ ab, variants }: { ab: AbTestResult; variants: VariantAnalytics[] }) {
  // Arm KPIs come from the test cohort; older servers without them fall back to the variant block.
  const ka = ab.a.kpis ?? variants.find((v) => v.variant === ab.a.variant)?.kpis;
  const kb = ab.b.kpis ?? variants.find((v) => v.variant === ab.b.variant)?.kpis;

  return (
    <>
      <div className="grid grid-cols-2">
        <ArmTile variant={ab.a.variant} n={ab.a.n} index={0} />
        <ArmTile variant={ab.b.variant} n={ab.b.n} index={1} />
      </div>
      {ROWS.map((r) => {
        const a = r.title === ROWS[0]!.title ? ab.a.rate : ka ? r.get(ka) : null;
        const b = r.title === ROWS[0]!.title ? ab.b.rate : kb ? r.get(kb) : null;
        return <AbRow key={r.title} row={r} a={a} b={b} va={ab.a.variant} vb={ab.b.variant} />;
      })}
    </>
  );
}

function AbRow({ row, a, b, va, vb }: { row: Row; a: number | null; b: number | null; va: string; vb: string }) {
  const t = useT();
  const time = !!row.guard;
  const fmt = (v: number | null) => (v === null ? '—' : time ? fmtDuration(v) : t.fmt.pct(v));
  const max = time ? Math.max(a ?? 0, b ?? 0, 1) : 1;
  const wa = a === null ? 0 : Math.min(1, a / max);
  const wb = b === null ? 0 : Math.min(1, b / max);

  let delta = '—';
  let tone = 'text-ad-faint';
  if (a !== null && b !== null) {
    const d = b - a;
    delta = time ? t.fmt.durationDelta(d) : t.fmt.pp(d * 100);
    const better = time ? d < 0 : d > 0;
    const zero = time ? Math.round(d) === 0 : Math.abs(d * 100) < 0.05;
    tone = zero ? 'text-ad-muted' : better ? 'text-ok-ink' : 'text-bad-ink';
  }

  return (
    <div className="flex flex-col gap-2 border-t border-ad-row px-[18px] py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-ad-text-2">{t.analytics[row.title]}</span>
        {row.main && <MainBadge />}
        {row.guard && (
          <span className="rounded-[5px] border border-ad-line-3 px-[7px] py-0.5 font-mono text-[10px] leading-none font-semibold text-ad-muted">
            {t.analytics.guardBadge}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] items-center gap-2.5 font-mono text-sm font-semibold">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 tabular-nums" style={{ color: variantHex(va, 0) }}>
            {fmt(a)}
          </span>
          <Track hex={variantHex(va, 0)} w={wa} />
        </div>
        <span
          className={clsx('rounded-md bg-ad-chip py-[3px] text-center text-[11px] tabular-nums', tone)}
          title={t.analytics.relativeTo(vb, va)}
        >
          {delta}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <Track hex={variantHex(vb, 1)} w={wb} reverse />
          <span className="shrink-0 tabular-nums" style={{ color: variantHex(vb, 1) }}>
            {fmt(b)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Track({ hex, w, reverse }: { hex: string; w: number; reverse?: boolean }) {
  const tween = useTween();
  return (
    <span
      aria-hidden
      className={clsx('flex h-1 min-w-0 flex-1 overflow-hidden rounded-sm', reverse && 'justify-end')}
      style={{ backgroundColor: `${hex}22` }}
    >
      <motion.span
        className="h-full rounded-sm"
        style={{ backgroundColor: hex }}
        initial={false}
        animate={{ width: `${w * 100}%` }}
        transition={tween}
      />
    </span>
  );
}
