/**
 * Guardrail metric Kpis.medianTimeToResultSec. Sessions/events are inserted directly; the server-side
 * session_started carries no client_ts (as in production). Hand-computed per session (T = created_at):
 *
 *   t1 A x  intro +2s, team_size +30s, result_viewed +62s, cta +70s       → 62 - 2  = 60
 *   t2 A x  intro +10s, team_size +1s (skewed earlier), result_viewed +41s → 41 - 1  = 40
 *   t3 B x  intro +100s, result_viewed +50s (client clock jumped back)    → -50 → clamped 0
 *   t4 B y  only result_viewed +90s → start falls back to created_at      → 90
 *   t5 B z  reached (result_id set) but only cta_clicked arrived          → not measurable (excluded)
 *   t6 A z  result_viewed but no server result (unverified)               → not reached (excluded)
 *   t7 A z  intro only                                                    → not reached (excluded)
 *
 * all: [0, 40, 60, 90] → (40 + 60) / 2 = 50;  A: [40, 60] → 50;  B: [0, 90] → 45;
 * campaign x: [0, 40, 60] → 40;  y: [90] → 90;  z: none → null.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnalyticsResponse } from '@funnel/shared';
import { buildApp } from '../src/app';
import type { DB } from '../src/db';
import { median } from '../src/services/analytics/stats';
import { SEED_V1 } from './helpers';

const FUNNEL = 'workstyle-planner';
const EXPERIMENT = 'question-order-and-result-framing-v1';
const BASE = Date.parse('2026-10-02T09:00:00.000Z');

interface TEv {
  name: string;
  step: string | null;
  /** Seconds after created_at (client clock). */
  at: number;
}

interface TSession {
  id: string;
  variant: 'A' | 'B';
  campaign: string;
  resultId: string | null;
  events: TEv[];
}

const SESSIONS: TSession[] = [
  {
    id: 't1',
    variant: 'A',
    campaign: 'x',
    resultId: 'balanced',
    events: [
      { name: 'step_viewed', step: 'intro', at: 2 },
      { name: 'step_viewed', step: 'team_size', at: 30 },
      { name: 'result_viewed', step: 'result', at: 62 },
      { name: 'cta_clicked', step: 'result', at: 70 },
    ],
  },
  {
    id: 't2',
    variant: 'A',
    campaign: 'x',
    resultId: 'balanced',
    events: [
      { name: 'step_viewed', step: 'intro', at: 10 },
      { name: 'step_viewed', step: 'team_size', at: 1 },
      { name: 'result_viewed', step: 'result', at: 41 },
    ],
  },
  {
    id: 't3',
    variant: 'B',
    campaign: 'x',
    resultId: 'balanced',
    events: [
      { name: 'step_viewed', step: 'intro', at: 100 },
      { name: 'result_viewed', step: 'result', at: 50 },
    ],
  },
  {
    id: 't4',
    variant: 'B',
    campaign: 'y',
    resultId: 'balanced',
    events: [{ name: 'result_viewed', step: 'result', at: 90 }],
  },
  {
    id: 't5',
    variant: 'B',
    campaign: 'z',
    resultId: 'balanced',
    events: [{ name: 'cta_clicked', step: 'result', at: 20 }],
  },
  { id: 't6', variant: 'A', campaign: 'z', resultId: null, events: [{ name: 'result_viewed', step: 'result', at: 5 }] },
  { id: 't7', variant: 'A', campaign: 'z', resultId: null, events: [{ name: 'step_viewed', step: 'intro', at: 1 }] },
];

function seed(db: DB): void {
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, funnel_id, funnel_version, experiment_id, variant, variant_source,
                           utm_source, utm_medium, utm_campaign, answers_json, current_step_id, result_id,
                           created_at, updated_at, expires_at)
     VALUES (?, ?, 1, ?, ?, 'hash', NULL, NULL, ?, '{}', NULL, ?, ?, ?, '2099-01-01T00:00:00.000Z')`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (event_id, session_id, name, step_id, funnel_id, funnel_version, experiment_id, variant,
                         utm_source, utm_medium, utm_campaign, client_ts, server_ts, properties_json, batch_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?, ?, '{}', NULL)`,
  );
  SESSIONS.forEach((s, i) => {
    const created = BASE + i * 3_600_000;
    const createdIso = new Date(created).toISOString();
    insertSession.run(s.id, FUNNEL, EXPERIMENT, s.variant, s.campaign, s.resultId, createdIso, createdIso);
    // Server-side session_started: no client timestamp.
    insertEvent.run(
      `session_started:${s.id}`,
      s.id,
      'session_started',
      null,
      FUNNEL,
      EXPERIMENT,
      s.variant,
      s.campaign,
      null,
      createdIso,
    );
    s.events.forEach((e, k) => {
      insertEvent.run(
        `${s.id}-e${k}`,
        s.id,
        e.name,
        e.step,
        FUNNEL,
        EXPERIMENT,
        s.variant,
        s.campaign,
        new Date(created + e.at * 1000).toISOString(),
        new Date(created + 200_000 + k).toISOString(),
      );
    });
  });
}

describe('median helper', () => {
  it('odd, even, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });
});

describe('Kpis.medianTimeToResultSec', () => {
  let app: FastifyInstance;
  const get = async (qs = ''): Promise<AnalyticsResponse> => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/analytics${qs}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<AnalyticsResponse>();
  };

  beforeAll(async () => {
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1 });
    seed(app.ctx.db);
  });
  afterAll(async () => {
    await app.close();
  });

  it('overall: skew clamps to 0, created_at fallback, unmeasurable sessions excluded', async () => {
    const r = await get();
    expect(r.kpis.reachedResult).toBe(5); // t1..t5
    expect(r.kpis.medianTimeToResultSec).toBe(50);
  });

  it('per variant, per version, per campaign', async () => {
    const r = await get();
    expect(Object.fromEntries(r.variants.map((v) => [v.variant, v.kpis.medianTimeToResultSec]))).toEqual({
      A: 50,
      B: 45,
    });
    expect(r.versions.find((v) => v.version === 1)?.kpis.medianTimeToResultSec).toBe(50);
    expect(Object.fromEntries(r.campaigns.map((c) => [c.campaign, c.kpis.medianTimeToResultSec]))).toEqual({
      x: 40,
      y: 90,
      z: null,
    });
  });

  it('filters narrow the main block', async () => {
    expect((await get('?campaign=x')).kpis.medianTimeToResultSec).toBe(40);
    expect((await get('?variant=B')).kpis.medianTimeToResultSec).toBe(45);
    expect((await get('?campaign=z')).kpis.medianTimeToResultSec).toBeNull();
  });

  it('A/B arms carry their full KPI set, including the guardrail', async () => {
    const ab = (await get()).abTest as NonNullable<AnalyticsResponse['abTest']>;
    expect(ab.a.kpis).toMatchObject({ started: 4, reachedResult: 2, ctaClicked: 1, medianTimeToResultSec: 50 });
    expect(ab.b.kpis).toMatchObject({ started: 3, reachedResult: 3, ctaClicked: 1, medianTimeToResultSec: 45 });
    expect(ab.a.n).toBe(ab.a.kpis.started);
    expect(ab.a.rate).toBe(ab.a.kpis.ctrFromStarted);
  });
});
