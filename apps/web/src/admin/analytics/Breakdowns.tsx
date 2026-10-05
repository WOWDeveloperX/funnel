/**
 * Row 3 of the dashboard (versions, results, UTM) and the strips below it (extra events, data
 * quality). Every block shows only data; empty states are short product copy. Result titles are
 * config content, shown in the UI language through the funnel's catalogs (contentText).
 */
import { NONE_CAMPAIGN, type AnalyticsResponse, type Kpis } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { type AdminI18n, useT } from '../i18n';
import type { ContentText } from '../lib/contentText';
import { fmtDuration } from '../lib/format';
import { campaignLabel } from './filters';
import { useTween } from './hooks';
import { colHead, focusRing, Panel, Shimmer } from './kit';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const KPI_ROWS: { title: keyof AdminI18n['analytics'] & `kpi${string}`; render: (k: Kpis, t: AdminI18n) => string }[] =
  [
    { title: 'kpiStarted', render: (k, t) => t.fmt.int(k.started) },
    { title: 'kpiReachedResult', render: (k, t) => t.fmt.int(k.reachedResult) },
    { title: 'kpiCtaClicked', render: (k, t) => t.fmt.int(k.ctaClicked) },
    { title: 'kpiCtrFromStarted', render: (k, t) => t.fmt.pct(k.ctrFromStarted) },
    { title: 'kpiCtrFromResult', render: (k, t) => t.fmt.pct(k.ctrFromResult) },
    { title: 'kpiTime', render: (k) => fmtDuration(k.medianTimeToResultSec) },
  ];

