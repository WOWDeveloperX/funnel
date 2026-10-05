/**
 * Synthetic traffic generator.
 *
 *   npm run generate -- --sessions 150 --url http://localhost:3000 [--seed 42] [--token <ADMIN_TOKEN>]
 *
 * Goes through the real public API: creates sessions (server assigns A/B, ~8% use the override
 * param), walks each server-resolved funnel with the shared engine (visibility, navigation,
 * validation, result rules), saves state, submits results, and emits the events the web client
 * would emit. Events are then delivered in mixed batches with realistic transport noise:
 * shuffled order, in-batch duplicates, whole-batch retries and a few invalid events.
 *
 * Ground truth is kept in memory and compared with the DELTA of GET /api/admin/analytics taken
 * before and after the run (started / reachedResult / ctaClicked per variant and per campaign).
 * Exit code 1 on any mismatch or API error.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  type AdminEventsResponse,
  type AdminVersionDetailResponse,
  type AdminVersionsResponse,
  type AnalyticsResponse,
  type EventInput,
  type HealthResponse,
  type IngestResponse,
  type IngestTotals,
  type Kpis,
  type SessionState,
  type Step,
  type SubmitResultResponse,
  NONE_CAMPAIGN,
  REJECT_REASONS,
  answerKey,
  computeResultId,
  isInteractive,
  variantKeys,
} from '@funnel/shared';
import { ApiClient, qs } from './lib/http';
import {
  COMMON_OPTIONS,
  FAIL,
  OK,
  floatOption,
  heading,
  intOption,
  pct,
  pool,
  resolveToken,
  resolveUrl,
  runMain,
  table,
} from './lib/cli';
import { Rng } from './lib/prng';
import { FunnelWalker, randomAnswer } from './lib/walker';

const HELP = `Synthetic traffic generator

Usage: npm run generate -- [options]

  --sessions <n>        sessions to simulate (default 150)
  --url <url>           server base URL (default $FUNNEL_URL or http://localhost:3000)
  --token <token>       admin token (default $ADMIN_TOKEN); only needed if admin GETs are protected
  --funnel <id>         funnel id (default: the server's default funnel)
  --seed <n>            PRNG seed for behaviour (default 42)
  --concurrency <n>     parallel sessions / batches in flight (default 8)
  --days <n>            spread client timestamps over the past n days (default 3)
  --override-rate <p>   share of sessions opened with ?variant=<key> (default 0.08)
  --no-utm-rate <p>     share of sessions without UTM params (default 0.10)
  --back-rate <p>       share of sessions that go back 1–2 steps (default 0.13)
  --skew-rate <p>       share of sessions whose client clock jumps back mid-walk (default 0.05)
  --invalid <n>         invalid events to inject (default 3: unknown session, unknown name, bad timestamp)
  --no-verify           skip the before/after analytics comparison
  -h, --help            show this help`;

interface Options {
  url: string;
  token: string | undefined;
  funnelId: string | undefined;
  sessions: number;
  seed: number;
  concurrency: number;
  days: number;
  overrideRate: number;
  noUtmRate: number;
  backRate: number;
  skewRate: number;
  invalid: number;
  verify: boolean;
}

function parseOptions(): Options | null {
  const { values } = parseArgs({
    options: {
      ...COMMON_OPTIONS,
      sessions: { type: 'string' },
      seed: { type: 'string' },
      concurrency: { type: 'string' },
      days: { type: 'string' },
      'override-rate': { type: 'string' },
      'no-utm-rate': { type: 'string' },
      'back-rate': { type: 'string' },
      'skew-rate': { type: 'string' },
      invalid: { type: 'string' },
      'no-verify': { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return null;
  }
  return {
    url: resolveUrl(values.url),
    token: resolveToken(values.token),
    funnelId: values.funnel,
    sessions: intOption(values.sessions, 'sessions', 150, 1),
    seed: intOption(values.seed, 'seed', 42),
    concurrency: intOption(values.concurrency, 'concurrency', 8, 1),
    days: intOption(values.days, 'days', 3, 1),
    overrideRate: floatOption(values['override-rate'], 'override-rate', 0.08),
    noUtmRate: floatOption(values['no-utm-rate'], 'no-utm-rate', 0.1),
    backRate: floatOption(values['back-rate'], 'back-rate', 0.13),
    skewRate: floatOption(values['skew-rate'], 'skew-rate', 0.05),
    invalid: intOption(values.invalid, 'invalid', 3),
    verify: !values['no-verify'],
  };
}

// ---------------------------------------------------------------------------
// Traffic model
// ---------------------------------------------------------------------------

interface CampaignSpec {
  campaign: string;
  weight: number;
  /** Plausible [utm_source, utm_medium] pairs for this campaign. */
  sources: [string, string][];
}

