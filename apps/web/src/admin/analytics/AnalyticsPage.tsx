/**
 * /admin/analytics — session-based funnel dashboard. Filters live in the URL;
 * the data refreshes every 10s.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, getAnalytics } from '../../lib/api';
import { BLEED } from '../components/ui';
import { useT } from '../i18n';
import { useContentText } from '../lib/contentText';
import { usePolling } from '../lib/usePolling';
import { AbPanel } from './AbPanel';
import { DataQualityStrip, ExtraEvents, ResultsCard, UtmCard, VersionsCard } from './Breakdowns';
import {
  DEFAULT_FILTERS,
  filtersKey,
  isDefaultFilters,
  readFilters,
  toQuery,
  writeFilters,
  type Filters,
} from './filters';
import { FilterBar } from './FilterBar';
import { GhostButton, Notice } from './kit';
import { KpiCards } from './KpiCards';
import { StepComparisonChart } from './StepComparisonChart';
import { StepFunnel } from './StepFunnel';

const REFRESH_MS = 10_000;

export default function AnalyticsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const key = filtersKey(filters);

  const setFilters = useCallback(
    (next: Filters) => setSearchParams(writeFilters(next), { replace: true }),
    [setSearchParams],
  );

  const { data, error, fetching, refresh } = usePolling(
    (signal) => getAnalytics(toQuery(filters), signal),
    key,
    REFRESH_MS,
  );

  // Result and step titles are config content: shown in the UI language through the funnel's catalogs.
  const contentText = useContentText(data?.filters.funnelId);

  const toggleCampaign = (c: string) =>
    setFilters({
      ...filters,
      campaigns: filters.campaigns.includes(c) ? filters.campaigns.filter((x) => x !== c) : [...filters.campaigns, c],
    });

  // Zero sessions without filters = no traffic yet; with filters = the cohort is just empty.
  const noTraffic = !!data && data.kpis.started === 0 && isDefaultFilters(filters);
  const emptyCohort = !!data && data.kpis.started === 0 && !noTraffic;

  return (
    <div className={`${BLEED} flex min-h-full flex-col bg-ad-bg text-ad-text`}>
      <FilterBar filters={filters} onChange={setFilters} available={data?.available} fetching={fetching} />

      <div className="flex flex-col gap-[18px] px-4 pt-[22px] pb-7 sm:px-7">
        {error != null && <ErrorBanner error={error} onRetry={refresh} hasData={!!data} />}

        {noTraffic ? (
          <section className="rounded-[18px] border border-ad-line-2 bg-ad-panel">
            <Notice title={t.analytics.noSessionsTitle} className="py-16">
              <p>{t.analytics.noSessionsText}</p>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex h-9 items-center rounded-[10px] border border-ad-line-3 px-3.5 text-[13px] font-medium text-ad-text-2 hover:border-ad-muted hover:text-ad-text"
              >
                {t.analytics.openFunnel}
              </a>
            </Notice>
          </section>
        ) : emptyCohort ? (
          <section className="rounded-[18px] border border-ad-line-2 bg-ad-panel">
            <Notice title={t.analytics.emptyCohort} className="py-16">
              <GhostButton onClick={() => setFilters(DEFAULT_FILTERS)} className="mt-3">
                {t.analytics.resetFilters}
              </GhostButton>
            </Notice>
          </section>
        ) : (
          <>
            <KpiCards kpis={data?.kpis} variants={data?.variants ?? []} />

            <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <StepFunnel steps={data?.steps} variant={filters.variant} contentText={contentText} />
              <AbPanel ab={data ? data.abTest : undefined} variants={data?.variants ?? []} />
            </div>

            <div className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-3">
              <VersionsCard
                versions={data?.versions}
                selected={filters.version}
                onSelect={(version) => setFilters({ ...filters, version })}
              />
              <ResultsCard results={data?.results} contentText={contentText} />
              <UtmCard campaigns={data?.campaigns} selected={filters.campaigns} onToggle={toggleCampaign} />
            </div>

            {data && (
              <>
                <StepComparisonChart variants={data.variants} order={data.steps} />
                <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <ExtraEvents events={data.extraEvents} />
                  <DataQualityStrip dq={data.dataQuality} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ error, onRetry, hasData }: { error: unknown; onRetry: () => void; hasData: boolean }) {
  const t = useT();
  const offline = error instanceof ApiError && error.status === 0;
  const text = offline ? t.common.offline : hasData ? t.analytics.refreshFailed : t.analytics.loadFailed;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-[14px] border border-bad-line bg-bad-bg px-4 py-3 text-[13px] text-bad-ink"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-bad" />
      <span className="flex-1">{hasData ? `${text} ${t.analytics.staleData}` : text}</span>
      <GhostButton onClick={onRetry} className="h-8 border-bad-line text-bad-ink hover:text-ad-text">
        {t.common.retry}
      </GhostButton>
    </div>
  );
}
