import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { type FunnelConfig, type SessionState, assignVariant, parseConfig } from '@funnel/shared';
import { CONFIG_V3, SEED_V1, makeApp, readJson } from './helpers';

const RAW_V1 = readJson(SEED_V1);
const RAW_V3 = readJson(CONFIG_V3);
const TOKEN = 'test-token';

/** Complete, valid v1 answers (remote → office_days hidden) → `async_native`. */
const V1_ANSWERS = {
  team_size: 8,
  work_mode: 'remote',
  priorities: ['speed', 'focus'],
  timezone_span: 'wide',
  async_maturity: 'medium',
  tool_count: 6,
};

/** Complete v3 answers that open the compliance branch → `regulated_scale`. */
const V3_ANSWERS = {
  team_size: 40,
  work_mode: 'hybrid',
  priorities: ['compliance', 'speed'],
  security_constraints: 'strict',
  timezone_span: 'same',
  office_days: 2,
  meeting_hours: 6,
  async_maturity: 'low',
  tool_count: 9,
};

let app: FastifyInstance;

beforeEach(async () => {
  app = await makeApp({ adminToken: TOKEN });
});
afterEach(async () => {
  await app.close();
});

async function create(query: Record<string, string> = {}): Promise<SessionState> {
  const res = await app.inject({ method: 'POST', url: '/api/sessions', payload: { query } });
  expect(res.statusCode).toBe(201);
  return res.json<SessionState>();
}

async function get(id: string) {
  return app.inject({ method: 'GET', url: `/api/sessions/${id}` });
}

async function admin(url: string, payload: unknown = {}) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-admin-token': TOKEN } });
}

