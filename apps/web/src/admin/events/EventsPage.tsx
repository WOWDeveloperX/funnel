/**
 * /admin/events — live ingest log (poll 2s): every delivery as a row (accepted, duplicate,
 * rejected) plus all-time counters. ?sessionId= & ?name= filter the log.
 */
import { CORE_EVENTS, RECOMMENDATION_EXPANDED, type IngestTotals } from '@funnel/shared';
import clsx from 'clsx';
import { ChevronDown, Search, X } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, getAdminEvents } from '../../lib/api';
import { focusRing, GhostButton, Notice, Shimmer } from '../analytics/kit';
import { CountUp } from '../components/CountUp';
import { BLEED } from '../components/ui';
import { type AdminI18n, useT } from '../i18n';
import { usePolling } from '../lib/usePolling';
import { EventRows, EventsHeader } from './EventsTable';
import { NewRowTracker } from './newRowTracker';

const POLL_MS = 2000;
const LIMIT = 100;

export default function EventsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId')?.trim() ?? '';
  const name = searchParams.get('name')?.trim() ?? '';
  const [paused, setPaused] = useState(false);

  const setParam = (key: 'sessionId' | 'name', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set(key, value.trim());
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const key = `${sessionId}|${name}`;
  // Rows that arrive after the first response for a filter are highlighted as new.
  const [tracker] = useState(() => new NewRowTracker());
  const { data, dataKey, error, loading, refresh } = usePolling(
    (signal) =>
      getAdminEvents({ limit: LIMIT, sessionId: sessionId || undefined, name: name || undefined }, signal).then(
        (res) => {
          tracker.observe(
            key,
            res.feed.map((r) => r.key),
          );
          return res;
        },
      ),
    key,
    paused ? null : POLL_MS,
  );

  const current = dataKey === key ? data : undefined;
  const rows = current?.feed ?? [];

  const nameOptions = useMemo(() => {
    const set = new Set<string>([...CORE_EVENTS, RECOMMENDATION_EXPANDED]);
    for (const e of data?.events ?? []) set.add(e.name);
    if (name) set.add(name);
    return [...set];
  }, [data, name]);

  const filtered = !!sessionId || !!name;
  const pending = loading || (dataKey !== key && error == null);

  return (
    <div className={`${BLEED} flex min-h-full flex-col bg-ad-bg text-ad-text`}>
      {/* Top bar */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3.5 border-b border-ad-line bg-ad-top/95 px-4 py-4 backdrop-blur sm:px-7">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{t.nav.events}</h1>
        <LivePill paused={paused} onToggle={() => setPaused((p) => !p)} />
        <span className="flex-1" />
        <NameSelect value={name} options={nameOptions} onChange={(v) => setParam('name', v)} />
        <SessionFilter value={sessionId} onCommit={(v) => setParam('sessionId', v)} />
      </div>

      {/* Counters */}
      <Counters totals={data?.totals} />

      {error != null && <ErrorBanner error={error} onRetry={refresh} />}

      {/* Log */}
      <div className="relative flex min-h-[420px] flex-1 flex-col">
        <div className="overflow-x-auto" role="table" aria-label={t.events.logAria}>
          <div className="min-w-[1060px]">
            <EventsHeader />
            <div className="relative" role="rowgroup">
              {pending ? (
                <SkeletonRows />
              ) : rows.length > 0 ? (
                <>
                  <EventRows
                    rows={rows}
                    isNew={(id) => tracker.isNew(key, id)}
                    activeSessionId={sessionId}
                    onSessionClick={(id) => setParam('sessionId', id === sessionId ? '' : id)}
                  />
                  {!paused && <ScanLine />}
                </>
              ) : null}
            </div>
          </div>
        </div>

        {!pending && rows.length === 0 && error == null && (
          <div className="relative flex flex-1 flex-col">
            <div
              aria-hidden
              className="absolute inset-0 bg-[repeating-linear-gradient(180deg,transparent_0_43px,var(--color-ad-sunken)_43px_44px)]"
            />
            {!paused && <ScanLine />}
            {filtered ? (
              <Notice title={t.events.emptyFiltered} className="relative flex-1">
                <GhostButton onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="mt-3">
                  {t.events.resetFilter}
                </GhostButton>
              </Notice>
            ) : (
              <Waiting />
            )}
          </div>
        )}

        <Legend />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function LivePill({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!paused}
      aria-label={paused ? t.events.resume : t.events.pause}
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] transition-colors',
        paused
          ? 'border-ad-line-3 bg-ad-chip text-ad-muted hover:text-ad-text'
          : 'border-ok-line bg-ok-bg text-ok-ink hover:border-ok/60',
        focusRing,
      )}
    >
      <span aria-hidden className={clsx('relative size-1.5 rounded-full', paused ? 'bg-ad-faint' : 'bg-ok')}>
        {!paused && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-ok" />}
      </span>
      {paused ? t.events.paused : t.events.live(POLL_MS / 1000)}
    </button>
  );
}

function NameSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="relative inline-flex shrink-0 items-center">
      <span className="sr-only">{t.events.eventLabel}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'h-9 appearance-none rounded-[10px] border bg-ad-bg pr-8 pl-3 font-mono text-[13px] font-medium transition-colors',
          value ? 'border-signal/45 text-signal-ink' : 'border-ad-line-3 text-ad-muted hover:border-ad-muted',
          focusRing,
        )}
      >
        <option value="">{t.events.allEvents}</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 size-3.5 text-ad-faint" />
    </label>
  );
}