/** Campaign mix: three campaigns plus a no-UTM bucket (--no-utm-rate). */
const CAMPAIGNS: CampaignSpec[] = [
  {
    campaign: 'meta_spring',
    weight: 0.4,
    sources: [
      ['facebook', 'paid_social'],
      ['instagram', 'paid_social'],
    ],
  },
  { campaign: 'google_brand', weight: 0.35, sources: [['google', 'cpc']] },
  { campaign: 'newsletter_oct', weight: 0.25, sources: [['newsletter', 'email']] },
];

/**
 * Per-variant behaviour. B is a bit "better" on the intro, on the first few questions and on the
 * CTA, so the dashboard shows a visible but plausible difference. Unknown variants behave like A.
 */
interface VariantProfile {
  introDrop: number;
  /** Multiplier on the base drop rate for the first EARLY_STEPS interactive steps. */
  earlyFactor: number;
  lateFactor: number;
  /** P(cta_clicked | result viewed). */
  ctaRate: number;
}

const PROFILES: Record<string, VariantProfile> = {
  A: { introDrop: 0.12, earlyFactor: 1.0, lateFactor: 1.0, ctaRate: 0.42 },
  B: { introDrop: 0.07, earlyFactor: 0.55, lateFactor: 0.95, ctaRate: 0.55 },
};
const DEFAULT_PROFILE: VariantProfile = PROFILES.A!;

/** Base probability of abandoning on first view of an interactive step, by type. */
const BASE_DROP: Record<string, number> = { 'single-select': 0.035, 'multi-select': 0.06, number: 0.05 };
const EARLY_STEPS = 3;

function dropProbability(step: Step, answeredBefore: number, profile: VariantProfile): number {
  if (step.type === 'info') return profile.introDrop;
  const base = BASE_DROP[step.type] ?? 0.04;
  return base * (answeredBefore < EARLY_STEPS ? profile.earlyFactor : profile.lateFactor);
}

/** Probability of a PUT /state after a step change (the real client debounces every change). */
const STATE_SAVE_RATE = 0.3;
/** Probability that an abandoning user's last state was saved. */
const ABANDON_SAVE_RATE = 0.6;

// Delivery noise
const BATCH_MIN = 5;
const BATCH_MAX = 40;
const SHUFFLE_RATE = 0.15;
const DUPLICATE_RATE = 0.1;
const RESEND_RATE = 0.05;
/** Sessions whose events are "in flight" at once while batching (interleaving across sessions). */
const ACTIVE_WINDOW = 10;

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------

interface SessionTruth {
  sessionId: string;
  variant: string;
  variantSource: string;
  version: number;
  campaign: string | null;
  firstStepId: string | null;
  reachedResult: boolean;
  ctaClicked: boolean;
  expanded: boolean;
  resultId: string | null;
  backs: number;
  /** The client clock jumped backwards before a new step (→ an out-of-order session on the dashboard). */
  skewed: boolean;
  abandonedAt: string | null;
  events: EventInput[];
}

interface Counts {
  started: number;
  reachedResult: number;
  ctaClicked: number;
}

const zero = (): Counts => ({ started: 0, reachedResult: 0, ctaClicked: 0 });
const campaignKey = (c: string | null): string => c ?? NONE_CAMPAIGN;

