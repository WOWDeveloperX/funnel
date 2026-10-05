/**
 * /admin/sessions — recent sessions with their pinned version/variant and status.
 * Clicking a row opens the event log filtered by that session.
 */
import type { AdminSessionRow, SessionStatus } from '@funnel/shared';
import clsx from 'clsx';
import { ArrowUpRight, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAdminSessions, getVersions } from '../../lib/api';
import { Segmented } from '../components/Segmented';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatusPill,
  TableWrap,
  VariantBadge,
  td,
  th,
  type BadgeTone,
} from '../components/ui';
import { type AdminMessages, useT } from '../i18n';
import { shortId } from '../lib/format';
import { useNow } from '../lib/useNow';
import { usePolling } from '../lib/usePolling';
import { variantClasses } from '../lib/variants';

const POLL_MS = 5000;
const LIMIT = 100;

/** Status label keys of the `sessions` dictionary section. */
type StatusCopy = Extract<keyof AdminMessages['sessions'], `status${string}` | `total${string}`>;

const STATUS: Record<SessionStatus, { label: StatusCopy; total: StatusCopy; tone: BadgeTone }> = {
  in_progress: { label: 'statusInProgress', total: 'totalInProgress', tone: 'info' },
  completed: { label: 'statusCompleted', total: 'totalCompleted', tone: 'success' },
  expired: { label: 'statusExpired', total: 'totalExpired', tone: 'neutral' },
};

const dash = <span className="text-ad-ghost">—</span>;

export default function SessionsPage() {
  const t = useT();
  const copy = t.sessions;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const now = useNow(10_000);

  const versionParam = Number(searchParams.get('version'));
  const version = Number.isInteger(versionParam) && versionParam > 0 ? versionParam : undefined;
  const variant = searchParams.get('variant') || undefined;

  const setFilter = (key: 'version' | 'variant', value: string | number | 'all') => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(key);
    else next.set(key, String(value));
    setSearchParams(next, { replace: true });
  };

  const key = `${version ?? 'all'}|${variant ?? 'all'}`;
  const { data, error, loading, refresh } = usePolling(
    (signal) => getAdminSessions({ limit: LIMIT, version, variant }, signal),
    key,
    POLL_MS,
  );
  // Version options for the filter (cheap, refreshed rarely).
  const versionsQuery = usePolling((signal) => getVersions(undefined, signal), 'versions', 60_000);
  const versionOptions = (versionsQuery.data?.versions ?? []).map((v) => v.version).sort((a, b) => a - b);
  const variantOptions = useMemo(() => {
    const keys = new Set<string>(['A', 'B']);
    for (const v of versionsQuery.data?.versions ?? []) for (const x of v.variants) keys.add(x.key);
    return [...keys].sort();
  }, [versionsQuery.data]);

  const sessions = data?.sessions ?? [];
  const totals = data?.totals;

  const open = (s: AdminSessionRow) => navigate(`/admin/events?sessionId=${encodeURIComponent(s.id)}`);

  return (
    <>
      <PageHeader title={t.nav.sessions}>
        <Segmented<number | 'all'>
          label={t.common.version}
          value={version ?? 'all'}
          onChange={(v) => setFilter('version', v)}
          options={[
            { value: 'all', label: t.common.all },
            ...versionOptions.map((v) => ({ value: v, label: `v${v}` })),
          ]}
        />
        <Segmented<string>
          label={t.common.variant}
          value={variant ?? 'all'}
          onChange={(v) => setFilter('variant', v)}
          options={[
            { value: 'all', label: variantOptions.join('+') },
            ...variantOptions.map((v) => ({ value: v, label: v, className: variantClasses(v).text })),
          ]}
        />
        {totals && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-ad-muted">
              {copy.total} <span className="font-semibold text-ad-text tabular-nums">{t.fmt.int(totals.all)}</span>
            </span>
            {(Object.keys(STATUS) as SessionStatus[]).map((s) => (
              <StatusPill key={s} tone={STATUS[s].tone}>
                {copy[STATUS[s].total]} <span className="tabular-nums">{t.fmt.int(totals[s])}</span>
              </StatusPill>
            ))}
          </div>
        )}
      </PageHeader>

      {error != null && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={refresh} />
        </div>
      )}

      <section className="min-w-0 overflow-hidden rounded-[18px] border border-ad-line-2 bg-ad-panel">
        {loading ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <EmptyState icon={<Users className="size-5" aria-hidden />} title={copy.empty} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[60rem]">
              <thead className="border-b border-ad-line">
                <tr>
                  <th className={clsx(th, 'pl-5')}>{copy.colSession}</th>
                  <th className={th}>{copy.colVersion}</th>
                  <th className={th}>{copy.colVariant}</th>
                  <th className={th}>{copy.colCampaign}</th>
                  <th className={th}>{copy.colStep}</th>
                  <th className={th}>{copy.colResult}</th>
                  <th className={th}>{copy.colStatus}</th>
                  <th className={clsx(th, 'text-right')}>{copy.colEvents}</th>
                  <th className={clsx(th, 'pr-5 text-right')}>{copy.colUpdated}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => open(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open(s);
                      }
                    }}
                    tabIndex={0}
                    aria-label={copy.rowAria(shortId(s.id))}
                    className="group cursor-pointer border-t border-ad-line first:border-t-0 transition-colors hover:bg-ad-chip/40 focus-visible:bg-ad-chip/40"
                  >
                    <td className={clsx(td, 'pl-5')}>
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-ad-text" title={s.id}>
                        {shortId(s.id)}
                        <ArrowUpRight className="size-3 text-ad-ghost group-hover:text-ad-text-2" aria-hidden />
                      </span>
                    </td>
                    <td className={clsx(td, 'font-mono text-xs')}>v{s.funnelVersion}</td>
                    <td className={td}>
                      <VariantBadge variant={s.variant} source={s.variantSource} />
                    </td>
                    <td className={clsx(td, 'font-mono text-xs')}>{s.utmCampaign ?? dash}</td>
                    <td className={clsx(td, 'font-mono text-xs')}>{s.currentStepId ?? dash}</td>
                    <td className={clsx(td, 'font-mono text-xs')}>{s.resultId ?? dash}</td>
                    <td className={td}>
                      <StatusPill tone={STATUS[s.status]?.tone ?? 'neutral'}>
                        {STATUS[s.status] ? copy[STATUS[s.status].label] : s.status}
                      </StatusPill>
                    </td>
                    <td className={clsx(td, 'text-right font-mono text-xs tabular-nums')}>{t.fmt.int(s.eventCount)}</td>
                    <td
                      className={clsx(td, 'pr-5 text-right font-mono text-xs text-ad-muted')}
                      title={t.fmt.full(s.updatedAt)}
                    >
                      {t.fmt.relative(s.updatedAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
