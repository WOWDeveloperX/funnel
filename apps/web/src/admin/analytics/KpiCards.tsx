import type { Kpis, VariantAnalytics } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { CountUp } from '../components/CountUp';
import { type AdminMessages, useT } from '../i18n';
import { variantHex } from '../lib/variants';
import { useTween } from './hooks';
import { MainBadge, Shimmer } from './kit';

const KPI_TITLES = [
  'kpiStarted',
  'kpiReachedResult',
  'kpiCtaClicked',
  'kpiCtrFromStarted',
  'kpiCtrFromResult',
] as const satisfies readonly (keyof AdminMessages['analytics'])[];
const PRIMARY = 3;

/** Five joined KPI cells; `kpis` undefined = loading skeleton. */
export function KpiCards({ kpis, variants }: { kpis: Kpis | undefined; variants: VariantAnalytics[] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[18px] border border-ad-line-2 sm:grid-cols-3 xl:grid-cols-[1.25fr_1fr_1fr_1fr_1fr]">
      {KPI_TITLES.map((key, i) => (
        <Cell key={key} title={t.analytics[key]} primary={i === PRIMARY} index={i}>
          {kpis ? <CellBody index={i} k={kpis} variants={variants} /> : <Skeleton />}
        </Cell>
      ))}
    </div>
  );
}

function Cell({
  title,
  primary,
  index,
  children,
}: {
  title: string;
  primary: boolean;
  index: number;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'relative flex min-w-0 flex-col gap-3.5 p-[18px]',
        index === 4 && 'max-sm:col-span-2 sm:max-xl:col-span-2',
        primary
          ? 'bg-[radial-gradient(100%_100%_at_0%_0%,rgb(200_245_74/0.07),var(--color-ad-panel)_70%)]'
          : 'bg-ad-panel',
      )}
    >
      {primary && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-signal/70 via-signal/20 to-transparent"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-ad-muted">{title}</span>
        {primary && <MainBadge />}
      </div>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <span className="font-mono text-[40px] leading-none font-semibold tracking-[-0.03em] text-ad-ghost">—</span>
      <Shimmer className="h-6" />
      <Shimmer className="h-3 w-24" />
    </>
  );
}

function CellBody({ index, k, variants }: { index: number; k: Kpis; variants: VariantAnalytics[] }) {
  const tween = useTween();
  const t = useT();
  const fmtInt = t.fmt.int;
  switch (index) {
    case 0: {
      const split = variants.filter((v) => v.kpis.started > 0);
      const total = split.reduce((s, v) => s + v.kpis.started, 0);
      return (
        <>
          <Big value={k.started} format={fmtInt} />
          {split.length > 1 && total > 0 ? (
            <>
              <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {split.map((v, i) => (
                  <motion.span
                    key={v.variant}
                    className="h-full rounded-full"
                    style={{ backgroundColor: variantHex(v.variant, i) }}
                    initial={false}
                    animate={{ flexGrow: v.kpis.started / total }}
                    transition={tween}
                  />
                ))}
              </div>
              <Sub>
                {split.map((v, i) => (
                  <span key={v.variant} className="mr-2.5 whitespace-nowrap">
                    <span style={{ color: variantHex(v.variant, i) }}>{v.variant}</span> {fmtInt(v.kpis.started)}
                  </span>
                ))}
              </Sub>
            </>
          ) : (
            <>
              <Bar share={k.started > 0 ? 1 : 0} />
              <Sub>{t.common.sessions(fmtInt(k.started), k.started)}</Sub>
            </>
          )}
        </>
      );
    }
    case 1:
      return (
        <>
          <Big value={k.reachedResult} format={fmtInt} />
          <Bar share={k.completionRate} />
          <Sub>{t.analytics.ofStarted(t.fmt.pct(k.completionRate, 0))}</Sub>
        </>
      );
    case 2:
      return (
        <>
          <Big value={k.ctaClicked} format={fmtInt} />
          <Bar share={k.started ? k.ctaClicked / k.started : 0} />
          <Sub>{t.analytics.ofStarted(t.fmt.pct(k.started ? k.ctaClicked / k.started : 0, 0))}</Sub>
        </>
      );
    case 3:
      return (
        <>
          <Big value={k.ctrFromStarted} format={(n) => t.fmt.pct(n)} accent />
          <Bar share={k.ctrFromStarted} accent />
          <Sub>{t.analytics.clicksOfStarted(fmtInt(k.ctaClicked), fmtInt(k.started), k.started)}</Sub>
        </>
      );
    default:
      return (
        <>
          <Big value={k.ctrFromResult} format={(n) => t.fmt.pct(n)} />
          <Bar share={k.ctrFromResult} />
          <Sub>{t.analytics.ofResults(fmtInt(k.reachedResult), k.reachedResult)}</Sub>
        </>
      );
  }
}

function Big({ value, format, accent }: { value: number; format: (n: number) => string; accent?: boolean }) {
  return (
    <span
      className={clsx(
        'truncate font-mono text-[40px] leading-none font-semibold tracking-[-0.03em]',
        accent ? 'text-signal drop-shadow-[0_0_18px_rgb(200_245_74/0.35)]' : 'text-ad-text',
      )}
    >
      <CountUp value={value} format={format} />
    </span>
  );
}

function Bar({ share, accent }: { share: number; accent?: boolean }) {
  const tween = useTween();
  const w = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ad-sunken" aria-hidden>
      <motion.div
        className={clsx(
          'h-full rounded-full',
          accent ? 'bg-signal shadow-[0_0_12px_rgb(200_245_74/0.6)]' : 'bg-ad-text-2/55',
        )}
        initial={false}
        animate={{ width: `${w}%` }}
        transition={tween}
      />
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="truncate font-mono text-[11px] font-medium text-ad-faint">{children}</span>;
}
