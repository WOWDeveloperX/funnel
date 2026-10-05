/**
 * Analytics (GET /api/admin/analytics).
 *
 * Unit of measurement = unique session. Everything is derived per session first, using the
 * session's OWN pinned (version, variant) stepSequence, and only then aggregated. Event order,
 * timestamps, repeated views and duplicates therefore never change a session's facts:
 *
 * - viewed(S)      ⇔ any step_viewed | answer_submitted | step_completed | back_clicked on S,
 *                    or S is unconditional (no visibleWhen) and the session provably got past it
 *                    (maxPos > pos(S)) — a lost step_viewed must not look like a skip or drop-off.
 *                    result_viewed / cta_clicked ⇒ the result step is viewed — but only for a
 *                    session with a server-computed result (sessions.result_id): the real client
 *                    emits them after POST /result, so result events without one are unverified
 *                    client claims, ignored for reach and reported in dataQuality.
 * - maxPos         = max position with evidence; step_completed(S) ⇒ pos(S) + 0.5;
 *                    result_viewed / cta_clicked ⇒ pos(result step).
 * - progressed(S)  ⇔ viewed(S) and (step_completed(S) or maxPos > pos(S)). The terminal result
 *                    step has nothing after it, so "progressed" there means the CTA was clicked.
 * - arrived(S)     ⇔ maxPos >= pos(S) or viewed(S)   (shownRate = viewed / arrived).
 * - eligible(S)    = sessions whose own sequence contains S; fromStart = viewed / eligible, so a
 *                    step that only some versions/variants have is not diluted by the others.
 * - abTest         = ONE experiment (a single version) on randomized sessions only (no overrides).
 * - timeToResult   = for a session that reached the result: earliest result_viewed client_ts minus
 *                    the earliest client_ts of its other events (the server-side session_started has
 *                    none and is skipped; with no such event, sessions.created_at), clamped at 0
 *                    (client clock skew). Kpis.medianTimeToResultSec is the median over the scope.
 *
 * Data volume is small (thousands of sessions), so the cohort is loaded with two queries and
 * aggregated in memory in O(events + sessions × steps).
 */
import {
  NONE_CAMPAIGN,
  variantKeys,
  type AbTestResult,
  type AnalyticsFilters,
  type AnalyticsResponse,
  type Kpis,
  type StepMetrics,
  type VariantAnalytics,
} from '@funnel/shared';
import { type DB, statements } from '../../db';
import { getActiveVersion } from '../versions';
import {
  CORE_EVENT_SET,
  type ConfigCatalog,
  type EventRow,
  type PairInfo,
  type SessionAccumulator,
  type SessionFacts,
  type SessionRow,
  accumulate,
  campaignLabel,
  deriveFacts,
  loadCatalog,
  mergeStepOrder,
  newAccumulator,
} from './derive';
import { median, ratio, twoProportionZTest } from './stats';

// `? = 0 OR …` keeps one static statement for both values of excludeOverride (bound as 0/1).
const stmts = statements((db: DB) => ({
  sessions: db.prepare<[string, number], SessionRow>(
    `SELECT id, funnel_version, variant, variant_source, utm_campaign, result_id, created_at
       FROM sessions
      WHERE funnel_id = ? AND (? = 0 OR variant_source <> 'override')`,
  ),
  events: db.prepare<[string, number], EventRow>(
    `SELECT e.session_id, e.name, e.step_id, e.client_ts, e.properties_json
       FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE s.funnel_id = ? AND (? = 0 OR s.variant_source <> 'override')`,
  ),
  duplicatesDropped: db.prepare<[], { dup: number }>('SELECT COALESCE(SUM(duplicates), 0) AS dup FROM ingest_batches'),
  rejected: db.prepare<[], { rej: number }>('SELECT COUNT(*) AS rej FROM rejected_events'),
  filterValues: db.prepare<[string], { v: number; variant: string; c: string | null }>(
    'SELECT DISTINCT funnel_version AS v, variant, utm_campaign AS c FROM sessions WHERE funnel_id = ?',
  ),
}));

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function kpisFor(sessions: readonly SessionFacts[]): Kpis {
  let reachedResult = 0;
  let ctaClicked = 0;
  let back = 0;
  const times: number[] = [];
  for (const s of sessions) {
    if (s.reachedResult) reachedResult++;
    if (s.ctaClicked) ctaClicked++;
    if (s.backAny) back++;
    if (s.timeToResultSec !== null) times.push(s.timeToResultSec);
  }
  const started = sessions.length;
  return {
    started,
    reachedResult,
    ctaClicked,
    completionRate: ratio(reachedResult, started),
    ctrFromStarted: ratio(ctaClicked, started),
    ctrFromResult: ratio(ctaClicked, reachedResult),
    backRate: ratio(back, started),
    medianTimeToResultSec: median(times),
  };
}

