/**
 * Analytics + admin event log. Sessions/events are inserted directly into the DB (independent of the
 * ingest service) and every expectation below is computed by hand from the fixture.
 *
 * v1 sequences (positions):
 *   A: intro0 team_size1 work_mode2 priorities3 timezone_span4 office_days5 async_maturity6 tool_count7 result8
 *   B: intro0 work_mode1 timezone_span2 team_size3 async_maturity4 priorities5 office_days6 tool_count7 result8
 *
 * v1 sessions:
 *   a1 A hash  meta    hybrid, passes every step incl. office_days, result + CTA
 *   a2 A hash  meta    remote, result_viewed, no CTA (result reached without CTA)
 *   a3 A hash  (none)  back from priorities → work_mode (re-views), drops at timezone_span
 *   a4 A override google remote, cta_clicked WITHOUT result_viewed
 *   a5 A hash  (none)  started only
 *   b1 B hash  meta    hybrid, full path + CTA; inserted shuffled with shuffled client timestamps
 *   b2 B hash  google  remote, NO events at all for team_size (implied view), drops at priorities
 *   b3 B hash  (none)  remote, async_maturity has answer_submitted+step_completed but no step_viewed; CTA
 *   b4 B hash  meta    drops at work_mode
 * v3 sessions:
 *   c1 v3 A hash meta    remote + compliance branch, result + CTA + recommendation_expanded
 *   c2 v3 B hash (none)  remote, no compliance, result without CTA
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdminEventsResponse, AnalyticsResponse, Kpis, StepMetrics } from '@funnel/shared';
import { buildApp } from '../src/app';
import type { DB } from '../src/db';
import { mergeStepOrder } from '../src/services/analytics/derive';
import { normalCdf, twoProportionZTest } from '../src/services/analytics/stats';
import { CONFIG_V3, SEED_V1 } from './helpers';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FUNNEL = 'workstyle-planner';
const EXPERIMENT: Record<number, string> = {
  1: 'question-order-and-result-framing-v1',
  3: 'question-order-and-result-framing-v3',
};
const BASE = Date.parse('2026-10-01T10:00:00.000Z');

interface Ev {
  name: string;
  step: string | null;
  props?: Record<string, unknown>;
}

const sv = (step: string): Ev => ({ name: 'step_viewed', step });
const sc = (step: string): Ev => ({ name: 'step_completed', step });
const as = (step: string): Ev => ({ name: 'answer_submitted', step, props: { answer_kind: 'single-select' } });
const back = (step: string, dest: string): Ev => ({ name: 'back_clicked', step, props: { destination_step_id: dest } });
const rv = (resultId: string): Ev => ({ name: 'result_viewed', step: 'result', props: { result_id: resultId } });
const cta = (resultId: string): Ev => ({
  name: 'cta_clicked',
  step: 'result',
  props: { result_id: resultId, action: 'expand_recommendation' },
});
const ext = (name: string): Ev => ({ name, step: 'result', props: { source: 'result_cta' } });
/** step_viewed + step_completed for each step, in order. */
const pass = (...steps: string[]): Ev[] => steps.flatMap((s) => [sv(s), sc(s)]);

interface FixtureSession {
  id: string;
  version: number;
  variant: string;
  source: 'hash' | 'override';
  campaign: string | null;
  resultId: string | null;
  events: Ev[];
  /** Insert in shuffled order AND shuffle client timestamps between events. */
  shuffle?: boolean;
}

