import type { AdminFeedKind, AdminFeedRow } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { focusRing } from '../analytics/kit';
import { type AdminMessages, useT } from '../i18n';
import { fmtTime, shortId } from '../lib/format';
import { variantInkHex } from '../lib/variants';

const COLS = 'grid grid-cols-[100px_100px_180px_120px_90px_160px_minmax(0,1fr)] items-center gap-3 px-4 sm:px-7';

const ROW_TONE: Record<AdminFeedKind | 'new', string> = {
  new: 'border-l-signal bg-signal/[0.07]',
  duplicate: 'border-l-variant-a bg-variant-a/[0.06]',
  rejected: 'border-l-bad bg-bad/[0.06]',
  accepted: 'border-l-transparent',
};

/** Rejection reason (code + detail) → short label in the UI language; the raw reason stays in the title. */
function reasonLabel(reason: string | null, t: AdminMessages['events']): string {
  if (!reason) return t.rejected;
  const code = reason.split(/[:\s]/, 1)[0] ?? reason;
  return t.reasons[code] ?? t.rejected;
}

export function EventsHeader() {
  const t = useT();
  return (
    <div
      role="row"
      className={clsx(
        COLS,
        'border-b border-ad-line py-3 font-mono text-[10px] font-medium tracking-[0.12em] text-ad-faint',
      )}
    >
      {t.events.columns.map((h) => (
        <span key={h} role="columnheader">
          {h}
        </span>
      ))}
    </div>
  );
}

export function EventRows({
  rows,
  isNew,
  activeSessionId,
  onSessionClick,
}: {
  rows: AdminFeedRow[];
  isNew: (key: string) => boolean;
  activeSessionId: string;
  onSessionClick: (sessionId: string) => void;
}) {
  const t = useT();
  return (
    <>
      {rows.map((r) => {
        const fresh = isNew(r.key);
        const tone = fresh && r.kind === 'accepted' ? 'new' : r.kind;
        return (
          <motion.div
            key={r.key}
            role="row"
            initial={fresh ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={clsx(
              COLS,
              'min-h-11 border-b border-l-2 border-b-ad-sunken py-2 font-mono text-xs transition-colors duration-1000',
              ROW_TONE[tone],
            )}
          >
            <span role="cell" className="text-ad-text-2 tabular-nums" title={t.fmt.full(r.receivedAt)}>
              {fmtTime(r.receivedAt)}
            </span>
            <span
              role="cell"
              className="text-ad-muted tabular-nums"
              title={r.clientTs ? t.fmt.full(r.clientTs) : undefined}
            >
              {r.clientTs ? fmtTime(r.clientTs) : '—'}
            </span>
            <span role="cell" className="flex min-w-0 items-center gap-2">
              <span className={clsx('truncate', r.kind === 'rejected' ? 'text-bad-ink' : 'text-ad-text')}>
                {r.name ?? '—'}
              </span>
              {r.kind === 'duplicate' && (
                <span className="shrink-0 rounded-[5px] border border-variant-a/40 bg-variant-a/10 px-1.5 py-px text-[10px] font-semibold text-variant-a-ink">
                  {t.events.duplicateChip}
                </span>
              )}
            </span>
            <span role="cell" className="min-w-0">
              {r.sessionId ? (
                <button
                  type="button"
                  onClick={() => onSessionClick(r.sessionId!)}
                  title={r.sessionId}
                  aria-pressed={activeSessionId === r.sessionId}
                  className={clsx(
                    'max-w-full truncate rounded-md px-1.5 py-0.5 transition-colors',
                    activeSessionId === r.sessionId
                      ? 'bg-signal/15 text-signal-ink'
                      : 'text-ad-text-2 underline decoration-ad-line-3 underline-offset-[3px] hover:bg-ad-chip hover:text-ad-text',
                    focusRing,
                  )}
                >
                  {shortId(r.sessionId)}
                </button>
              ) : (
                <span className="text-ad-ghost">—</span>
              )}
            </span>
            <span role="cell" className="text-ad-text-2">
              {r.funnelVersion !== null ? (
                <>
                  v{r.funnelVersion}
                  {r.variant && (
                    <>
                      <span className="text-ad-ghost"> · </span>
                      <span className="font-bold" style={{ color: variantInkHex(r.variant) }}>
                        {r.variant}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-ad-ghost">—</span>
              )}
            </span>
            <span role="cell" className="truncate text-ad-text-2" title={r.stepId ?? undefined}>
              {r.stepId ?? <span className="text-ad-ghost">—</span>}
            </span>
            <span role="cell" className="min-w-0">
              {r.kind === 'rejected' ? (
                <span className="block truncate text-bad-ink" title={r.reason ?? undefined}>
                  {reasonLabel(r.reason, t.events)}
                </span>
              ) : (
                <Properties props={r.properties} />
              )}
            </span>
          </motion.div>
        );
      })}
    </>
  );
}

function Properties({ props }: { props: AdminFeedRow['properties'] }) {
  const entries = Object.entries(props);
  if (entries.length === 0) return <span className="text-ad-ghost">—</span>;
  const text = entries.map(([k, v]) => `${k}=${String(v)}`).join(' ');
  return (
    <span className="block truncate text-[11px]" title={text}>
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2.5">
          <span className="text-ad-faint">{k}=</span>
          <span className="text-ad-text-2">{String(v)}</span>
        </span>
      ))}
    </span>
  );
}