/** (version, variant) pairs configured for the given versions, used when a group has no sessions. */
function configuredPairs(catalog: ConfigCatalog, versions: readonly number[], variant: string | 'all'): PairInfo[] {
  const out: PairInfo[] = [];
  for (const v of versions) {
    const config = catalog.configs.get(v);
    if (!config) continue;
    for (const key of variantKeys(config)) {
      if (variant !== 'all' && key !== variant) continue;
      const p = catalog.getPair(v, key);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Base-config step metadata (type, title, conditional), preferring the newest version given. */
function stepMeta(catalog: ConfigCatalog, stepId: string, versions: readonly number[]) {
  const ordered = [...new Set(versions)].sort((a, b) => b - a);
  for (const v of [...ordered, ...[...catalog.configs.keys()].sort((a, b) => b - a)]) {
    const step = catalog.configs.get(v)?.steps[stepId];
    if (step) {
      const content = step.content as { title?: unknown } | undefined;
      const title = typeof content?.title === 'string' ? content.title : step.type === 'result' ? 'Result' : stepId;
      return { type: String(step.type), title, conditional: step.visibleWhen !== undefined };
    }
  }
  return { type: 'unknown', title: stepId, conditional: false };
}

/** "A" / "v3" / "v3 A" when only some (version, variant) pairs of the cohort contain the step. */
function onlyIn(pairs: readonly PairInfo[], stepId: string): string | null {
  const having = pairs.filter((p) => p.position.has(stepId));
  if (having.length === pairs.length) return null;
  const versionsInPairs = new Set(pairs.map((p) => p.version));
  const parts: string[] = [];
  for (const v of [...versionsInPairs].sort((a, b) => a - b)) {
    const ofVersion = pairs.filter((p) => p.version === v);
    const withStep = having.filter((p) => p.version === v).map((p) => p.variant);
    if (withStep.length === 0) continue;
    const variantsPart = withStep.length === ofVersion.length ? '' : withStep.join('/');
    parts.push(versionsInPairs.size === 1 ? variantsPart : [`v${v}`, variantsPart].filter(Boolean).join(' '));
  }
  return parts.filter(Boolean).join(', ') || null;
}

interface StepCounts {
  arrived: number;
  viewed: number;
  progressed: number;
  back: number;
  views: number;
}

/** Step funnel of a group of sessions; `fallbackPairs` supplies the steps when the group is empty. */
function stepsFor(
  catalog: ConfigCatalog,
  sessions: readonly SessionFacts[],
  fallbackPairs: () => PairInfo[],
): StepMetrics[] {
  const pairKeys = new Set<string>();
  for (const s of sessions) if (s.pairKey) pairKeys.add(s.pairKey);
  let pairs = [...pairKeys].map((k) => catalog.pairs.get(k) as PairInfo);
  if (pairs.length === 0) pairs = fallbackPairs();
  pairs.sort((a, b) => a.version - b.version || a.variant.localeCompare(b.variant));
  const order = mergeStepOrder(pairs.map((p) => p.sequence));

  const counts = new Map<string, StepCounts>(
    order.map((id) => [id, { arrived: 0, viewed: 0, progressed: 0, back: 0, views: 0 }]),
  );
  for (const s of sessions) {
    for (const [stepId, f] of s.steps) {
      const c = counts.get(stepId);
      if (!c) continue;
      if (f.arrived) c.arrived++;
      if (f.viewed) c.viewed++;
      if (f.progressed) c.progressed++;
      if (f.back) c.back++;
      c.views += f.views;
    }
  }
  const sessionsPerPair = new Map<string, number>();
  for (const s of sessions) if (s.pairKey) sessionsPerPair.set(s.pairKey, (sessionsPerPair.get(s.pairKey) ?? 0) + 1);

  return order.map((stepId) => {
    const c = counts.get(stepId) as StepCounts;
    const pairsWithStep = pairs.filter((p) => p.position.has(stepId));
    const meta = stepMeta(
      catalog,
      stepId,
      pairsWithStep.map((p) => p.version),
    );
    const eligible = pairsWithStep.reduce((n, p) => n + (sessionsPerPair.get(p.key) ?? 0), 0);
    const dropOff = c.viewed - c.progressed;
    return {
      stepId,
      type: meta.type,
      title: meta.title,
      conditional: meta.conditional,
      arrived: c.arrived,
      viewed: c.viewed,
      progressed: c.progressed,
      dropOff,
      dropOffRate: ratio(dropOff, c.viewed),
      conversion: ratio(c.progressed, c.viewed),
      eligible,
      fromStart: ratio(c.viewed, eligible),
      onlyIn: onlyIn(pairs, stepId),
      shownRate: ratio(c.viewed, c.arrived),
      backFrom: c.back,
      avgViewsPerSession: ratio(c.views, c.viewed),
    };
  });
}

/**
 * A/B test on ctrFromStarted: ONE experiment, randomized traffic only.
 * Each funnel version carries its own experiment (v1 and v3 test different treatments), so pooling
 * versions would mix two experiments. The test runs on a single version — the version filter, else
 * the active version when it has sessions in the cohort, else the newest version with sessions —
 * and always leaves out override sessions (a forced variant is not a random assignment).
 * Campaign filter applies; the variant filter does not (both arms are needed), so `pool` is the
 * cohort ignoring the variant filter.
 */
function abTestFor(
  catalog: ConfigCatalog,
  pool: readonly SessionFacts[],
  versionFilter: number | 'all',
  activeVersion: number | null,
): AbTestResult | null {
  const poolVersions = [...new Set(pool.map((s) => s.version))].sort((a, b) => a - b);
  const abVersion: number | null =
    versionFilter !== 'all'
      ? versionFilter
      : activeVersion !== null && poolVersions.includes(activeVersion)
        ? activeVersion
        : (poolVersions[poolVersions.length - 1] ?? activeVersion);
  if (abVersion === null) return null;

  const abConfig = catalog.configs.get(abVersion);
  const ofVersion = pool.filter((s) => s.version === abVersion);
  const randomized = ofVersion.filter((s) => !s.override);
  const arms = abConfig ? variantKeys(abConfig) : [...new Set(ofVersion.map((s) => s.variant))].sort();
  const [armA, armB] = arms;
  if (armA === undefined || armB === undefined) return null;

  const ka = kpisFor(randomized.filter((s) => s.variant === armA));
  const kb = kpisFor(randomized.filter((s) => s.variant === armB));
  const { z, pValue } = twoProportionZTest(ka.ctaClicked, ka.started, kb.ctaClicked, kb.started);
  return {
    metric: 'ctrFromStarted',
    version: abVersion,
    experimentId: abConfig?.experiment.id ?? null,
    overrideExcluded: ofVersion.length - randomized.length,
    otherVersions: poolVersions.filter((v) => v !== abVersion),
    a: { variant: armA, rate: ka.ctrFromStarted, n: ka.started, kpis: ka },
    b: { variant: armB, rate: kb.ctrFromStarted, n: kb.started, kpis: kb },
    diffPp: (kb.ctrFromStarted - ka.ctrFromStarted) * 100,
    z,
    pValue,
    significant: pValue !== null && pValue < 0.05,
    enoughData: ka.started >= 30 && kb.started >= 30,
  };
}

/** Result distribution over the cohort sessions that reached the result. */
function resultsFor(catalog: ConfigCatalog, cohort: readonly SessionFacts[]): AnalyticsResponse['results'] {
  const cohortVersions = [...new Set(cohort.map((s) => s.version))];
  const resultAgg = new Map<string, { sessions: number; cta: number }>();
  for (const s of cohort) {
    if (!s.reachedResult) continue;
    const id = s.resultId ?? '(unknown)';
    const r = resultAgg.get(id) ?? { sessions: 0, cta: 0 };
    r.sessions++;
    if (s.ctaClicked) r.cta++;
    resultAgg.set(id, r);
  }
  // Titles come from the newest cohort version that defines the result, then from any stored version.
  const titleVersions = [...cohortVersions.sort((a, b) => b - a), ...[...catalog.configs.keys()].sort((a, b) => b - a)];
  const resultTitle = (id: string): string => {
    for (const v of titleVersions) {
      const title = catalog.configs.get(v)?.results[id]?.title;
      if (title) return title;
    }
    return id;
  };
  return [...resultAgg.entries()]
    .map(([resultId, r]) => ({
      resultId,
      title: resultTitle(resultId),
      sessions: r.sessions,
      ctaClicked: r.cta,
      ctr: ratio(r.cta, r.sessions),
    }))
    .sort((a, b) => b.sessions - a.sessions || a.resultId.localeCompare(b.resultId));
}

/**
 * Extra (non-core) events: the allowed ones of the versions in scope are listed even with 0 sessions.
 * `eligible` = cohort sessions whose pinned version allows the event (v1 rejects
 * recommendation_expanded, so v1 sessions must not dilute its share).
 */
function extraEventsFor(
  catalog: ConfigCatalog,
  cohort: readonly SessionFacts[],
  versionsInScope: readonly number[],
): AnalyticsResponse['extraEvents'] {
  const extra = new Map<string, number>();
  for (const v of versionsInScope) {
    for (const def of catalog.configs.get(v)?.events.allowed ?? []) {
      if (!CORE_EVENT_SET.has(def.name)) extra.set(def.name, 0);
    }
  }
  for (const s of cohort) for (const name of s.extraEvents) extra.set(name, (extra.get(name) ?? 0) + 1);
  const allowedByVersion = new Map<number, Set<string>>();
  for (const [v, config] of catalog.configs) allowedByVersion.set(v, new Set(config.events.allowed.map((e) => e.name)));
  return [...extra.entries()]
    .map(([name, sessions]) => ({
      name,
      sessions,
      eligible: Math.max(
        sessions,
        cohort.reduce((n, s) => n + (allowedByVersion.get(s.version)?.has(name) ? 1 : 0), 0),
      ),
    }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/** Filter values offered by the dashboard (every filter except the funnel is ignored). */
function availableFilters(db: DB, catalog: ConfigCatalog, funnelId: string): AnalyticsResponse['available'] {
  const availVersions = new Set<number>(catalog.configs.keys());
  const availVariants = new Set<string>();
  const availCampaigns = new Set<string>();
  for (const config of catalog.configs.values()) for (const k of variantKeys(config)) availVariants.add(k);
  for (const r of stmts(db).filterValues.all(funnelId)) {
    availVersions.add(r.v);
    availVariants.add(r.variant);
    availCampaigns.add(campaignLabel(r.c));
  }
  const hasNone = availCampaigns.delete(NONE_CAMPAIGN);
  return {
    versions: [...availVersions].sort((a, b) => a - b),
    variants: [...availVariants].sort(),
    campaigns: [...[...availCampaigns].sort(), ...(hasNone ? [NONE_CAMPAIGN] : [])],
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Computes the full AnalyticsResponse for the given filters. Filters apply to the sessions row;
 * `variants` ignores the variant filter, `versions` the version filter, `campaigns` the campaign
 * filter. `excludeOverride` applies everywhere.
 */
export function computeAnalytics(db: DB, filters: AnalyticsFilters, now: Date = new Date()): AnalyticsResponse {
  const { funnelId } = filters;
  const catalog = loadCatalog(db, funnelId);
  const s = stmts(db);
  const excludeOverride = filters.excludeOverride ? 1 : 0;

  // --- load sessions + events (two queries) ---------------------------------
  const sessionRows = s.sessions.all(funnelId, excludeOverride);
  const accs = new Map<string, SessionAccumulator>();
  for (const row of sessionRows) accs.set(row.id, newAccumulator());
  for (const ev of s.events.iterate(funnelId, excludeOverride)) {
    const acc = accs.get(ev.session_id);
    if (acc) accumulate(acc, ev);
  }

  const all: SessionFacts[] = sessionRows.map((row) =>
    deriveFacts(row, accs.get(row.id) as SessionAccumulator, catalog.getPair(row.funnel_version, row.variant)),
  );

  // --- filters ----------------------------------------------------------------
  const campaignSet = new Set(filters.campaigns);
  const versionOk = (x: SessionFacts) => filters.version === 'all' || x.version === filters.version;
  const variantOk = (x: SessionFacts) => filters.variant === 'all' || x.variant === filters.variant;
  const campaignOk = (x: SessionFacts) => campaignSet.size === 0 || campaignSet.has(x.campaign);

  const cohort = all.filter((x) => versionOk(x) && variantOk(x) && campaignOk(x));
  const ignoringVariant = all.filter((x) => versionOk(x) && campaignOk(x));
  const ignoringVersion = all.filter((x) => variantOk(x) && campaignOk(x));
  const ignoringCampaign = all.filter((x) => versionOk(x) && variantOk(x));

  const versionsInScope = [...catalog.configs.keys()].filter((v) => filters.version === 'all' || v === filters.version);

  // --- main block ----------------------------------------------------------------
  const kpis = kpisFor(cohort);
  const steps = stepsFor(catalog, cohort, () => configuredPairs(catalog, versionsInScope, filters.variant));

  // --- variants (ignores the variant filter) -------------------------------------
  const variantNames = new Set<string>();
  for (const p of configuredPairs(catalog, versionsInScope, 'all')) variantNames.add(p.variant);
  for (const x of ignoringVariant) variantNames.add(x.variant);
  const variants: VariantAnalytics[] = [...variantNames].sort().map((variant) => {
    const group = ignoringVariant.filter((x) => x.variant === variant);
    return {
      variant,
      kpis: kpisFor(group),
      steps: stepsFor(catalog, group, () => configuredPairs(catalog, versionsInScope, variant)),
    };
  });

  // --- A/B test --------------------------------------------------------------------
  const abTest = abTestFor(catalog, ignoringVariant, filters.version, getActiveVersion(db, funnelId));

  // --- versions (ignores the version filter) -------------------------------------
  const versionNums = new Set<number>(catalog.configs.keys());
  for (const x of ignoringVersion) versionNums.add(x.version);
  const versions = [...versionNums]
    .sort((a, b) => a - b)
    .map((version) => ({ version, kpis: kpisFor(ignoringVersion.filter((x) => x.version === version)) }));

  // --- campaigns (ignores the campaign filter) -----------------------------------
  const byCampaign = new Map<string, SessionFacts[]>();
  for (const x of ignoringCampaign) {
    const list = byCampaign.get(x.campaign) ?? [];
    list.push(x);
    byCampaign.set(x.campaign, list);
  }
  const campaigns = [...byCampaign.entries()]
    .map(([campaign, group]) => ({ campaign, kpis: kpisFor(group) }))
    .sort((a, b) => b.kpis.started - a.kpis.started || a.campaign.localeCompare(b.campaign));

  // --- data quality ----------------------------------------------------------------
  const duplicatesDropped = s.duplicatesDropped.get()?.dup ?? 0;
  const rejected = s.rejected.get()?.rej ?? 0;
  const outOfOrderSessions = cohort.reduce((n, x) => n + (x.outOfOrder ? 1 : 0), 0);
  const unverifiedResultSessions = cohort.reduce((n, x) => n + (x.unverifiedResult ? 1 : 0), 0);

  return {
    generatedAt: now.toISOString(),
    filters: { ...filters, campaigns: [...filters.campaigns] },
    available: availableFilters(db, catalog, funnelId),
    kpis,
    steps,
    variants,
    abTest,
    versions,
    results: resultsFor(catalog, cohort),
    campaigns,
    extraEvents: extraEventsFor(catalog, cohort, versionsInScope),
    dataQuality: { duplicatesDropped, rejected, outOfOrderSessions, unverifiedResultSessions },
  };
}