/** Deterministic PRNG (mulberry32) so the shuffled fixture is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

let serverClock = 0;
const nextServerTs = (): string => new Date(BASE + 86_400_000 + serverClock++ * 1000).toISOString();

function insertEventRows(db: DB, s: FixtureSession, rows: { id: string; ev: Ev; clientTs: string }[]): void {
  const stmt = db.prepare(
    `INSERT INTO events (event_id, session_id, name, step_id, funnel_id, funnel_version, experiment_id, variant,
                         utm_source, utm_medium, utm_campaign, client_ts, server_ts, properties_json, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL)
     ON CONFLICT(event_id) DO NOTHING`,
  );
  for (const { id, ev, clientTs } of rows) {
    stmt.run(
      id,
      s.id,
      ev.name,
      ev.step,
      FUNNEL,
      s.version,
      EXPERIMENT[s.version],
      s.variant,
      s.campaign,
      clientTs,
      nextServerTs(),
      JSON.stringify(ev.props ?? {}),
    );
  }
}

function eventRowsFor(s: FixtureSession, index: number) {
  const start = BASE + index * 3_600_000;
  return s.events.map((ev, i) => ({
    id: `${s.id}-e${String(i).padStart(3, '0')}`,
    ev,
    clientTs: new Date(start + (i + 1) * 1000).toISOString(),
  }));
}

function insertSession(db: DB, s: FixtureSession, index: number): void {
  const created = new Date(BASE + index * 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, funnel_id, funnel_version, experiment_id, variant, variant_source,
                           utm_source, utm_medium, utm_campaign, answers_json, current_step_id, result_id,
                           created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, '{}', NULL, ?, ?, ?, ?)`,
  ).run(
    s.id,
    FUNNEL,
    s.version,
    EXPERIMENT[s.version],
    s.variant,
    s.source,
    s.campaign,
    s.resultId,
    created,
    created,
    '2099-01-01T00:00:00.000Z',
  );
  // Server-side session_started (as the sessions service does).
  insertEventRows(db, s, [
    { id: `session_started:${s.id}`, ev: { name: 'session_started', step: null }, clientTs: created },
  ]);

  let rows = eventRowsFor(s, index);
  if (s.shuffle) {
    const rand = rng(42);
    const stamps = shuffled(
      rows.map((r) => r.clientTs),
      rand,
    );
    rows = shuffled(
      rows.map((r, i) => ({ ...r, clientTs: stamps[i] as string })),
      rand,
    );
  }
  insertEventRows(db, s, rows);
}

const V1_A_ALL = [
  'intro',
  'team_size',
  'work_mode',
  'priorities',
  'timezone_span',
  'office_days',
  'async_maturity',
  'tool_count',
];
const V1_B_ALL = [
  'intro',
  'work_mode',
  'timezone_span',
  'team_size',
  'async_maturity',
  'priorities',
  'office_days',
  'tool_count',
];
const without = (list: string[], id: string) => list.filter((x) => x !== id);

const SESSIONS: FixtureSession[] = [
  {
    id: 'sess-a1',
    version: 1,
    variant: 'A',
    source: 'hash',
    campaign: 'meta',
    resultId: 'hybrid_structured',
    events: [...pass(...V1_A_ALL), sv('result'), rv('hybrid_structured'), cta('hybrid_structured')],
  },
  {
    id: 'sess-a2',
    version: 1,
    variant: 'A',
    source: 'hash',
    campaign: 'meta',
    resultId: 'balanced',
    events: [...pass(...without(V1_A_ALL, 'office_days')), rv('balanced')],
  },
  {
    id: 'sess-a3',
    version: 1,
    variant: 'A',
    source: 'hash',
    campaign: null,
    resultId: null,
    events: [
      ...pass('intro', 'team_size', 'work_mode'),
      sv('priorities'),
      back('priorities', 'work_mode'),
      ...pass('work_mode', 'priorities'),
      sv('timezone_span'),
    ],
  },
  {
    id: 'sess-a4',
    version: 1,
    variant: 'A',
    source: 'override',
    campaign: 'google',
    resultId: 'async_native',
    events: [...pass(...without(V1_A_ALL, 'office_days')), cta('async_native')],
  },
  { id: 'sess-a5', version: 1, variant: 'A', source: 'hash', campaign: null, resultId: null, events: [] },
  {
    id: 'sess-b1',
    version: 1,
    variant: 'B',
    source: 'hash',
    campaign: 'meta',
    resultId: 'hybrid_structured',
    events: [...pass(...V1_B_ALL), sv('result'), rv('hybrid_structured'), cta('hybrid_structured')],
    shuffle: true,
  },
  {
    id: 'sess-b2',
    version: 1,
    variant: 'B',
    source: 'hash',
    campaign: 'google',
    resultId: null,
    events: [...pass('intro', 'work_mode', 'timezone_span'), ...pass('async_maturity'), sv('priorities')],
  },
  {
    id: 'sess-b3',
    version: 1,
    variant: 'B',
    source: 'hash',
    campaign: null,
    resultId: 'async_native',
    events: [
      ...pass('intro', 'work_mode', 'timezone_span', 'team_size'),
      as('async_maturity'),
      sc('async_maturity'),
      ...pass('priorities', 'tool_count'),
      rv('async_native'),
      cta('async_native'),
    ],
  },
  {
    id: 'sess-b4',
    version: 1,
    variant: 'B',
    source: 'hash',
    campaign: 'meta',
    resultId: null,
    events: [...pass('intro'), sv('work_mode')],
  },
  {
    id: 'sess-c1',
    version: 3,
    variant: 'A',
    source: 'hash',
    campaign: 'meta',
    resultId: 'regulated_scale',
    events: [
      ...pass(
        'intro',
        'team_size',
        'work_mode',
        'priorities',
        'security_constraints',
        'timezone_span',
        'meeting_hours',
        'async_maturity',
        'tool_count',
      ),
      sv('result'),
      rv('regulated_scale'),
      cta('regulated_scale'),
      ext('recommendation_expanded'),
    ],
  },
  {
    id: 'sess-c2',
    version: 3,
    variant: 'B',
    source: 'hash',
    campaign: null,
    resultId: 'balanced',
    events: [
      ...pass('intro', 'work_mode', 'meeting_hours', 'timezone_span', 'team_size', 'async_maturity', 'priorities'),
      rv('balanced'),
    ],
  },
];

function seedFixture(db: DB): void {
  const rawV3 = readFileSync(CONFIG_V3, 'utf8');
  db.prepare(
    `INSERT INTO funnel_versions (funnel_id, version, config_json, config_hash, title, release_note, created_at)
     VALUES (?, 3, ?, 'test-hash-v3', 'v3', NULL, ?)`,
  ).run(FUNNEL, JSON.stringify(JSON.parse(rawV3)), new Date(BASE).toISOString());

  SESSIONS.forEach((s, i) => insertSession(db, s, i));

  // Retry of a1's events (same event_ids): deduplicated by the PK, must not change anything.
  const a1 = SESSIONS[0] as FixtureSession;
  insertEventRows(db, a1, eventRowsFor(a1, 0));

  db.prepare(
    `INSERT INTO ingest_batches (id, received_at, total, accepted, duplicates, rejected) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('batch-1', new Date(BASE).toISOString(), 10, 7, 2, 1);
  db.prepare(
    `INSERT INTO ingest_batches (id, received_at, total, accepted, duplicates, rejected) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('batch-2', new Date(BASE + 1000).toISOString(), 6, 3, 3, 0);
  db.prepare(
    `INSERT INTO rejected_events (event_id, batch_id, reason, payload_json, received_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('bad-event-1', 'batch-1', 'unknown_session', '{}', new Date(BASE).toISOString());
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Count/rate KPIs (medianTimeToResultSec is asserted separately). */
type CountKpis = Omit<Kpis, 'medianTimeToResultSec'>;