function addTruth(map: Map<string, Counts>, key: string, t: SessionTruth): void {
  const c = map.get(key) ?? zero();
  c.started++;
  if (t.reachedResult) c.reachedResult++;
  if (t.ctaClicked) c.ctaClicked++;
  map.set(key, c);
}

// ---------------------------------------------------------------------------
// Session simulation
// ---------------------------------------------------------------------------

interface SimContext {
  api: ApiClient;
  opts: Options;
  overrideParam: string;
  variantKeys: string[];
  nowMs: number;
  errors: string[];
}

function buildQuery(rng: Rng, ctx: SimContext): Record<string, string> {
  const query: Record<string, string> = {};
  if (!rng.chance(ctx.opts.noUtmRate)) {
    const spec = rng.weighted(
      CAMPAIGNS,
      CAMPAIGNS.map((c) => c.weight),
    );
    const [source, medium] = rng.pick(spec.sources);
    query.utm_source = source;
    query.utm_medium = medium;
    query.utm_campaign = spec.campaign;
  }
  if (ctx.variantKeys.length > 0 && rng.chance(ctx.opts.overrideRate)) {
    query[ctx.overrideParam] = rng.pick(ctx.variantKeys);
  }
  return query;
}

async function simulateSession(ctx: SimContext, rng: Rng): Promise<SessionTruth | null> {
  const { api, opts } = ctx;
  const query = buildQuery(rng, ctx);
  let session: SessionState;
  try {
    session = await api.post<SessionState>('/api/sessions', { funnelId: opts.funnelId, query }, 201);
  } catch (err) {
    ctx.errors.push(`create session: ${(err as Error).message}`);
    return null;
  }

  const dayMs = 24 * 3600_000;
  const startMs = ctx.nowMs - Math.round(rng.float(15 * 60_000, opts.days * dayMs));
  const w = new FunnelWalker(session, rng, startMs);
  const truth: SessionTruth = {
    sessionId: session.sessionId,
    variant: session.variant,
    variantSource: session.variantSource,
    version: session.funnelVersion,
    campaign: session.utm.campaign,
    firstStepId: session.funnel.stepSequence[0] ?? null,
    reachedResult: false,
    ctaClicked: false,
    expanded: false,
    resultId: null,
    backs: 0,
    skewed: false,
    abandonedAt: null,
    events: w.events,
  };
  const profile = PROFILES[session.variant] ?? DEFAULT_PROFILE;
  const saveState = (): Promise<unknown> =>
    api.put(`/api/sessions/${encodeURIComponent(session.sessionId)}/state`, w.statePayload());

  // 10–15% of sessions go back 1–2 steps once, after answering a few questions, then re-answer.
  const wantsBack = rng.chance(opts.backRate);
  const backAfter = rng.int(2, 4);
  let backDone = false;
  let answered = 0;
  const seen = new Set<string>();
  // A few devices correct their clock backwards mid-session (NTP sync): the next new step then
  // carries a client_ts earlier than the intro's. Analytics must not rely on timestamps for order.
  const skewAt = rng.chance(opts.skewRate) ? rng.int(2, 5) : -1;

  try {
    for (let guard = 0; w.current && guard < 200; guard++) {
      const step = w.step;
      if (!step) throw new Error(`step "${w.current}" missing from the resolved funnel`);
      if (!truth.skewed && seen.size === skewAt && !seen.has(step.id)) {
        w.clockMs -= rng.int(20, 90) * 60_000;
        truth.skewed = true;
      }
      w.view();
      if (step.type === 'result') break;

      const firstView = !seen.has(step.id);
      seen.add(step.id);
      if (firstView && rng.chance(dropProbability(step, answered, profile))) {
        truth.abandonedAt = step.id;
        if (rng.chance(ABANDON_SAVE_RATE)) await saveState();
        return truth;
      }

      if (wantsBack && !backDone && answered >= backAfter && isInteractive(step)) {
        backDone = true;
        const hops = rng.chance(0.7) ? 1 : 2;
        for (let hop = 0; hop < hops; hop++) {
          if (hop > 0) w.view(); // the intermediate step is rendered before the second back
          if (!w.back()) break;
        }
        truth.backs = w.backs;
        continue; // the loop re-renders the destination step
      }

      if (isInteractive(step)) {
        const previous = w.answers[answerKey(step)!];
        // After going back, people often keep their answer, sometimes change it (may flip a branch).
        const value = previous !== undefined && rng.chance(0.6) ? previous : randomAnswer(step, rng);
        const err = w.submit(value);
        if (err) throw new Error(`generated an invalid answer for ${step.id}: ${err}`);
        if (firstView) answered++;
      }
      w.advance();
      if (rng.chance(STATE_SAVE_RATE)) await saveState();
    }

    if (w.step?.type === 'result') {
      const res = await api.post<SubmitResultResponse>(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/result`,
        { answers: w.answers },
        200,
      );
      const local = computeResultId(w.funnel, w.answers);
      if (res.resultId !== local) {
        ctx.errors.push(`session ${session.sessionId}: server result ${res.resultId} ≠ shared engine ${local}`);
      }
      truth.resultId = res.resultId;
      w.resultViewed(res.resultId);
      truth.reachedResult = true;
      if (rng.chance(profile.ctaRate)) {
        truth.expanded = w.ctaClicked(res.resultId, res.result).expanded;
        truth.ctaClicked = true;
      }
    } else if (w.current) {
      truth.abandonedAt = w.current;
    }
  } catch (err) {
    // Keep the session: truth flags only reflect events that were actually emitted.
    ctx.errors.push(`session ${session.sessionId}: ${(err as Error).message}`);
  }
  truth.backs = w.backs;
  return truth;
}

// ---------------------------------------------------------------------------
// Delivery planning
// ---------------------------------------------------------------------------

type InvalidKind = 'unknown_session' | 'unknown_name' | 'bad_timestamp';

const INVALID_KINDS: { kind: InvalidKind; reason: string }[] = [
  { kind: 'unknown_session', reason: REJECT_REASONS.unknownSession },
  { kind: 'unknown_name', reason: REJECT_REASONS.eventNotAllowed },
  { kind: 'bad_timestamp', reason: REJECT_REASONS.invalidTimestamp },
];

interface PlannedBatch {
  /** Exactly what is POSTed (identical JSON on a resend). */
  events: EventInput[];
  validCount: number;
  duplicateCopies: number;
  invalidReasons: string[];
  shuffled: boolean;
  resend: boolean;
}

function makeInvalidEvent(kind: InvalidKind, truths: SessionTruth[], rng: Rng, nowMs: number): EventInput {
  const victim = rng.pick(truths);
  const base: EventInput = {
    event_id: randomUUID(),
    session_id: victim.sessionId,
    name: 'step_viewed',
    client_timestamp: new Date(nowMs - rng.int(1_000, 60_000)).toISOString(),
    step_id: victim.firstStepId,
    properties: {},
  };
  switch (kind) {
    case 'unknown_session':
      return { ...base, session_id: `gen-missing-${randomUUID()}`, step_id: null };
    case 'unknown_name':
      return { ...base, name: 'step_hovered', step_id: null };
    case 'bad_timestamp':
      return { ...base, client_timestamp: 'not-a-timestamp' };
  }
}

/** Groups events into 5–40 sized batches, interleaving a sliding window of sessions. */
function planBatches(truths: SessionTruth[], rng: Rng, invalidCount: number, nowMs: number): PlannedBatch[] {
  const pending = rng.shuffle(truths.filter((t) => t.events.length > 0).map((t) => [...t.events]));
  const active: EventInput[][] = [];
  const raw: EventInput[][] = [];
  while (pending.length > 0 || active.length > 0) {
    const size = rng.int(BATCH_MIN, BATCH_MAX);
    const batch: EventInput[] = [];
    while (batch.length < size) {
      while (active.length < ACTIVE_WINDOW && pending.length > 0) active.push(pending.shift()!);
      if (active.length === 0) break;
      const qi = rng.int(0, active.length - 1);
      const queue = active[qi]!;
      const take = Math.min(rng.int(1, 4), queue.length, size - batch.length);
      batch.push(...queue.splice(0, take));
      if (queue.length === 0) active.splice(qi, 1);
    }
    if (batch.length > 0) raw.push(batch);
  }

  const batches: PlannedBatch[] = raw.map((events) => ({
    events,
    validCount: events.length,
    duplicateCopies: 0,
    invalidReasons: [],
    shuffled: rng.chance(SHUFFLE_RATE),
    resend: rng.chance(RESEND_RATE),
  }));
  const wantDuplicate = batches.map(() => rng.chance(DUPLICATE_RATE));

  // Make sure every kind of noise shows up at least once, even on small runs.
  if (batches.length >= 3) {
    if (!batches.some((b) => b.shuffled)) rng.pick(batches).shuffled = true;
    if (!batches.some((b) => b.resend)) rng.pick(batches).resend = true;
    if (!wantDuplicate.some(Boolean)) wantDuplicate[rng.int(0, batches.length - 1)] = true;
  }

  batches.forEach((b, i) => {
    if (!wantDuplicate[i]) return;
    const copy = structuredClone(rng.pick(b.events));
    b.events.splice(rng.int(0, b.events.length), 0, copy);
    b.validCount++;
    b.duplicateCopies++;
  });

  if (truths.length > 0) {
    for (let i = 0; i < invalidCount; i++) {
      const { kind, reason } = INVALID_KINDS[i % INVALID_KINDS.length]!;
      const b = rng.pick(batches);
      b.events.splice(rng.int(0, b.events.length), 0, makeInvalidEvent(kind, truths, rng, nowMs));
      b.invalidReasons.push(reason);
    }
  }

  for (const b of batches) if (b.shuffled) b.events = rng.shuffle(b.events);
  return batches;
}

interface DeliveryStats {
  requests: number;
  eventsSent: number;
  accepted: Set<string>;
  acceptedTotal: number;
  duplicates: number;
  rejected: number;
  reasons: Map<string, number>;
  errors: string[];
}

async function deliver(api: ApiClient, batches: PlannedBatch[], concurrency: number): Promise<DeliveryStats> {
  const stats: DeliveryStats = {
    requests: 0,
    eventsSent: 0,
    accepted: new Set(),
    acceptedTotal: 0,
    duplicates: 0,
    rejected: 0,
    reasons: new Map(),
    errors: [],
  };
  const send = async (body: string, count: number): Promise<void> => {
    stats.requests++;
    stats.eventsSent += count;
    // Network-level retries are safe (dedupe by event_id) but are counted to explain extra duplicates.
    const res = await api.call<IngestResponse>('POST', '/api/events', body, 200, { retries: 2 });
    for (const id of res.accepted) stats.accepted.add(id);
    stats.acceptedTotal += res.accepted.length;
    stats.duplicates += res.duplicates.length;
    stats.rejected += res.rejected.length;
    for (const r of res.rejected) {
      const reason = r.reason.split(':')[0]!.trim();
      stats.reasons.set(reason, (stats.reasons.get(reason) ?? 0) + 1);
    }
  };
  await pool(batches, concurrency, async (b, i) => {
    const body = JSON.stringify({ events: b.events });
    try {
      await send(body, b.events.length);
      if (b.resend) await send(body, b.events.length); // "the response timed out" → identical retry
    } catch (err) {
      stats.errors.push(`batch #${i}: ${(err as Error).message}`);
    }
  });
  return stats;
}

