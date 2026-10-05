import type { StepMetrics } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useT } from '../i18n';
import type { ContentText } from '../lib/contentText';
import { variantHex } from '../lib/variants';
import { useTween } from './hooks';
import { colHead, Notice, Panel, Shimmer } from './kit';

const GRID =
  'grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem_4.25rem] items-center gap-2.5 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)_64px_84px] sm:gap-3.5';

/**
 * Unique sessions per step. Bar = viewed / eligible (sessions whose own version+variant sequence has
 * the step); the dimmer tail is the drop-off. Branch steps (visibleWhen) are measured against the
 * sessions the branch was available to; steps missing from part of the cohort carry an "only in" chip.
 * The row tooltip starts with the step's title (config content, in the UI language).
 */
export function StepFunnel({
  steps,
  variant,
  contentText,
}: {
  steps: StepMetrics[] | undefined;
  variant: string | 'all';
  contentText: ContentText;
}) {
  const t = useT();
  const fill = variant === 'all' ? null : variantHex(variant);
  const questions = steps?.filter((s) => s.type !== 'result') ?? [];
  const result = steps?.find((s) => s.type === 'result');

  return (
    <Panel
      title={t.analytics.stepFunnel}
      aside={
        <>
          <span>{t.analytics.legendSessions}</span>
          <span className="text-variant-a-ink">{t.analytics.legendBranch}</span>
        </>
      }
      className="gap-3.5"
    >
      <div className={clsx(GRID, colHead)} aria-hidden>
        <span>{t.analytics.colStep}</span>
        <span>{t.analytics.colSessions}</span>
        <span>{t.analytics.colConversion}</span>
        <span>{t.analytics.colDropOff}</span>
      </div>

      {!steps ? (
        Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={GRID}>
            <Shimmer className="h-3.5 w-28" />
            <Shimmer className="h-[26px]" />
            <span className="font-mono text-[13px] text-ad-ghost">—</span>
            <span className="font-mono text-[13px] text-ad-ghost">—</span>
          </div>
        ))
      ) : questions.length === 0 && !result ? (
        <Notice title={t.analytics.noStepData} className="py-6" />
      ) : (
        <ol className="flex flex-col gap-3.5">
          {questions.map((s, i) => (
            <StepRow key={s.stepId} index={i + 1} step={s} fill={fill} contentText={contentText} />
          ))}
        </ol>
      )}

      {result && <ResultRow step={result} />}
    </Panel>
  );
}

function StepRow({
  index,
  step: s,
  fill,
  contentText,
}: {
  index: number;
  step: StepMetrics;
  fill: string | null;
  contentText: ContentText;
}) {
  const tween = useTween();
  const t = useT();
  const fmtInt = t.fmt.int;
  const base = Math.max(s.eligible, 1);
  const progressedW = (s.progressed / base) * 100;
  const dropW = (s.dropOff / base) * 100;
  const branch = s.conditional;
  const color = fill ?? (branch ? '#2F9BFF' : '#C9D4E0');

  const tip = [
    s.title ? contentText(s.title) : null,
    t.analytics.tipViewed(fmtInt(s.viewed), fmtInt(s.eligible)),
    branch ? t.analytics.tipBranch(fmtInt(s.viewed), fmtInt(s.arrived)) : null,
    s.backFrom > 0 ? t.analytics.tipBack(fmtInt(s.backFrom)) : null,
    s.avgViewsPerSession > 1.05 ? t.analytics.tipViewsPerSession(t.fmt.decimal(s.avgViewsPerSession, 2)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={GRID} title={tip}>
      <span className="flex min-w-0 items-center gap-2 font-mono text-[13px] font-medium text-ad-text-2">
        <span className="shrink-0 text-ad-ghost">{String(index).padStart(2, '0')}</span>
        <span className="truncate">{s.stepId}</span>
      </span>

      <div
        className={clsx(
          '@container relative flex h-[26px] items-center gap-2 overflow-hidden rounded-[7px] border px-2.5',
          branch ? 'border-dashed border-variant-a/35 bg-variant-a/[0.03]' : 'border-ad-line-2 bg-ad-sunken',
        )}
      >
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ backgroundColor: color, opacity: branch ? 0.3 : 0.2 }}
          initial={false}
          animate={{ width: `${progressedW}%` }}
          transition={tween}
        />
        <motion.span
          aria-hidden
          className="absolute inset-y-0"
          style={{ backgroundColor: color, opacity: 0.08 }}
          initial={false}
          animate={{ left: `${progressedW}%`, width: `${dropW}%` }}
          transition={tween}
        />
        <span className="relative font-mono text-xs font-semibold text-ad-text tabular-nums">{fmtInt(s.viewed)}</span>
        {branch && (
          <span className="relative flex min-w-0 shrink-0 items-center gap-1 font-mono text-[11px] font-medium whitespace-nowrap text-variant-a-ink">
            ⑂<span className="hidden @[15rem]:inline">{t.analytics.ofEligible}</span>
            {t.fmt.pct(s.shownRate, 0)}
          </span>
        )}
        {s.onlyIn && (
          <span className="relative ml-auto shrink-0 rounded-[5px] bg-ad-chip px-1.5 py-px font-mono text-[10px] font-medium text-ad-muted">
            {t.analytics.onlyIn(s.onlyIn)}
          </span>
        )}
      </div>

      <span className="font-mono text-[13px] font-medium text-ad-text-2 tabular-nums">
        {t.fmt.pct(s.conversion, 0)}
      </span>
      <span
        className={clsx(
          'font-mono text-[13px] font-medium tabular-nums',
          s.dropOff > 0 ? 'text-bad-ink' : 'text-ad-ghost',
        )}
      >
        {s.dropOff > 0 ? `−${fmtInt(s.dropOff)}` : '0'}
        <span className="ml-1 text-[11px] text-ad-faint">{t.fmt.pct(s.dropOffRate, 0)}</span>
      </span>
    </li>
  );
}

function ResultRow({ step: s }: { step: StepMetrics }) {
  const tween = useTween();
  const t = useT();
  const fmtInt = t.fmt.int;
  const share = s.eligible ? s.viewed / s.eligible : 0;
  return (
    <div
      className="flex items-center gap-2.5 border-t border-ad-row pt-3 sm:gap-3.5"
      title={t.analytics.tipResult(fmtInt(s.viewed), fmtInt(s.eligible))}
    >
      <span className="w-[8.5rem] shrink-0 truncate font-mono text-[13px] font-medium text-signal-ink sm:w-[190px]">
        {s.stepId}
      </span>
      <div className="relative flex h-[26px] flex-1 items-center overflow-hidden rounded-[7px] border border-dashed border-signal/20 bg-signal/[0.04] px-2.5">
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-signal/20"
          initial={false}
          animate={{ width: `${share * 100}%` }}
          transition={tween}
        />
        <span className="relative font-mono text-xs font-semibold text-signal-ink tabular-nums">
          {fmtInt(s.viewed)}
        </span>
      </div>
      <span className="w-[calc(3rem+4.25rem+0.625rem)] shrink-0 font-mono text-[13px] font-medium text-signal-ink tabular-nums sm:w-[calc(64px+84px+0.875rem)]">
        {t.fmt.pct(share, 0)}
      </span>
    </div>
  );
}