export function VersionsCard({
  versions,
  selected,
  onSelect,
}: {
  versions: AnalyticsResponse['versions'] | undefined;
  selected: number | 'all';
  onSelect: (v: number | 'all') => void;
}) {
  const t = useT();
  const cols = versions ?? [];
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${Math.max(cols.length, 1)}, minmax(56px,auto))` };

  return (
    <Panel
      title={t.analytics.versionsTitle}
      aside={cols.length ? cols.map((v) => `v${v.version}`).join(' · ') : undefined}
    >
      {!versions ? (
        <SkeletonRows n={5} />
      ) : cols.length === 0 ? (
        <EmptyLine>{t.analytics.noVersions}</EmptyLine>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-max gap-x-2.5" style={grid} role="table" aria-label={t.analytics.kpiByVersion}>
            <div role="row" className="contents">
              <span role="columnheader" className={clsx(colHead, 'pb-1')}>
                KPI
              </span>
              {cols.map((v) => (
                <span key={v.version} role="columnheader" className="pb-1 text-right">
                  <button
                    type="button"
                    onClick={() => onSelect(selected === v.version ? 'all' : v.version)}
                    aria-pressed={selected === v.version}
                    className={clsx(
                      colHead,
                      'rounded px-1 transition-colors hover:text-ad-text',
                      selected === v.version && 'text-signal-ink',
                      focusRing,
                    )}
                  >
                    V{v.version}
                  </button>
                </span>
              ))}
            </div>
            {KPI_ROWS.map((r, ri) => (
              <div key={r.title} role="row" className="contents">
                <span
                  role="rowheader"
                  className="truncate border-t border-ad-row pt-[9px] pb-0.5 text-[13px] text-ad-text-2"
                >
                  {t.analytics[r.title]}
                </span>
                {cols.map((v) => (
                  <span
                    key={v.version}
                    role="cell"
                    className={clsx(
                      'border-t border-ad-row pt-[9px] pb-0.5 text-right font-mono text-[13px] tabular-nums',
                      selected === v.version ? 'text-signal-ink' : ri === 3 ? 'text-ad-text' : 'text-ad-text-2',
                    )}
                  >
                    {r.render(v.kpis, t)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Results — vertical bars per result_id, lime part = CTA clicks
// ---------------------------------------------------------------------------

const GHOST = [40, 72, 55, 30, 62];

/** Result id under a narrow bar on two lines, split at the first "_" (never inside a word). */
const idHead = (id: string): string => id.split('_', 1)[0] ?? id;
const idTail = (id: string): string => id.slice(idHead(id).length + 1);

export function ResultsCard({
  results,
  contentText,
}: {
  results: AnalyticsResponse['results'] | undefined;
  contentText: ContentText;
}) {
  const tween = useTween();
  const t = useT();
  const fmtInt = t.fmt.int;
  const sorted = [...(results ?? [])].filter((r) => r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  const max = sorted.reduce((m, r) => Math.max(m, r.sessions), 0);

  return (
    <Panel
      title={t.analytics.results}
      aside={
        sorted.length > 0 ? (
          <>
            <Legend className="bg-ad-line-3" label={t.analytics.legendSessionsShort} />
            <Legend className="bg-signal" label="CTA" />
          </>
        ) : undefined
      }
    >
      {!results || sorted.length === 0 ? (
        <div className="relative flex min-h-[170px] flex-1 items-end gap-2.5 rounded-xl border border-dashed border-ad-line-3/70 p-4">
          {GHOST.map((h, i) => (
            <span
              key={i}
              aria-hidden
              className={clsx(
                'flex-1 rounded-t-md rounded-b-sm bg-linear-to-b from-ad-line to-ad-sunken',
                !results && 'animate-glow',
              )}
              style={{ height: `${h}%` }}
            />
          ))}
          {results && (
            <span className="absolute inset-0 grid place-items-center text-[13px] text-ad-faint">
              {t.analytics.noResults}
            </span>
          )}
        </div>
      ) : (
        <div className="flex min-h-[170px] flex-1 items-stretch gap-2 pt-1" role="list">
          {sorted.map((r) => {
            const h = max ? (r.sessions / max) * 100 : 0;
            return (
              <div
                key={r.resultId}
                role="listitem"
                className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5"
                title={`${contentText(r.title)} · ${t.common.sessions(fmtInt(r.sessions), r.sessions)} · CTA ${fmtInt(r.ctaClicked)}`}
              >
                <span className="font-mono text-[11px] font-semibold text-signal-ink tabular-nums">
                  {t.fmt.pct(r.ctr, 0)}
                </span>
                <div className="relative flex w-full flex-1 items-end">
                  <motion.div
                    className="relative w-full overflow-hidden rounded-t-md rounded-b-sm bg-linear-to-b from-ad-line-3 to-ad-line"
                    initial={false}
                    animate={{ height: `${Math.max(h, 2)}%` }}
                    transition={tween}
                  >
                    <motion.div
                      className="absolute inset-x-0 bottom-0 bg-signal/80"
                      initial={false}
                      animate={{ height: `${r.ctr * 100}%` }}
                      transition={tween}
                    />
                  </motion.div>
                </div>
                <span className="font-mono text-xs font-semibold text-ad-text tabular-nums">{fmtInt(r.sessions)}</span>
                <span className="flex w-full flex-col text-center font-mono text-[10px] leading-tight text-ad-faint">
                  <span className="truncate">{idHead(r.resultId)}</span>
                  {idTail(r.resultId) && <span className="truncate">{idTail(r.resultId)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// UTM
// ---------------------------------------------------------------------------

const UTM_GRID = 'grid grid-cols-[minmax(0,1fr)_46px_46px_52px] items-center gap-2';

export function UtmCard({
  campaigns,
  selected,
  onToggle,
}: {
  campaigns: AnalyticsResponse['campaigns'] | undefined;
  selected: string[];
  onToggle: (campaign: string) => void;
}) {
  const t = useT();
  return (
    <Panel title="UTM" aside="utm_campaign">
      <div className={clsx(UTM_GRID, colHead, 'tracking-[0.1em]')} aria-hidden>
        <span>{t.analytics.utmCampaign}</span>
        <span className="text-right">{t.analytics.utmStarted}</span>
        <span className="text-right">{t.analytics.utmResult}</span>
        <span className="text-right">CTR</span>
      </div>
      {!campaigns ? (
        <SkeletonRows n={4} />
      ) : campaigns.length === 0 ? (
        <EmptyLine>{t.analytics.noCampaignsInCohort}</EmptyLine>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {campaigns.map((c) => {
            const on = selected.includes(c.campaign);
            return (
              <li key={c.campaign}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(c.campaign)}
                  className={clsx(
                    UTM_GRID,
                    'w-full rounded-lg border-t border-ad-row px-2 py-[9px] text-left font-mono text-[13px] font-medium transition-colors',
                    on ? 'bg-signal/8 text-signal-ink' : 'hover:bg-ad-sunken',
                    focusRing,
                  )}
                >
                  <span
                    className={clsx(
                      'flex min-w-0 items-center gap-2 truncate',
                      on ? 'text-signal-ink' : c.campaign === NONE_CAMPAIGN ? 'text-ad-muted' : 'text-ad-text-2',
                    )}
                  >
                    {on && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-signal" />}
                    <span className="truncate">{campaignLabel(c.campaign, t.analytics.noCampaign)}</span>
                  </span>
                  <span className="text-right text-ad-text-2 tabular-nums">{t.fmt.int(c.kpis.started)}</span>
                  <span className="text-right text-ad-text-2 tabular-nums">{t.fmt.int(c.kpis.reachedResult)}</span>
                  <span className="text-right text-ad-text tabular-nums">{t.fmt.pct(c.kpis.ctrFromStarted, 0)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Extra (non-core) events
// ---------------------------------------------------------------------------

export function ExtraEvents({ events }: { events: AnalyticsResponse['extraEvents'] }) {
  const tween = useTween();
  const t = useT();
  return (
    <Panel title={t.analytics.extraEvents}>
      {events.length === 0 ? (
        <EmptyLine>{t.analytics.noExtraEvents}</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {events.map((e) => {
            const share = e.eligible ? e.sessions / e.eligible : 0;
            return (
              <li key={e.name} className="flex flex-col gap-2 border-t border-ad-row py-3 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[13px] text-ad-text-2">{e.name}</span>
                  <span className="shrink-0 font-mono text-[13px] text-ad-text tabular-nums">
                    {t.fmt.pct(share, 0)}
                    <span className="ml-2 text-[11px] text-ad-faint">
                      {t.analytics.of(t.fmt.int(e.sessions), t.fmt.int(e.eligible))}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ad-sunken" aria-hidden>
                  <motion.div
                    className="h-full rounded-full bg-ad-text-2/55"
                    initial={false}
                    animate={{ width: `${share * 100}%` }}
                    transition={tween}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export function DataQualityStrip({ dq }: { dq: AnalyticsResponse['dataQuality'] }) {
  const t = useT();
  const items: { label: string; value: number; tone: 'blue' | 'red' | 'amber' }[] = [
    { label: t.analytics.dqDuplicates, value: dq.duplicatesDropped, tone: 'blue' },
    { label: t.analytics.dqRejected, value: dq.rejected, tone: 'red' },
    { label: t.analytics.dqOutOfOrder, value: dq.outOfOrderSessions, tone: 'amber' },
    { label: t.analytics.dqUnverified, value: dq.unverifiedResultSessions ?? 0, tone: 'amber' },
  ];
  const dot = { blue: 'bg-variant-a', red: 'bg-bad', amber: 'bg-variant-b' } as const;

  return (
    <Panel
      title={t.analytics.dataQuality}
      aside={
        <Link to="/admin/events" className={clsx('rounded text-ad-muted hover:text-ad-text', focusRing)}>
          {t.analytics.eventLogLink}
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ad-line-2 bg-ad-line-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col gap-2 bg-ad-panel px-4 py-3.5">
            <span className="flex items-center gap-2 text-[12px] text-ad-muted">
              <span
                aria-hidden
                className={clsx('size-[7px] rounded-[2px]', i.value > 0 ? dot[i.tone] : 'bg-ad-ghost')}
              />
              {i.label}
            </span>
            <span
              className={clsx(
                'font-mono text-2xl font-semibold tabular-nums',
                i.value > 0 ? 'text-ad-text' : 'text-ad-faint',
              )}
            >
              {t.fmt.int(i.value)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={clsx('h-2 w-3 rounded-sm', className)} />
      {label}
    </span>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <p className="border-t border-ad-row py-6 text-center text-[13px] text-ad-faint">{children}</p>;
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: n }, (_, i) => (
        <Shimmer key={i} className="h-4" />
      ))}
    </div>
  );
}