function kpis(started: number, reachedResult: number, ctaClicked: number, backSessions: number): CountKpis {
  const r = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    started,
    reachedResult,
    ctaClicked,
    completionRate: r(reachedResult, started),
    ctrFromStarted: r(ctaClicked, started),
    ctrFromResult: r(ctaClicked, reachedResult),
    backRate: r(backSessions, started),
  };
}

function expectKpis(actual: Kpis, expected: CountKpis): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key as keyof CountKpis], key).toBeCloseTo(value, 10);
  }
}

type Counts = Pick<StepMetrics, 'arrived' | 'viewed' | 'progressed'> &
  Partial<Pick<StepMetrics, 'backFrom'>> & { views?: number };

function expectStep(steps: StepMetrics[], stepId: string, c: Counts): StepMetrics {
  const step = steps.find((s) => s.stepId === stepId);
  expect(step, stepId).toBeDefined();
  const s = step as StepMetrics;
  expect({ arrived: s.arrived, viewed: s.viewed, progressed: s.progressed }, stepId).toEqual({
    arrived: c.arrived,
    viewed: c.viewed,
    progressed: c.progressed,
  });
  expect(s.dropOff, `${stepId}.dropOff`).toBe(c.viewed - c.progressed);
  expect(s.dropOffRate, `${stepId}.dropOffRate`).toBeCloseTo(c.viewed ? (c.viewed - c.progressed) / c.viewed : 0, 10);
  expect(s.conversion, `${stepId}.conversion`).toBeCloseTo(c.viewed ? c.progressed / c.viewed : 0, 10);
  expect(s.shownRate, `${stepId}.shownRate`).toBeCloseTo(c.arrived ? c.viewed / c.arrived : 0, 10);
  if (c.backFrom !== undefined) expect(s.backFrom, `${stepId}.backFrom`).toBe(c.backFrom);
  if (c.views !== undefined) {
    expect(s.avgViewsPerSession, `${stepId}.avgViewsPerSession`).toBeCloseTo(c.viewed ? c.views / c.viewed : 0, 10);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics statistics helpers', () => {
  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975002, 5);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 5);
    expect(normalCdf(0.3)).toBeCloseTo(0.617911, 5);
  });

  it('two-proportion pooled z-test: 30/100 vs 45/100', () => {
    // pooled p = 75/200 = 0.375; se = sqrt(0.375 * 0.625 * (1/100 + 1/100)) = sqrt(0.0046875) = 0.0684653
    // z = (0.45 - 0.30) / 0.0684653 = 2.19089; p = 2 * (1 - Φ(2.19089)) = 2 * (1 - 0.985770) = 0.02846
    const { z, pValue } = twoProportionZTest(30, 100, 45, 100);
    expect(z).toBeCloseTo(2.19089, 4);
    expect(pValue).toBeCloseTo(0.02846, 4);
    // symmetric in sign
    expect(twoProportionZTest(45, 100, 30, 100).z).toBeCloseTo(-2.19089, 4);
  });

  it('z-test edge cases', () => {
    expect(twoProportionZTest(0, 0, 1, 10)).toEqual({ z: null, pValue: null });
    expect(twoProportionZTest(0, 10, 0, 12)).toEqual({ z: 0, pValue: 1 });
    expect(twoProportionZTest(5, 5, 7, 7)).toEqual({ z: 0, pValue: 1 });
  });

  it('mergeStepOrder: single sequence as-is, several by average normalized position (stable)', () => {
    expect(mergeStepOrder([['x', 'b', 'a']])).toEqual(['x', 'b', 'a']);
    expect(
      mergeStepOrder([
        ['a', 'b', 'c'],
        ['a', 'c', 'b'],
      ]),
    ).toEqual(['a', 'b', 'c']);
    expect(mergeStepOrder([])).toEqual([]);
  });
});

