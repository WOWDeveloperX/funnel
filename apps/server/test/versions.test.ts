import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ActivateResponse,
  AdminSessionsResponse,
  AdminVersionsResponse,
  PublishResponse,
  SessionState,
  ValidateResponse,
} from '@funnel/shared';
import { configHash } from '../src/services/versions';
import { CONFIG_V3, SEED_V1, makeApp, readJson } from './helpers';

const RAW_V1 = readJson(SEED_V1);
const RAW_V3 = readJson(CONFIG_V3);
const TOKEN = 'test-token';

let app: FastifyInstance;

beforeEach(async () => {
  app = await makeApp({ adminToken: TOKEN });
});
afterEach(async () => {
  await app.close();
});

function post(url: string, payload: unknown = {}, token: string | null = TOKEN) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: token ? { 'x-admin-token': token } : {},
  });
}

function adminGet(url: string) {
  return app.inject({ method: 'GET', url, headers: { 'x-admin-token': TOKEN } });
}

async function versions(): Promise<AdminVersionsResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/admin/versions' });
  expect(res.statusCode).toBe(200);
  return res.json<AdminVersionsResponse>();
}

describe('auth', () => {
  it('aggregate GETs are open; session-level GETs and all POSTs need the token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/versions' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/versions/1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/analytics' })).statusCode).toBe(200);

    // Session ids are bearer capabilities for /api/sessions/:id (answers, PUT /state) → never public.
    for (const url of [
      '/api/admin/sessions',
      '/api/admin/events',
      '/api/admin/sessions?limit=5',
      '/api/admin/events/',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json(), url).toMatchObject({ error: 'unauthorized' });
      expect((await app.inject({ method: 'GET', url, headers: { 'x-admin-token': 'wrong' } })).statusCode, url).toBe(
        401,
      );
    }
    expect((await adminGet('/api/admin/sessions')).statusCode).toBe(200);
    expect((await adminGet('/api/admin/events')).statusCode).toBe(200);

    for (const [url, body] of [
      ['/api/admin/versions', { config: RAW_V3 }],
      ['/api/admin/versions/validate', { config: RAW_V3 }],
      ['/api/admin/versions/1/activate', {}],
      ['/api/admin/rollback', {}],
    ] as const) {
      const none = await post(url, body, null);
      expect(none.statusCode, url).toBe(401);
      expect(none.json()).toMatchObject({ error: 'unauthorized' });
      expect((await post(url, body, 'wrong')).statusCode, url).toBe(401);
    }
    // Nothing was published by the rejected requests.
    expect((await versions()).versions).toHaveLength(1);
  });

  it('percent-encoded paths cannot bypass the token (auth checks the matched route)', async () => {
    for (const url of ['/api/%61dmin/sessions', '/api/admin/%73essions', '/api/admin/%65vents']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
    for (const url of ['/api/%61dmin/rollback', '/api/admin/%72ollback', '/api/%61dmin/versions']) {
      expect((await post(url, { config: RAW_V3 }, null)).statusCode, url).toBe(401);
    }
    expect((await versions()).versions).toHaveLength(1);
  });

  it('unknown admin paths answer 401 without the token and a JSON 404 with it', async () => {
    for (const url of ['/api/admin/nope', '/api/admin/versions/1/nope']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      const known = await adminGet(url);
      expect(known.statusCode, url).toBe(404);
      expect(known.json(), url).toMatchObject({ error: 'not_found' });
    }
  });

  it('no token configured → no auth', async () => {
    const open = await makeApp();
    try {
      const res = await open.inject({ method: 'POST', url: '/api/admin/versions', payload: { config: RAW_V3 } });
      expect(res.statusCode).toBe(201);
    } finally {
      await open.close();
    }
  });
});