// ---------------------------------------------------------------------------
// Dashboard snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  total: Counts;
  byVariant: Map<string, Counts>;
  byCampaign: Map<string, Counts>;
  dataQuality: AnalyticsResponse['dataQuality'];
}

const countsOf = (k: Kpis): Counts => ({
  started: k.started,
  reachedResult: k.reachedResult,
  ctaClicked: k.ctaClicked,
});

async function analyticsSnapshot(api: ApiClient, funnelId: string | undefined): Promise<Snapshot> {
  const a = await api.get<AnalyticsResponse>(
    `/api/admin/analytics${qs({ funnelId, version: 'all', variant: 'all', excludeOverride: 0 })}`,
  );
  return {
    total: countsOf(a.kpis),
    byVariant: new Map(a.variants.map((v) => [v.variant, countsOf(v.kpis)])),
    byCampaign: new Map(a.campaigns.map((c) => [c.campaign, countsOf(c.kpis)])),
    dataQuality: a.dataQuality,
  };
}

async function ingestTotals(api: ApiClient): Promise<IngestTotals | null> {
  try {
    return (await api.get<AdminEventsResponse>('/api/admin/events?limit=1')).totals;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let baseUrl = '';

async function main(): Promise<number> {
  const opts = parseOptions();
  if (!opts) return 0;
  baseUrl = opts.url;
  const api = new ApiClient(opts.url, opts.token);
  const started = Date.now();

  const health = await api.get<HealthResponse>('/api/health');
  console.log(`Server ${opts.url} — active version ${health.activeVersion ?? 'none'}`);

  // Discover the override query param and variant keys from the active config (config-driven).
  let overrideParam = 'variant';
  let keys: string[] = ['A', 'B'];
  let funnelId = opts.funnelId;
  try {
    const versions = await api.get<AdminVersionsResponse>(`/api/admin/versions${qs({ funnelId: opts.funnelId })}`);
    funnelId = funnelId ?? versions.funnelId;
    if (versions.activeVersion !== null) {
      const detail = await api.get<AdminVersionDetailResponse>(
        `/api/admin/versions/${versions.activeVersion}${qs({ funnelId })}`,
      );
      overrideParam = detail.config.experiment.overrideQueryParam ?? overrideParam;
      keys = variantKeys(detail.config);
    }
  } catch (err) {
    console.warn(`! could not read the active config (${(err as Error).message}); using ?variant=A|B`);
  }

  let before: Snapshot | null = null;
  const errors: string[] = [];
  if (opts.verify) {
    try {
      before = await analyticsSnapshot(api, funnelId);
    } catch (err) {
      errors.push(`analytics before: ${(err as Error).message}`);
    }
  }
  const totalsBefore = await ingestTotals(api);

  // --- simulate sessions -------------------------------------------------
  heading(`Simulating ${opts.sessions} sessions (seed ${opts.seed}, concurrency ${opts.concurrency})`);
  const master = new Rng(opts.seed);
  const ctx: SimContext = { api, opts, overrideParam, variantKeys: keys, nowMs: Date.now(), errors };
  let done = 0;
  const results = await pool(
    Array.from({ length: opts.sessions }, (_, i) => i),
    opts.concurrency,
    async (i) => {
      const truth = await simulateSession(ctx, master.fork(i + 1));
      done++;
      if (done % 25 === 0 || done === opts.sessions) process.stdout.write(`  ${done}/${opts.sessions} sessions\n`);
      return truth;
    },
  );
  const truths = results.filter((t): t is SessionTruth => t !== null);

  // --- deliver events ----------------------------------------------------
  const deliveryRng = master.fork(0);
  const batches = planBatches(truths, deliveryRng, opts.invalid, ctx.nowMs);
  const uniqueEvents = truths.reduce((s, t) => s + t.events.length, 0);
  heading(`Delivering ${uniqueEvents} events in ${batches.length} batches`);
  const stats = await deliver(api, batches, opts.concurrency);
  errors.push(...stats.errors);

  // --- ground truth --------------------------------------------------------
  const byVariant = new Map<string, Counts>();
  const byCampaign = new Map<string, Counts>();
  const total = zero();
  for (const t of truths) {
    addTruth(byVariant, t.variant, t);
    addTruth(byCampaign, campaignKey(t.campaign), t);
    total.started++;
    if (t.reachedResult) total.reachedResult++;
    if (t.ctaClicked) total.ctaClicked++;
  }

  heading('Ground truth (this run)');
  const variantRows = [...byVariant.keys()].sort().map((v) => {
    const c = byVariant.get(v)!;
    const ts = truths.filter((t) => t.variant === v);
    return [
      v,
      c.started,
      ts.filter((t) => t.variantSource === 'override').length,
      c.reachedResult,
      c.ctaClicked,
      pct(c.reachedResult, c.started),
      pct(c.ctaClicked, c.started),
      ts.filter((t) => t.backs > 0).length,
      ts.filter((t) => t.expanded).length,
    ];
  });
  console.log(
    table(
      [
        'variant',
        'started',
        'override',
        'reachedResult',
        'ctaClicked',
        'completion',
        'CTR/started',
        'went back',
        'expanded',
      ],
      variantRows,
    ),
  );
  console.log();
  const campaignRows = [...byCampaign.keys()].sort().map((k) => {
    const c = byCampaign.get(k)!;
    return [k, c.started, c.reachedResult, c.ctaClicked, pct(c.ctaClicked, c.started)];
  });
  console.log(table(['campaign', 'started', 'reachedResult', 'ctaClicked', 'CTR/started'], campaignRows));

  const versions = new Map<number, number>();
  const resultsDist = new Map<string, number>();
  const dropAt = new Map<string, number>();
  for (const t of truths) {
    versions.set(t.version, (versions.get(t.version) ?? 0) + 1);
    if (t.resultId) resultsDist.set(t.resultId, (resultsDist.get(t.resultId) ?? 0) + 1);
    if (t.abandonedAt) dropAt.set(t.abandonedAt, (dropAt.get(t.abandonedAt) ?? 0) + 1);
  }
  console.log(`\nversions: ${[...versions].map(([v, n]) => `v${v}×${n}`).join(', ')}`);
  console.log(`results:  ${[...resultsDist].map(([r, n]) => `${r}×${n}`).join(', ') || '—'}`);
  console.log(`drop-off: ${[...dropAt].map(([s, n]) => `${s}×${n}`).join(', ') || '—'}`);

  // --- delivery verification ---------------------------------------------
  const expectedDuplicates = batches.reduce((s, b) => s + b.duplicateCopies + (b.resend ? b.validCount : 0), 0);
  const expectedReasons = new Map<string, number>();
  for (const b of batches) {
    for (const r of b.invalidReasons) expectedReasons.set(r, (expectedReasons.get(r) ?? 0) + (b.resend ? 2 : 1));
  }
  const expectedRejected = [...expectedReasons.values()].reduce((s, n) => s + n, 0);
  const allIds = truths.flatMap((t) => t.events.map((e) => e.event_id));
  const missing = allIds.filter((id) => !stats.accepted.has(id));
  const retries = api.networkRetries;

  heading('Delivery');
  console.log(
    `batches ${batches.length} (+${batches.filter((b) => b.resend).length} resent) · ` +
      `shuffled ${batches.filter((b) => b.shuffled).length} · ` +
      `with in-batch duplicate ${batches.filter((b) => b.duplicateCopies > 0).length} · ` +
      `invalid injected ${opts.invalid} · requests ${stats.requests} · events sent ${stats.eventsSent}`,
  );
  type Row = { scope: string; metric: string; expected: number; actual: number; hard: boolean };
  const deliveryRows: Row[] = [
    { scope: 'ingest', metric: 'accepted', expected: allIds.length, actual: stats.acceptedTotal, hard: true },
    // Network retries may legitimately add duplicates; then only a lower bound is checked.
    {
      scope: 'ingest',
      metric: 'duplicates',
      expected: expectedDuplicates,
      actual: stats.duplicates,
      hard: retries === 0,
    },
    { scope: 'ingest', metric: 'rejected', expected: expectedRejected, actual: stats.rejected, hard: true },
    ...[...new Set([...expectedReasons.keys(), ...stats.reasons.keys()])].sort().map((r) => ({
      scope: 'rejected',
      metric: r,
      expected: expectedReasons.get(r) ?? 0,
      actual: stats.reasons.get(r) ?? 0,
      hard: true,
    })),
  ];
  let failed = false;
  const mark = (r: Row): string => {
    const ok = r.hard ? r.expected === r.actual : r.actual >= r.expected;
    if (!ok) failed = true;
    return ok ? OK : FAIL;
  };
  console.log(
    table(
      ['', 'scope', 'metric', 'expected', 'server'],
      deliveryRows.map((r) => [mark(r), r.scope, r.metric, r.expected, r.actual]),
    ),
  );
  if (missing.length > 0) {
    failed = true;
    console.log(
      `${FAIL} ${missing.length} generated events were never accepted (e.g. ${missing.slice(0, 3).join(', ')})`,
    );
  }
  if (retries > 0) console.log(`! ${retries} network retries happened; duplicates checked as a lower bound`);

  const totalsAfter = await ingestTotals(api);
  if (totalsBefore && totalsAfter) {
    const d = (k: keyof IngestTotals): number => totalsAfter[k] - totalsBefore[k];
    console.log(
      `\n/api/admin/events totals Δ (informational): batches ${d('batches')}, received ${d('received')}, ` +
        `accepted ${d('accepted')}, duplicates ${d('duplicates')}, rejected ${d('rejected')}`,
    );
  }

  // --- dashboard comparison ----------------------------------------------
  if (opts.verify) {
    heading('Dashboard check: GET /api/admin/analytics (after − before) vs ground truth');
    let after: Snapshot | null = null;
    try {
      after = await analyticsSnapshot(api, funnelId);
    } catch (err) {
      errors.push(`analytics after: ${(err as Error).message}`);
    }
    if (before && after) {
      const rows: Row[] = [];
      const metrics: (keyof Counts)[] = ['started', 'reachedResult', 'ctaClicked'];
      const push = (scope: string, exp: Counts, b: Counts | undefined, a: Counts | undefined): void => {
        for (const m of metrics) {
          rows.push({ scope, metric: m, expected: exp[m], actual: (a?.[m] ?? 0) - (b?.[m] ?? 0), hard: true });
        }
      };
      push('all', total, before.total, after.total);
      const variantScopes = new Set([...byVariant.keys(), ...after.byVariant.keys()]);
      for (const v of [...variantScopes].sort()) {
        const exp = byVariant.get(v) ?? zero();
        const a = after.byVariant.get(v);
        const b = before.byVariant.get(v);
        if (!byVariant.has(v) && (a?.started ?? 0) === (b?.started ?? 0)) continue; // untouched variant
        push(`variant ${v}`, exp, b, a);
      }
      const campaignScopes = new Set([...byCampaign.keys(), ...after.byCampaign.keys()]);
      for (const c of [...campaignScopes].sort()) {
        const exp = byCampaign.get(c) ?? zero();
        const a = after.byCampaign.get(c);
        const b = before.byCampaign.get(c);
        if (!byCampaign.has(c) && (a?.started ?? 0) === (b?.started ?? 0)) continue;
        push(`campaign ${c}`, exp, b, a);
      }
      console.log(
        table(
          ['', 'scope', 'metric', 'expected', 'dashboard Δ'],
          rows.map((r) => [mark(r), r.scope, r.metric, r.expected, r.actual]),
        ),
      );
      const dq = (k: keyof Snapshot['dataQuality']): number => after.dataQuality[k] - before.dataQuality[k];
      const skewed = truths.filter((t) => t.skewed).length;
      console.log(
        `\ndataQuality Δ (informational): duplicatesDropped ${dq('duplicatesDropped')} (server reported ${stats.duplicates}), ` +
          `rejected ${dq('rejected')} (server reported ${stats.rejected}), ` +
          `outOfOrderSessions ${dq('outOfOrderSessions')} (clock-skewed sessions ${skewed})`,
      );
      console.log('Note: deltas assume no other traffic hit the server during the run.');
    } else {
      failed = true;
      console.log(`${FAIL} analytics snapshot unavailable — cannot compare`);
    }
  }

  // --- verdict -------------------------------------------------------------
  if (truths.length < opts.sessions) failed = true;
  if (errors.length > 0) {
    failed = true;
    heading(`Errors (${errors.length})`);
    for (const e of errors.slice(0, 20)) console.log(`  ${FAIL} ${e}`);
    if (errors.length > 20) console.log(`  … ${errors.length - 20} more`);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${failed ? `${FAIL} FAILED` : `${OK} OK`} — ${truths.length} sessions, ${uniqueEvents} events in ${secs}s`,
  );
  return failed ? 1 : 0;
}

runMain(main, () => baseUrl);