describe('GET /api/admin/analytics', () => {
  let app: FastifyInstance;

  const get = async (qs = ''): Promise<AnalyticsResponse> => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/analytics${qs}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<AnalyticsResponse>();
  };

  beforeAll(async () => {
    // ADMIN_TOKEN set: GET admin endpoints must stay open.
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1, adminToken: 'secret' });
    seedFixture(app.ctx.db);
  });
  afterAll(async () => {
    await app.close();
  });

  it('fixture sanity: retried events were deduplicated by event_id', () => {
    const { n } = app.ctx.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = 'sess-a1'`).get() as {
      n: number;
    };
    expect(n).toBe(1 + 16 + 3);
  });

  it('echoes filters and lists available values', async () => {
    const r = await get('?version=1&variant=all&excludeOverride=0');
    expect(r.filters).toEqual({ funnelId: FUNNEL, version: 1, variant: 'all', campaigns: [], excludeOverride: false });
    expect(r.available).toEqual({ versions: [1, 3], variants: ['A', 'B'], campaigns: ['google', 'meta', '(none)'] });
    expect(typeof r.generatedAt).toBe('string');
  });

  it('v1 KPIs count unique sessions (cta without result_viewed counts as reached)', async () => {
    const r = await get('?version=1');
    // reached: a1 a2 a4(cta only) b1 b3; cta: a1 a4 b1 b3; back: a3
    expectKpis(r.kpis, kpis(9, 5, 4, 1));
  });

  it('v1 step funnel: order merged across A/B, per-session sequences, implied views, branches', async () => {
    const r = await get('?version=1');
    expect(r.steps.map((s) => s.stepId)).toEqual([
      'intro',
      'work_mode',
      'team_size',
      'timezone_span',
      'priorities',
      'async_maturity',
      'office_days',
      'tool_count',
      'result',
    ]);

    const intro = expectStep(r.steps, 'intro', { arrived: 8, viewed: 8, progressed: 8, views: 8 });
    expect(intro.fromStart).toBeCloseTo(8 / 9, 10);
    expect(intro.type).toBe('info');
    expect(intro.title).toBe('Build a work model your team can actually follow');

    // b4 drops at work_mode; a3 views it twice (back navigation) but counts once.
    expectStep(r.steps, 'work_mode', { arrived: 8, viewed: 8, progressed: 7, views: 9 });
    // b2 has no team_size events at all: implied view (unconditional, later steps exist) → progressed, not a drop-off.
    expectStep(r.steps, 'team_size', { arrived: 7, viewed: 7, progressed: 7, views: 6 });
    // a3 drops at timezone_span.
    expectStep(r.steps, 'timezone_span', { arrived: 7, viewed: 7, progressed: 6, views: 7 });
    // a3 went back from priorities and re-viewed it; b2 drops here.
    expectStep(r.steps, 'priorities', { arrived: 7, viewed: 7, progressed: 6, backFrom: 1, views: 8 });
    // b3: no step_viewed for async_maturity, answer_submitted/step_completed imply it.
    expectStep(r.steps, 'async_maturity', { arrived: 6, viewed: 6, progressed: 6, views: 5 });
    // Branch: only hybrid sessions (a1, b1) see it; remote a2/a4/b3 arrived past it → shownRate 2/5, no drop-off.
    const office = expectStep(r.steps, 'office_days', { arrived: 5, viewed: 2, progressed: 2, views: 2 });
    expect(office.conditional).toBe(true);
    expect(office.shownRate).toBeCloseTo(0.4, 10);
    expect(office.dropOff).toBe(0);
    expectStep(r.steps, 'tool_count', { arrived: 5, viewed: 5, progressed: 5, views: 5 });
    // Result: reached by 5, "progressed" = CTA clicked (a2 did not click).
    const result = expectStep(r.steps, 'result', { arrived: 5, viewed: 5, progressed: 4, views: 2 });
    expect(result.type).toBe('result');
    expect(r.steps.filter((s) => s.conditional).map((s) => s.stepId)).toEqual(['office_days']);
  });

  it('v1 per-variant KPIs and steps follow each variant sequence', async () => {
    const r = await get('?version=1');
    expect(r.variants.map((v) => v.variant)).toEqual(['A', 'B']);
    const [a, b] = r.variants as [AnalyticsResponse['variants'][0], AnalyticsResponse['variants'][0]];

    expectKpis(a.kpis, kpis(5, 3, 2, 1));
    expect(a.steps.map((s) => s.stepId)).toEqual([...V1_A_ALL, 'result']);
    expectStep(a.steps, 'intro', { arrived: 4, viewed: 4, progressed: 4 });
    expect(a.steps[0]?.fromStart).toBeCloseTo(4 / 5, 10);
    expectStep(a.steps, 'work_mode', { arrived: 4, viewed: 4, progressed: 4, views: 5 });
    expectStep(a.steps, 'priorities', { arrived: 4, viewed: 4, progressed: 4, backFrom: 1, views: 5 });
    expectStep(a.steps, 'timezone_span', { arrived: 4, viewed: 4, progressed: 3 });
    expectStep(a.steps, 'office_days', { arrived: 3, viewed: 1, progressed: 1 });
    expectStep(a.steps, 'async_maturity', { arrived: 3, viewed: 3, progressed: 3 });
    expectStep(a.steps, 'result', { arrived: 3, viewed: 3, progressed: 2 });

    expectKpis(b.kpis, kpis(4, 2, 2, 0));
    expect(b.steps.map((s) => s.stepId)).toEqual([...V1_B_ALL, 'result']);
    expectStep(b.steps, 'work_mode', { arrived: 4, viewed: 4, progressed: 3 });
    expectStep(b.steps, 'team_size', { arrived: 3, viewed: 3, progressed: 3, views: 2 });
    expectStep(b.steps, 'async_maturity', { arrived: 3, viewed: 3, progressed: 3, views: 2 });
    expectStep(b.steps, 'priorities', { arrived: 3, viewed: 3, progressed: 2 });
    expectStep(b.steps, 'office_days', { arrived: 2, viewed: 1, progressed: 1 });
    expectStep(b.steps, 'result', { arrived: 2, viewed: 2, progressed: 2 });
  });

  it('variant filter narrows the main block but not the variants block', async () => {
    const r = await get('?version=1&variant=B');
    expectKpis(r.kpis, kpis(4, 2, 2, 0));
    expect(r.steps.map((s) => s.stepId)).toEqual([...V1_B_ALL, 'result']);
    expect(r.variants.map((v) => [v.variant, v.kpis.started])).toEqual([
      ['A', 5],
      ['B', 4],
    ]);
  });

  it('A/B z-test on ctrFromStarted: one version, override sessions excluded (hand computation)', async () => {
    const r = await get('?version=1');
    // a4 is an override (QA) session → not part of the randomized test.
    // A: a1 a2 a3 a5 → 1/4 = 0.25, B: b1..b4 → 2/4 = 0.5; pooled 3/8;
    // se = sqrt(3/8 * 5/8 * (1/4 + 1/4)) = 0.3423266; z = 0.25 / se = 0.7302967; p = 2 * (1 - Φ(z)) = 0.465209
    expect(r.abTest).not.toBeNull();
    const ab = r.abTest as NonNullable<AnalyticsResponse['abTest']>;
    expect(ab.metric).toBe('ctrFromStarted');
    expect(ab.version).toBe(1);
    expect(ab.experimentId).toBe(EXPERIMENT[1]);
    expect(ab.overrideExcluded).toBe(1);
    expect(ab.otherVersions).toEqual([]);
    expect(ab.a).toMatchObject({ variant: 'A', rate: 0.25, n: 4 });
    expectKpis(ab.a.kpis, kpis(4, 2, 1, 1)); // a1 a2 a3 a5: reached a1 a2, cta a1, back a3
    expect(ab.b).toMatchObject({ variant: 'B', rate: 0.5, n: 4 });
    expectKpis(ab.b.kpis, kpis(4, 2, 2, 0)); // b1..b4: reached + cta b1 b3
    expect(ab.diffPp).toBeCloseTo(25, 10);
    expect(ab.z).toBeCloseTo(0.7302967, 6);
    expect(ab.pValue).toBeCloseTo(0.465209, 5);
    expect(ab.significant).toBe(false);
    expect(ab.enoughData).toBe(false);
    // The variants block (descriptive) still includes the override session.
    expect(r.variants[0]?.kpis.started).toBe(5);
  });

  it('A/B test never pools two experiments: version=all tests the active version only', async () => {
    const all = await get();
    const ab = all.abTest as NonNullable<AnalyticsResponse['abTest']>;
    // v1 is the active version in this fixture (v3 was inserted but never activated).
    expect(ab.version).toBe(1);
    expect(ab.otherVersions).toEqual([3]);
    expect(ab.a.n + ab.b.n).toBe(8); // v1 randomized only: no v3 sessions, no override

    const v3 = (await get('?version=3')).abTest as NonNullable<AnalyticsResponse['abTest']>;
    expect(v3).toMatchObject({ version: 3, experimentId: EXPERIMENT[3], overrideExcluded: 0, otherVersions: [] });
    expect(v3.a).toMatchObject({ variant: 'A', rate: 1, n: 1 });
    expect(v3.b).toMatchObject({ variant: 'B', rate: 0, n: 1 });

    // excludeOverride=1 removes a4 earlier, so nothing is left to exclude inside the test.
    const ex = (await get('?version=1&excludeOverride=1')).abTest as NonNullable<AnalyticsResponse['abTest']>;
    expect(ex.overrideExcluded).toBe(0);
    expect(ex.a.n).toBe(4);
  });

  it('step shares use eligible sessions (whose sequence has the step), not all started', async () => {
    const v3 = await get('?version=3');
    // tool_count exists only in v3 A (c1): 1 eligible, 1 viewed → 100%, flagged "only in A".
    const tool = v3.steps.find((s) => s.stepId === 'tool_count') as StepMetrics;
    expect(tool).toMatchObject({ eligible: 1, viewed: 1, onlyIn: 'A' });
    expect(tool.fromStart).toBe(1);
    const intro3 = v3.steps.find((s) => s.stepId === 'intro') as StepMetrics;
    expect(intro3).toMatchObject({ eligible: 2, onlyIn: null });

    const all = await get();
    const byId = new Map(all.steps.map((s) => [s.stepId, s]));
    // meeting_hours / security_constraints exist only in v3 (2 sessions); tool_count in v1 A+B and v3 A.
    expect(byId.get('meeting_hours')).toMatchObject({ eligible: 2, viewed: 2, onlyIn: 'v3' });
    expect(byId.get('meeting_hours')?.fromStart).toBe(1);
    expect(byId.get('security_constraints')).toMatchObject({ eligible: 2, viewed: 1, onlyIn: 'v3' });
    expect(byId.get('tool_count')).toMatchObject({ eligible: 10, onlyIn: 'v1, v3 A' });
    expect(byId.get('intro')).toMatchObject({ eligible: 11, onlyIn: null });
  });

  it('results distribution and CTR per result', async () => {
    const r = await get('?version=1');
    expect(r.results).toEqual([
      { resultId: 'async_native', title: 'Async-native', sessions: 2, ctaClicked: 2, ctr: 1 },
      { resultId: 'hybrid_structured', title: 'Structured hybrid', sessions: 2, ctaClicked: 2, ctr: 1 },
      { resultId: 'balanced', title: 'Balanced baseline', sessions: 1, ctaClicked: 0, ctr: 0 },
    ]);
  });

  it('campaign filter (incl. "(none)") and the campaigns block ignoring it', async () => {
    const meta = await get('?version=1&campaign=meta');
    expectKpis(meta.kpis, kpis(4, 3, 2, 0)); // a1 a2 b1 b4
    expect(meta.filters.campaigns).toEqual(['meta']);
    expect(meta.campaigns).toMatchObject([
      { campaign: 'meta', kpis: kpis(4, 3, 2, 0) },
      { campaign: '(none)', kpis: kpis(3, 1, 1, 1) },
      { campaign: 'google', kpis: kpis(2, 1, 1, 0) },
    ]);

    const none = await get(`?version=1&campaign=${encodeURIComponent('(none)')}`);
    expectKpis(none.kpis, kpis(3, 1, 1, 1)); // a3 a5 b3

    const both = await get(`?version=1&campaign=${encodeURIComponent('meta,(none)')}`);
    expectKpis(both.kpis, kpis(7, 4, 3, 1));
    expect(both.filters.campaigns).toEqual(['meta', '(none)']);
  });

  it('excludeOverride drops override sessions everywhere', async () => {
    const r = await get('?version=1&excludeOverride=1');
    expect(r.filters.excludeOverride).toBe(true);
    expectKpis(r.kpis, kpis(8, 4, 3, 1)); // without a4
    expectKpis(r.variants[0]?.kpis as Kpis, kpis(4, 2, 1, 1));
    expect(r.campaigns.find((c) => c.campaign === 'google')?.kpis.started).toBe(1);
    expect(r.versions.find((v) => v.version === 1)?.kpis.started).toBe(8);
    expect(r.available.campaigns).toEqual(['google', 'meta', '(none)']);
  });

  it('version comparison v1 vs v3 and extra events', async () => {
    const all = await get();
    expect(all.filters.version).toBe('all');
    expectKpis(all.kpis, kpis(11, 7, 5, 1));
    expect(all.versions).toMatchObject([
      { version: 1, kpis: kpis(9, 5, 4, 1) },
      { version: 3, kpis: kpis(2, 2, 1, 0) },
    ]);
    // Only the 2 v3 sessions could send it (v1 rejects the event) → share 1/2, not 1/11.
    expect(all.extraEvents).toEqual([{ name: 'recommendation_expanded', sessions: 1, eligible: 2 }]);

    // The version filter narrows the main block but the versions block ignores it.
    const v1 = await get('?version=1');
    expect(v1.versions.map((v) => v.kpis.started)).toEqual([9, 2]);
    expect(v1.extraEvents).toEqual([]); // v1 does not allow recommendation_expanded

    const v3 = await get('?version=3');
    expectKpis(v3.kpis, kpis(2, 2, 1, 0));
    expect(v3.extraEvents).toEqual([{ name: 'recommendation_expanded', sessions: 1, eligible: 2 }]);
    expect(v3.results).toEqual([
      { resultId: 'balanced', title: 'Balanced baseline', sessions: 1, ctaClicked: 0, ctr: 0 },
      { resultId: 'regulated_scale', title: 'Compliance-aware scale', sessions: 1, ctaClicked: 1, ctr: 1 },
    ]);
    // compliance branch: only c1 saw it; c2 (B, pos 7) got past it to the result (pos 9).
    const sec = expectStep(v3.steps, 'security_constraints', { arrived: 2, viewed: 1, progressed: 1 });
    expect(sec.conditional).toBe(true);
    expectStep(v3.steps, 'meeting_hours', { arrived: 2, viewed: 2, progressed: 2 });
    expectStep(v3.steps, 'office_days', { arrived: 2, viewed: 0, progressed: 0 });
    // tool_count exists only in v3 A's sequence.
    expectStep(v3.steps, 'tool_count', { arrived: 1, viewed: 1, progressed: 1 });
    expect(v3.variants.map((v) => [v.variant, v.kpis.started])).toEqual([
      ['A', 1],
      ['B', 1],
    ]);
    expect(v3.variants[1]?.steps.some((s) => s.stepId === 'tool_count')).toBe(false);
  });

  it('data quality: duplicates from batches, rejected count, out-of-order sessions in the cohort', async () => {
    const r = await get('?version=1');
    // Only b1 has shuffled client timestamps; a3's back navigation is not out of order.
    expect(r.dataQuality).toEqual({
      duplicatesDropped: 5,
      rejected: 1,
      outOfOrderSessions: 1,
      unverifiedResultSessions: 0,
    });
    const google = await get('?version=1&campaign=google');
    expect(google.dataQuality.outOfOrderSessions).toBe(0);
  });

  it('shuffled insertion/timestamps do not change the derived facts of b1', async () => {
    const r = await get('?version=1&variant=B&campaign=meta'); // b1 + b4
    expectKpis(r.kpis, kpis(2, 1, 1, 0));
    expectStep(r.steps, 'tool_count', { arrived: 1, viewed: 1, progressed: 1 });
    expectStep(r.steps, 'office_days', { arrived: 1, viewed: 1, progressed: 1 });
    expectStep(r.steps, 'work_mode', { arrived: 2, viewed: 2, progressed: 1 });
    expectStep(r.steps, 'result', { arrived: 1, viewed: 1, progressed: 1 });
  });

  it('empty cohort returns zeros and the configured step order', async () => {
    const r = await get('?version=1&campaign=nope');
    expectKpis(r.kpis, kpis(0, 0, 0, 0));
    expect(r.steps.map((s) => s.stepId)).toEqual([
      'intro',
      'work_mode',
      'team_size',
      'timezone_span',
      'priorities',
      'async_maturity',
      'office_days',
      'tool_count',
      'result',
    ]);
    expect(r.steps.every((s) => s.viewed === 0 && s.fromStart === 0)).toBe(true);
    expect(r.abTest).toMatchObject({ z: null, pValue: null, significant: false, enoughData: false });
    expect(r.results).toEqual([]);
  });

  it('rejects an invalid version filter with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics?version=abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
  });
});

describe('result reach needs a server-side result', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1 });
    seedFixture(app.ctx.db);
    // A forged session: result events (even on the result step) but POST /result never ran.
    insertSession(
      app.ctx.db,
      {
        id: 'sess-forged',
        version: 1,
        variant: 'A',
        source: 'hash',
        campaign: 'forged',
        resultId: null,
        events: [sv('intro'), rv('office_core'), cta('office_core')],
      },
      SESSIONS.length,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('client-only result events do not count as reached and do not invent a result id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics?version=1&campaign=forged' });
    const r = res.json<AnalyticsResponse>();
    expectKpis(r.kpis, kpis(1, 0, 0, 0));
    expect(r.results).toEqual([]);
    expect(r.dataQuality.unverifiedResultSessions).toBe(1);
    expectStep(r.steps, 'result', { arrived: 0, viewed: 0, progressed: 0 });

    // The rest of the fixture is unaffected.
    const v1 = (
      await app.inject({ method: 'GET', url: '/api/admin/analytics?version=1&campaign=meta' })
    ).json<AnalyticsResponse>();
    expectKpis(v1.kpis, kpis(4, 3, 2, 0));
    expect(v1.dataQuality.unverifiedResultSessions).toBe(0);
  });
});

describe('GET /api/admin/events', () => {
  let app: FastifyInstance;
  const TOTAL_EVENTS = 20 + 16 + 14 + 16 + 1 + 20 + 10 + 17 + 4 + 23 + 16;

  const get = async (qs = ''): Promise<AdminEventsResponse> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/events${qs}`,
      headers: { 'x-admin-token': 'secret' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<AdminEventsResponse>();
  };

  beforeAll(async () => {
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1, adminToken: 'secret' });
    seedFixture(app.ctx.db);
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns totals from ingest batches and recent rejections', async () => {
    const r = await get();
    expect(r.totals).toEqual({ batches: 2, received: 16, accepted: 10, duplicates: 5, rejected: 1 });
    expect(r.recentRejected).toEqual([
      { eventId: 'bad-event-1', reason: 'unknown_session', receivedAt: new Date(BASE).toISOString() },
    ]);
  });

  it('default limit 100, newest server_ts first', async () => {
    const r = await get();
    expect(r.events).toHaveLength(100);
    const ts = r.events.map((e) => e.serverTs);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect((await get('?limit=1000')).events).toHaveLength(TOTAL_EVENTS);
    expect((await get('?limit=5')).events).toHaveLength(5);
  });

  it('filters by session id and name', async () => {
    const a1 = await get('?sessionId=sess-a1');
    expect(a1.events).toHaveLength(20);
    expect(a1.events.every((e) => e.sessionId === 'sess-a1')).toBe(true);
    expect(a1.events[0]).toMatchObject({
      name: 'cta_clicked',
      stepId: 'result',
      funnelVersion: 1,
      variant: 'A',
      utmCampaign: 'meta',
      properties: { result_id: 'hybrid_structured', action: 'expand_recommendation' },
    });
    expect(a1.events.at(-1)).toMatchObject({ eventId: 'session_started:sess-a1', stepId: null });

    const ctas = await get('?name=cta_clicked');
    expect(ctas.events.map((e) => e.sessionId).sort()).toEqual(['sess-a1', 'sess-a4', 'sess-b1', 'sess-b3', 'sess-c1']);

    const a3Views = await get('?sessionId=sess-a3&name=step_viewed');
    expect(a3Views.events).toHaveLength(7);

    expect((await get('?sessionId=missing')).events).toEqual([]);
  });
});