describe('list & detail', () => {
  it('lists the seeded version with the seed activation', async () => {
    const v = await versions();
    expect(v.funnelId).toBe('workstyle-planner');
    expect(v.activeVersion).toBe(1);
    expect(v.versions).toHaveLength(1);
    expect(v.versions[0]).toMatchObject({
      version: 1,
      title: "Find your team's operating style",
      releaseNote: null,
      isActive: true,
      configHash: configHash(RAW_V1),
      sessionCount: 0,
      inProgressCount: 0,
      completedCount: 0,
      eventNames: expect.arrayContaining(['session_started', 'cta_clicked']),
    });
    expect(v.versions[0]!.variants.map((x) => [x.key, x.stepCount])).toEqual([
      ['A', 9],
      ['B', 9],
    ]);
    expect(v.activations).toEqual([
      { id: expect.any(Number), version: 1, previousVersion: null, action: 'seed', createdAt: expect.any(String) },
    ]);
  });

  it('GET /admin/versions/:version returns the parsed config, 404 for unknown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/versions/1' });
    expect(res.json()).toMatchObject({ version: 1, config: { funnelId: 'workstyle-planner', version: 1 } });
    const missing = await app.inject({ method: 'GET', url: '/api/admin/versions/42' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });
    expect((await app.inject({ method: 'GET', url: '/api/admin/versions/abc' })).statusCode).toBe(400);
  });

  it('counts sessions per version', async () => {
    const mk = async () =>
      (await app.inject({ method: 'POST', url: '/api/sessions', payload: {} })).json<SessionState>();
    const done = await mk();
    await mk();
    const expired = await mk();
    app.ctx.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', expired.sessionId);
    const r = await app.inject({
      method: 'POST',
      url: `/api/sessions/${done.sessionId}/result`,
      payload: {
        answers: {
          team_size: 3,
          work_mode: 'office',
          priorities: ['cost'],
          timezone_span: 'same',
          office_days: 5,
          async_maturity: 'low',
          tool_count: 4,
        },
      },
    });
    expect(r.json()).toMatchObject({ resultId: 'office_core' });

    expect((await versions()).versions[0]).toMatchObject({ sessionCount: 3, inProgressCount: 1, completedCount: 1 });

    const sessions = (await adminGet('/api/admin/sessions?limit=10')).json<AdminSessionsResponse>();
    expect(sessions.sessions).toHaveLength(3);
    const byId = new Map(sessions.sessions.map((s) => [s.id, s]));
    expect(byId.get(done.sessionId)).toMatchObject({
      status: 'completed',
      resultId: 'office_core',
      currentStepId: 'result',
      eventCount: 1,
    });
    expect(byId.get(expired.sessionId)?.status).toBe('expired');
    expect(sessions.totals).toEqual({ all: 3, in_progress: 1, completed: 1, expired: 1 });
    // Totals ignore the page size.
    expect((await adminGet('/api/admin/sessions?limit=1')).json<AdminSessionsResponse>().totals.all).toBe(3);
    const filtered = (await adminGet('/api/admin/sessions?version=3')).json<AdminSessionsResponse>();
    expect(filtered.sessions).toHaveLength(0);
    expect(filtered.totals).toEqual({ all: 0, in_progress: 0, completed: 0, expired: 0 });
    expect((await adminGet('/api/admin/sessions?limit=0')).statusCode).toBe(400);
  });
});

