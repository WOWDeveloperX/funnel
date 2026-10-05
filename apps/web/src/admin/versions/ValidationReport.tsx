/**
 * Checklist + diff for a candidate config (POST /admin/versions/validate): segmented check bars, one
 * row per check (failed checks expand into one row per error with its JSON path), then a +/−/= diff
 * vs the active version. The rows and lines come from ./validationModel.
 */
import type { ConfigDiff } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Fragment, useMemo } from 'react';
import { VariantBadge } from '../components/ui';
import { useT } from '../i18n';
import { type CheckRow, type CheckState, type DiffSign, diffLines } from './validationModel';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BAR: Record<CheckState, string> = {
  ok: 'bg-ok',
  error: 'bg-bad',
  warning: 'bg-amber-400',
  info: 'bg-variant-a',
};

const ICON: Record<CheckState, { glyph: string; box: string; text: string; row: string }> = {
  ok: { glyph: '✓', box: 'border-ok/35 bg-ok/10 text-ok-ink', text: 'text-ad-text-2', row: '' },
  error: { glyph: '✕', box: 'border-bad/35 bg-bad/10 text-bad-ink', text: 'text-bad-ink', row: 'bg-bad/[0.03]' },
  warning: { glyph: '!', box: 'border-amber-400/35 bg-amber-400/10 text-amber-200', text: 'text-amber-100', row: '' },
  info: { glyph: 'i', box: 'border-variant-a/35 bg-variant-a/10 text-variant-a-ink', text: 'text-ad-text-2', row: '' },
};

/** Segmented progress bars, one per check row. */
export function CheckBars({ rows }: { rows: CheckRow[] }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {rows.map((r, i) => (
        <motion.span
          key={r.key}
          className={clsx('h-1 origin-left rounded-sm', BAR[r.state])}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.24) }}
        />
      ))}
    </div>
  );
}

/** Row text, plus the variant badges or branch step ids for those two rows. */
function RowText({ row }: { row: CheckRow }) {
  const t = useT();
  if (row.variants) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {row.text}
        {row.variants.map((v, i) => (
          <Fragment key={v.key}>
            {i > 0 && <span className="text-ad-ghost">·</span>}
            <span className="inline-flex items-center gap-1.5">
              <VariantBadge variant={v.key} /> {t.validation.steps(v.stepCount)}
            </span>
          </Fragment>
        ))}
      </span>
    );
  }
  if (row.branches && row.branches.length > 0) {
    return (
      <>
        {row.text}{' '}
        {row.branches.map((b, i) => (
          <Fragment key={b.stepId}>
            {i > 0 && ', '}
            <span
              className="font-mono text-[12px] text-ad-text"
              title={b.dependsOn.length ? `← ${b.dependsOn.join(', ')}` : undefined}
            >
              {b.stepId}
            </span>
          </Fragment>
        ))}
      </>
    );
  }
  return row.text;
}

export function CheckList({ rows, showPaths }: { rows: CheckRow[]; showPaths: boolean }) {
  const t = useT();
  return (
    <ul className={clsx('flex flex-col', showPaths ? 'gap-0.5' : 'gap-[9px]')}>
      {rows.map((r, i) => {
        const s = ICON[r.state];
        return (
          <motion.li
            key={r.key}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.24) }}
            className={clsx('flex items-start gap-3', showPaths ? clsx('-mx-2 rounded-[10px] px-2 py-2.5', s.row) : '')}
          >
            <span
              aria-hidden
              className={clsx(
                'grid shrink-0 place-items-center rounded-[5px] border text-[11px]',
                showPaths ? 'size-5 rounded-md' : 'size-[18px]',
                s.box,
              )}
            >
              {s.glyph}
            </span>
            <span className="sr-only">
              {r.state === 'ok'
                ? t.validation.srPassed
                : r.state === 'error'
                  ? t.validation.srError
                  : r.state === 'warning'
                    ? t.validation.srWarning
                    : ''}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={clsx('break-words', showPaths ? 'text-sm' : 'text-[13px]', s.text)}>
                <RowText row={r} />
              </span>
              {showPaths && r.path && (
                <span className="font-mono text-xs font-medium break-all text-ad-faint">{r.path}</span>
              )}
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const SIGN_STYLE: Record<
  DiffSign,
  { row: string; text: string; label: 'diffAdded' | 'diffRemoved' | 'diffChanged' | 'unchanged' }
> = {
  '+': { row: 'bg-ok/5', text: 'text-ok-ink', label: 'diffAdded' },
  '−': { row: 'bg-bad/5', text: 'text-bad-ink', label: 'diffRemoved' },
  '~': { row: 'bg-variant-a/5', text: 'text-variant-a-ink', label: 'diffChanged' },
  '=': { row: '', text: 'text-ad-faint', label: 'unchanged' },
};

export function DiffView({ diff, className }: { diff: ConfigDiff; className?: string }) {
  const t = useT();
  const lines = useMemo(() => diffLines(diff, t.validation), [diff, t]);
  const added = lines.filter((l) => l.sign === '+').length;
  const removed = lines.filter((l) => l.sign === '−').length;

  return (
    <div className={clsx('overflow-hidden rounded-[14px] border border-ad-row bg-ad-bg', className)}>
      <div className="flex flex-wrap justify-between gap-2 border-b border-ad-row px-3.5 py-2.5 font-mono text-[11px] font-medium tracking-[0.12em] text-ad-faint">
        <span>{t.validation.diffHeader(diff.fromVersion, diff.toVersion)}</span>
        <span>
          <span className="text-ok-ink">+{added}</span> <span className="text-bad-ink">−{removed}</span>
        </span>
      </div>
      <ul>
        {lines.map((l, i) => {
          const s = SIGN_STYLE[l.sign];
          return (
            <li
              key={`${l.group}-${l.sign}-${l.text}-${i}`}
              className={clsx(
                'grid grid-cols-[28px_minmax(0,110px)_minmax(0,1fr)] items-center px-3.5 py-[7px] font-mono text-[13px] font-medium sm:grid-cols-[28px_130px_minmax(0,1fr)]',
                s.row,
              )}
            >
              <span className={clsx('font-bold', s.text)}>
                <span aria-hidden>{l.sign}</span>
                <span className="sr-only">{t.validation[s.label]}</span>
              </span>
              <span className="truncate text-xs text-ad-faint">{l.group}</span>
              <span className={clsx('break-all', s.text)}>{l.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