async function submit(id: string, answers: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/sessions/${id}/result`, payload: { answers } });
}

describe('session creation', () => {
  it('pins the active version, captures UTM and writes the server-side session_started event', async () => {
    const s = await create({ utm_source: '  meta ', utm_medium: '', utm_campaign: 'x'.repeat(150), other: 'ignored' });
    expect(s.funnelId).toBe('workstyle-planner');
    expect(s.funnelVersion).toBe(1);
    expect(s.funnel.version).toBe(1);
    expect(s.funnel.variant).toBe(s.variant);
    expect(s.experimentId).toBe('question-order-and-result-framing-v1');
    expect(s.utm).toEqual({ source: 'meta', medium: null, campaign: 'x'.repeat(100) });
    expect(s.answers).toEqual({});
    expect(s.currentStepId).toBeNull();
    expect(s.resultId).toBeNull();
    // expires_at = created_at + 72h
    expect(Date.parse(s.expiresAt) - Date.parse(s.createdAt)).toBe(72 * 3_600_000);

    const ev = app.ctx.db.prepare('SELECT * FROM events WHERE session_id = ?').all(s.sessionId) as Record<
      string,
      unknown
    >[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      event_id: `session_started:${s.sessionId}`,
      name: 'session_started',
      step_id: null,
      funnel_version: 1,
      variant: s.variant,
      utm_source: 'meta',
      utm_campaign: 'x'.repeat(100),
    });
  });

  it('only sends the pinned variant (no data of the other variant)', async () => {
    const s = await create({ variant: 'B' });
    expect(s.funnel.stepSequence[1]).toBe('work_mode');
    expect(s.funnel.steps.intro?.content.title).toBe('How should your team really work?');
    expect(JSON.stringify(s.funnel)).not.toContain('"stepOverrides"');
  });

  it('accepts a request without a body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions' });
    expect(res.statusCode).toBe(201);
  });

  it('404 for an unknown funnel, 400 for a malformed body', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/api/sessions', payload: { funnelId: 'nope' } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: 'not_found' });
    const bad = await app.inject({ method: 'POST', url: '/api/sessions', payload: { funnelId: 42 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'bad_request' });
  });
});

describe('version pinning', () => {
  it('old sessions stay on their version across publish and rollback; new sessions follow the active one', async () => {
    const old = await create();
    expect(old.funnelVersion).toBe(1);

    const pub = await admin('/api/admin/versions', { config: RAW_V3 });
    expect(pub.statusCode).toBe(201);

    // The v1 session is still served v1: no compliance branch, no recommendation_expanded.
    const oldAgain = (await get(old.sessionId)).json<SessionState>();
    expect(oldAgain.funnelVersion).toBe(1);
    expect(oldAgain.funnel.version).toBe(1);
    expect(oldAgain.funnel.stepSequence).not.toContain('security_constraints');
    expect(oldAgain.funnel.steps).not.toHaveProperty('security_constraints');
    expect(oldAgain.funnel.steps).not.toHaveProperty('meeting_hours');
    expect(oldAgain.funnel.events.allowed.map((e) => e.name)).not.toContain('recommendation_expanded');

    // ... and can finish on v1 rules.
    const result = await submit(old.sessionId, V1_ANSWERS);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ resultId: 'async_native', result: { id: 'async_native' } });

    // New sessions get v3.
    const fresh = await create();
    expect(fresh.funnelVersion).toBe(3);
    expect(fresh.funnel.stepSequence).toContain('security_constraints');
    expect(fresh.funnel.events.allowed.map((e) => e.name)).toContain('recommendation_expanded');
    const v3Result = await submit(fresh.sessionId, V3_ANSWERS);
    expect(v3Result.statusCode).toBe(200);
    expect(v3Result.json()).toMatchObject({ resultId: 'regulated_scale' });

    // Rollback: new sessions → v1, the v3 session stays on v3.
    const rb = await admin('/api/admin/rollback');
    expect(rb.statusCode).toBe(200);
    expect(rb.json()).toEqual({ activeVersion: 1, previousVersion: 3 });

    const afterRollback = await create();
    expect(afterRollback.funnelVersion).toBe(1);
    const v3Again = (await get(fresh.sessionId)).json<SessionState>();
    expect(v3Again.funnelVersion).toBe(3);
    expect(v3Again.funnel.stepSequence).toContain('security_constraints');
    expect(v3Again.resultId).toBe('regulated_scale');
  });

  it('a v1 session cannot be completed with v3-only answers', async () => {
    const old = await create();
    await admin('/api/admin/versions', { config: RAW_V3 });
    const res = await submit(old.sessionId, { ...V1_ANSWERS, priorities: ['compliance'] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_answers', details: { priorities: expect.any(String) } });
  });
});

describe('state & refresh', () => {
  it('PUT /state persists answers and current step; repeated GETs return the same state', async () => {
    const s = await create();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${s.sessionId}/state`,
      payload: {
        answers: { team_size: 12, work_mode: 'hybrid', bogus: 'dropped', priorities: ['speed'], tool_count: { x: 1 } },
        currentStepId: 'work_mode',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ok: true, updatedAt: expect.any(String) });

    const a = (await get(s.sessionId)).json<SessionState>();
    const b = (await get(s.sessionId)).json<SessionState>();
    expect(a.answers).toEqual({ team_size: 12, work_mode: 'hybrid', priorities: ['speed'] });
    expect(a.currentStepId).toBe('work_mode');
    expect(b.answers).toEqual(a.answers);
    expect(b.currentStepId).toBe(a.currentStepId);
    expect(b.variant).toBe(s.variant);
    expect(b.funnelVersion).toBe(1);
  });

  it('last write wins and answers of hidden steps are kept', async () => {
    const s = await create();
    const put = (answers: Record<string, unknown>, currentStepId: string | null) =>
      app.inject({ method: 'PUT', url: `/api/sessions/${s.sessionId}/state`, payload: { answers, currentStepId } });
    await put({ work_mode: 'hybrid', office_days: 3 }, 'office_days');
    await put({ work_mode: 'remote', office_days: 3 }, null);
    const state = (await get(s.sessionId)).json<SessionState>();
    expect(state.answers).toEqual({ work_mode: 'remote', office_days: 3 });
    expect(state.currentStepId).toBeNull();
  });

  it('rejects an unknown currentStepId and malformed bodies', async () => {
    const s = await create();
    const unknownStep = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${s.sessionId}/state`,
      payload: { answers: {}, currentStepId: 'security_constraints' },
    });
    expect(unknownStep.statusCode).toBe(400);
    const malformed = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${s.sessionId}/state`,
      payload: { answers: [] },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: 'bad_request' });
  });

  it('404 for unknown sessions, 410 once the TTL has passed', async () => {
    const missing = await get('does-not-exist');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });

    const s = await create();
    app.ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', s.sessionId);
    const expired = await get(s.sessionId);
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({ error: 'expired' });
    const put = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${s.sessionId}/state`,
      payload: { answers: {}, currentStepId: null },
    });
    expect(put.statusCode).toBe(410);
    expect((await submit(s.sessionId, V1_ANSWERS)).statusCode).toBe(410);
  });
});

describe('result', () => {
  it('validates visible steps only, stores result + result step, and is idempotent', async () => {
    const s = await create();

    const incomplete = await submit(s.sessionId, { work_mode: 'hybrid' });
    expect(incomplete.statusCode).toBe(400);
    const details = incomplete.json<{ details: Record<string, string> }>().details;
    // office_days is visible for hybrid → required; messages come from the config.
    expect(details).toMatchObject({ team_size: 'Enter the team size.', office_days: expect.any(String) });
    expect(details).not.toHaveProperty('work_mode');

    // Remote hides office_days, so a stale office_days answer is ignored (and kept).
    const answers = { ...V1_ANSWERS, office_days: 9 };
    const first = await submit(s.sessionId, answers);
    expect(first.statusCode).toBe(200);
    const second = await submit(s.sessionId, answers);
    expect(second.json()).toEqual(first.json());

    const state = (await get(s.sessionId)).json<SessionState>();
    expect(state.resultId).toBe('async_native');
    expect(state.currentStepId).toBe('result');
    expect(state.answers).toEqual(answers);
  });

  it('serves variant B result overrides', async () => {
    const s = await create({ variant: 'B' });
    const res = await submit(s.sessionId, V1_ANSWERS);
    expect(res.json()).toMatchObject({
      resultId: 'async_native',
      result: { title: 'Your team is ready to reduce meetings', cta: { label: 'See the 30-day action list' } },
    });
  });

  it('number answers must be numbers', async () => {
    const s = await create();
    const res = await submit(s.sessionId, { ...V1_ANSWERS, team_size: '8' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: { team_size: expect.any(String) } });
  });
});

describe('A/B assignment', () => {
  it('variant is stable across GETs and matches the deterministic hash', async () => {
    const s = await create();
    expect(s.variantSource).toBe('hash');
    const config = parseConfig(RAW_V1);
    expect(s.variant).toBe(assignVariant(config.experiment, s.sessionId));
    for (let i = 0; i < 3; i++) {
      const again = (await get(s.sessionId)).json<SessionState>();
      expect(again.variant).toBe(s.variant);
      expect(again.variantSource).toBe('hash');
    }
  });

  it('honours ?variant= at creation (override), ignores invalid values', async () => {
    for (const v of ['A', 'B']) {
      const s = await create({ variant: v });
      expect(s.variant).toBe(v);
      expect(s.variantSource).toBe('override');
      expect(s.funnel.variant).toBe(v);
      expect((await get(s.sessionId)).json<SessionState>().variant).toBe(v);
    }
    const invalid = await create({ variant: 'Z' });
    expect(invalid.variantSource).toBe('hash');
    expect(['A', 'B']).toContain(invalid.variant);
  });

  it('uses the override param named by the active config', async () => {
    const custom = structuredClone(RAW_V1) as unknown as FunnelConfig;
    custom.version = 2;
    custom.experiment.overrideQueryParam = 'ab';
    expect((await admin('/api/admin/versions', { config: custom })).statusCode).toBe(201);

    const viaAb = await create({ ab: 'B' });
    expect(viaAb).toMatchObject({ funnelVersion: 2, variant: 'B', variantSource: 'override' });
    const viaVariant = await create({ variant: 'B' });
    expect(viaVariant.variantSource).toBe('hash');
  });

  it('assignVariant is deterministic', () => {
    const exp = parseConfig(RAW_V1).experiment;
    for (const id of ['a', 'session-1', '7f1e2c3d-0000-4000-8000-000000000000']) {
      expect(assignVariant(exp, id)).toBe(assignVariant(exp, id));
    }
  });

  it('splits roughly evenly over many sessions', async () => {
    const counts: Record<string, number> = { A: 0, B: 0 };
    const n = 400;
    for (let i = 0; i < n; i++) {
      const s = await create();
      counts[s.variant] = (counts[s.variant] ?? 0) + 1;
    }
    expect(counts.A! + counts.B!).toBe(n);
    // 50/50 weights: expect within ±10 p.p. (≈ 4 standard deviations).
    expect(counts.A).toBeGreaterThan(n * 0.4);
    expect(counts.B).toBeGreaterThan(n * 0.4);
  });
});