describe('validate', () => {
  it('reports summary, diff vs active and existing state', async () => {
    const res = await post('/api/admin/versions/validate', { config: RAW_V3 });
    expect(res.statusCode).toBe(200);
    const v = res.json<ValidateResponse>();
    expect(v).toMatchObject({ ok: true, errors: [], existing: 'new' });
    expect(v.summary).toMatchObject({ funnelId: 'workstyle-planner', version: 3 });
    expect(v.summary!.eventNames).toContain('recommendation_expanded');
    expect(v.diff).toMatchObject({ fromVersion: 1, toVersion: 3 });
    expect(v.diff!.stepsAdded).toEqual(expect.arrayContaining(['meeting_hours', 'security_constraints']));
    expect(v.diff!.eventsAdded).toEqual(['recommendation_expanded']);
    expect(v.diff!.variants.B!.removed).toEqual(['tool_count']);

    expect((await post('/api/admin/versions/validate', { config: RAW_V1 })).json()).toMatchObject({
      ok: true,
      existing: 'identical',
    });
    expect(
      (await post('/api/admin/versions/validate', { config: { ...RAW_V1, title: 'Changed' } })).json(),
    ).toMatchObject({ ok: true, existing: 'conflict' });
  });

  it('returns errors for an invalid config (200, ok=false)', async () => {
    const res = await post('/api/admin/versions/validate', { config: { funnelId: 'x' } });
    expect(res.statusCode).toBe(200);
    const v = res.json<ValidateResponse>();
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
    expect(v.summary).toBeNull();
    expect(v.diff).toBeNull();
  });

  it('400 when the body has no config', async () => {
    const res = await post('/api/admin/versions/validate', { nope: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
  });
});

describe('publish', () => {
  it('publishes a valid config and activates it (201)', async () => {
    const res = await post('/api/admin/versions', { config: RAW_V3 });
    expect(res.statusCode).toBe(201);
    expect(res.json<PublishResponse>()).toEqual({ version: 3, activeVersion: 3, action: 'publish' });

    const v = await versions();
    expect(v.activeVersion).toBe(3);
    expect(v.versions.map((x) => [x.version, x.isActive])).toEqual([
      [3, true],
      [1, false],
    ]);
    expect(v.versions[0]).toMatchObject({
      releaseNote: RAW_V3.releaseNote,
      configHash: configHash(RAW_V3),
    });
    expect(v.activations.map((a) => [a.action, a.version, a.previousVersion])).toEqual([
      ['publish', 3, 1],
      ['seed', 1, null],
    ]);
    // Stored as uploaded.
    const row = app.ctx.db.prepare('SELECT config_json FROM funnel_versions WHERE version = 3').get() as {
      config_json: string;
    };
    expect(JSON.parse(row.config_json)).toEqual(RAW_V3);
  });

  it('422 with the validation report for an invalid config', async () => {
    const broken = structuredClone(RAW_V3) as { experiment: { variants: { A: { stepSequence: string[] } } } };
    broken.experiment.variants.A.stepSequence.push('ghost_step');
    const res = await post('/api/admin/versions', { config: broken });
    expect(res.statusCode).toBe(422);
    const body = res.json<ValidateResponse>();
    expect(body.ok).toBe(false);
    expect(body.errors.join('\n')).toContain('ghost_step');
    expect((await versions()).activeVersion).toBe(1);
  });

  it('409 when the same version is published with different content', async () => {
    const res = await post('/api/admin/versions', { config: { ...RAW_V1, title: 'Sneaky edit' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'version_conflict', message: expect.any(String) });
  });

  it('re-publishing an identical version is idempotent (200 activate)', async () => {
    expect((await post('/api/admin/versions', { config: RAW_V3 })).statusCode).toBe(201);
    const again = await post('/api/admin/versions', { config: RAW_V3 });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ version: 3, activeVersion: 3, action: 'activate' });
    // Already active → no extra activation row.
    expect((await versions()).activations).toHaveLength(2);

    // Identical re-publish of an older version activates it (an explicit activation → pushed).
    const v1 = await post('/api/admin/versions', { config: RAW_V1 });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toEqual({ version: 1, activeVersion: 1, action: 'activate' });
    const v = await versions();
    expect(v.activeVersion).toBe(1);
    expect(v.activations[0]).toMatchObject({ action: 'activate', version: 1, previousVersion: 3 });
    expect(v.versions).toHaveLength(2);
  });

  it('400 when the body has no config', async () => {
    expect((await post('/api/admin/versions', {})).statusCode).toBe(400);
  });
});

describe('activate & rollback', () => {
  it('activates any stored version (explicit activation is always logged as activate)', async () => {
    await post('/api/admin/versions', { config: RAW_V3 });

    const down = await post('/api/admin/versions/1/activate');
    expect(down.statusCode).toBe(200);
    expect(down.json<ActivateResponse>()).toEqual({ activeVersion: 1, previousVersion: 3 });

    const up = await post('/api/admin/versions/3/activate?funnelId=workstyle-planner');
    expect(up.json<ActivateResponse>()).toEqual({ activeVersion: 3, previousVersion: 1 });

    const same = await post('/api/admin/versions/3/activate');
    expect(same.json<ActivateResponse>()).toEqual({ activeVersion: 3, previousVersion: 3 });

    const v = await versions();
    expect(v.activations.map((a) => [a.action, a.version, a.previousVersion])).toEqual([
      ['activate', 3, 1],
      ['activate', 1, 3],
      ['publish', 3, 1],
      ['seed', 1, null],
    ]);

    const missing = await post('/api/admin/versions/9/activate');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });
  });

  it('rollback re-activates the previously active version', async () => {
    await post('/api/admin/versions', { config: RAW_V3 });
    const rb = await post('/api/admin/rollback');
    expect(rb.statusCode).toBe(200);
    expect(rb.json<ActivateResponse>()).toEqual({ activeVersion: 1, previousVersion: 3 });
    const v = await versions();
    expect(v.activeVersion).toBe(1);
    expect(v.activations[0]).toMatchObject({ action: 'rollback', version: 1, previousVersion: 3 });
    // History is kept.
    expect(v.versions.map((x) => x.version)).toEqual([3, 1]);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ activeVersion: 1 });
  });

  const V4 = () => ({ ...RAW_V3, version: 4, releaseNote: 'v4' });

  it('repeated rollbacks walk back through history (stack), never forward', async () => {
    expect((await post('/api/admin/versions', { config: RAW_V3 })).statusCode).toBe(201);
    expect((await post('/api/admin/versions', { config: V4() })).statusCode).toBe(201);
    expect((await versions()).rollbackTarget).toBe(3);

    const rb1 = await post('/api/admin/rollback');
    expect(rb1.json<ActivateResponse>()).toEqual({ activeVersion: 3, previousVersion: 4 });
    expect((await versions()).rollbackTarget).toBe(1);

    const rb2 = await post('/api/admin/rollback');
    expect(rb2.json<ActivateResponse>()).toEqual({ activeVersion: 1, previousVersion: 3 });
    expect((await versions()).rollbackTarget).toBeNull();

    const rb3 = await post('/api/admin/rollback');
    expect(rb3.statusCode).toBe(409);
    expect(rb3.json()).toMatchObject({ error: 'no_previous_version' });

    const v = await versions();
    expect(v.activeVersion).toBe(1);
    // Append-only log: every move is recorded, rollbacks always step down the stack.
    expect(v.activations.map((a) => [a.action, a.version, a.previousVersion])).toEqual([
      ['rollback', 1, 3],
      ['rollback', 3, 4],
      ['publish', 4, 3],
      ['publish', 3, 1],
      ['seed', 1, null],
    ]);
  });

  it('two versions: publish → rollback → rollback = 409 (no toggling)', async () => {
    await post('/api/admin/versions', { config: RAW_V3 });
    expect((await post('/api/admin/rollback')).json<ActivateResponse>()).toEqual({
      activeVersion: 1,
      previousVersion: 3,
    });
    const again = await post('/api/admin/rollback');
    expect(again.statusCode).toBe(409);
    expect((await versions()).activeVersion).toBe(1);
  });

  it('re-publishing an identical version after a rollback pushes it again', async () => {
    await post('/api/admin/versions', { config: RAW_V3 });
    await post('/api/admin/rollback');
    const again = await post('/api/admin/versions', { config: RAW_V3 });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ version: 3, activeVersion: 3, action: 'activate' });
    expect((await versions()).rollbackTarget).toBe(1);
    expect((await post('/api/admin/rollback')).json<ActivateResponse>()).toEqual({
      activeVersion: 1,
      previousVersion: 3,
    });
    expect((await post('/api/admin/rollback')).statusCode).toBe(409);
  });

  it('explicit activation of an older version is a push: rollback returns to where you were', async () => {
    await post('/api/admin/versions', { config: RAW_V3 });
    await post('/api/admin/versions', { config: V4() });
    await post('/api/admin/versions/1/activate'); // stack 1,3,4,1
    expect((await versions()).rollbackTarget).toBe(4);
    expect((await post('/api/admin/rollback')).json<ActivateResponse>()).toEqual({
      activeVersion: 4,
      previousVersion: 1,
    });
    expect((await post('/api/admin/rollback')).json<ActivateResponse>()).toEqual({
      activeVersion: 3,
      previousVersion: 4,
    });
    expect((await post('/api/admin/rollback')).json<ActivateResponse>()).toEqual({
      activeVersion: 1,
      previousVersion: 3,
    });
    expect((await post('/api/admin/rollback')).statusCode).toBe(409);
  });

  it('409 when there is no previous version', async () => {
    const res = await post('/api/admin/rollback');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'no_previous_version' });
    expect((await post('/api/admin/rollback', { funnelId: 'unknown-funnel' })).statusCode).toBe(409);
  });
});