/** session_id filter: commits on Enter, blur, or after a short typing pause. */
function SessionFilter({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);

  // External changes (clicking a session id, resetting) win over the draft.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value);
  }

  const commitLatest = useEffectEvent((next: string) => onCommit(next));
  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => commitLatest(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div
      className={clsx(
        'flex h-9 w-full items-center gap-2.5 rounded-[10px] border bg-ad-bg px-3 transition-colors sm:w-[300px]',
        value ? 'border-signal/45' : 'border-ad-line-3 focus-within:border-ad-muted',
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0 text-ad-faint" />
      <input
        aria-label={t.events.sessionFilterAria}
        value={draft}
        placeholder={t.events.sessionFilterPlaceholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onCommit(draft)}
        onBlur={() => draft.trim() !== value && onCommit(draft)}
        className="min-w-0 flex-1 bg-transparent font-mono text-[13px] font-medium text-ad-text outline-none placeholder:text-ad-faint"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onCommit('');
          }}
          aria-label={t.events.clearFilter}
          className={clsx('rounded p-0.5 text-ad-faint hover:text-ad-text', focusRing)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

const COUNTERS: {
  key: keyof IngestTotals;
  title: keyof AdminI18n['events'] & `${string}Title`;
  sub: keyof AdminI18n['events'] & `${string}Sub`;
  fg: string;
  dot: string;
  glow: string;
}[] = [
  {
    key: 'accepted',
    title: 'acceptedTitle',
    sub: 'acceptedSub',
    fg: 'text-ok-ink',
    dot: 'bg-ok',
    glow: 'rgb(61 214 140 / 0.08)',
  },
  {
    key: 'duplicates',
    title: 'duplicatesTitle',
    sub: 'duplicatesSub',
    fg: 'text-variant-a-ink',
    dot: 'bg-variant-a',
    glow: 'rgb(47 155 255 / 0.08)',
  },
  {
    key: 'rejected',
    title: 'rejectedTitle',
    sub: 'rejectedSub',
    fg: 'text-bad-ink',
    dot: 'bg-bad',
    glow: 'rgb(255 90 95 / 0.08)',
  },
];

/**
 * Large mono counters: digit groups separated by a small margin instead of a space character
 * (in a monospace font any space is a full digit wide and reads as a double gap).
 */
function groupedInt(n: number, fmtInt: (n: number) => string): ReactNode {
  return fmtInt(n)
    .split(/[\s\u00a0\u202f]/)
    .map((group, i) => (
      <span key={i} className={i > 0 ? 'ml-[0.2em]' : undefined}>
        {group}
      </span>
    ));
}

function Counters({ totals }: { totals: IngestTotals | undefined }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-px border-b border-ad-line bg-ad-line sm:grid-cols-3">
      {COUNTERS.map((c) => (
        <div
          key={c.key}
          className="relative flex items-end justify-between gap-3 overflow-hidden bg-ad-bg px-4 py-5 sm:px-7"
          style={{ backgroundImage: `radial-gradient(80% 140% at 0% 0%, ${c.glow}, transparent 60%)` }}
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            <span
              className={clsx('flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.16em]', c.fg)}
            >
              <span aria-hidden className={clsx('size-[7px] rounded-[2px]', c.dot)} />
              {t.events[c.title]}
            </span>
            <span className="font-mono text-[48px] leading-none font-semibold tracking-[-0.03em] text-ad-text">
              {totals ? (
                <CountUp value={totals[c.key]} format={(n) => groupedInt(n, t.fmt.int)} />
              ) : (
                <span className="text-ad-ghost">—</span>
              )}
            </span>
          </div>
          <span className="max-w-[150px] text-right text-xs text-ad-faint">{t.events[c.sub]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ScanLine() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-20 animate-scan bg-linear-to-b from-transparent via-signal/[0.04] to-transparent motion-reduce:hidden"
    />
  );
}

function Waiting() {
  const t = useT();
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-[18px] px-4 py-16 text-center">
      <div aria-hidden className="relative size-14">
        <span className="absolute inset-0 animate-pulse-ring rounded-full border-[1.5px] border-signal motion-reduce:hidden" />
        <span className="absolute inset-0 animate-pulse-ring rounded-full [animation-delay:1s] border-[1.5px] border-signal motion-reduce:hidden" />
        <span className="absolute inset-[18px] rounded-full bg-signal shadow-[0_0_24px_var(--color-signal)]" />
      </div>
      <p className="font-display text-[22px] font-bold tracking-[-0.02em]">{t.events.waitingTitle}</p>
      <p className="max-w-[440px] text-sm leading-normal text-ad-muted">{t.events.waitingText}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-11 items-center border-b border-ad-sunken px-4 sm:px-7">
          <Shimmer className="h-3" />
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const t = useT();
  const items = [
    { label: t.events.legendNew, cls: 'bg-signal/15 border-l-signal' },
    { label: t.events.legendDuplicate, cls: 'bg-variant-a/10 border-l-variant-a' },
    { label: t.events.legendRejected, cls: 'bg-bad/10 border-l-bad' },
  ];
  return (
    <div className="mt-auto flex flex-wrap gap-x-[18px] gap-y-2 border-t border-ad-line px-4 py-3.5 font-mono text-[11px] font-medium text-ad-faint sm:px-7">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={clsx('h-2.5 w-3.5 rounded-[3px] border-l-2', i.cls)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function ErrorBanner({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const text =
    error instanceof ApiError && error.status === 401
      ? t.events.noAccess
      : error instanceof ApiError && error.status === 0
        ? t.common.offline
        : t.events.refreshFailed;
  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-bad-line bg-bad-bg px-4 py-3 text-[13px] text-bad-ink sm:mx-7"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-bad" />
      <span className="flex-1">{text}</span>
      <GhostButton onClick={onRetry} className="h-8 border-bad-line text-bad-ink hover:text-ad-text">
        {t.common.retry}
      </GhostButton>
    </div>
  );
}
