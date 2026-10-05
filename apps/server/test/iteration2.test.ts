/**
 * Second iteration, end to end through the HTTP API (one app, ordered steps):
 *
 *   1. v1 is active; three sessions start on v1 (one forced to B) and save partial progress
 *   2. configs/funnel-v3.json is published without a restart
 *   3. new sessions run v3: B has no tool_count; "compliance" opens security_constraints
 *   4. recommendation_expanded is accepted for v3 sessions and rejected for v1 sessions
 *   5. the old sessions resume and finish on v1
 *   6. rollback: new sessions are v1 again, an in-progress v3 session stays on v3 and finishes
 *   7. analytics keeps both versions
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  type ActivateResponse,
  type AdminEventsResponse,
  type AnalyticsResponse,
  type FunnelConfig,
  type SessionState,
  type SubmitResultResponse,
  computeResultId,
  computeVisibility,
  parseConfig,
} from '@funnel/shared';
import {
  CONFIG_V3,
  SEED_V1,
  adminGet,
  adminPost,
  createSession,
  ingest,
  makeApp,
  makeEvent,
  readJson,
} from './helpers';

const TOKEN = 'iteration2-token';
const RAW_V3 = readJson(CONFIG_V3);
const V1: FunnelConfig = parseConfig(readJson(SEED_V1));
const V3: FunnelConfig = parseConfig(RAW_V3);

/** Partial progress saved by the old v1 sessions before v3 is published. */
const V1_PARTIAL = { team_size: 12, work_mode: 'remote' };
/** Complete v1 answers (remote → office_days hidden) → async_native. */
const V1_ANSWERS = {
  ...V1_PARTIAL,
  priorities: ['speed'],
  timezone_span: 'wide',
  async_maturity: 'medium',
  tool_count: 6,
};
/** Complete v3 answers that open the compliance branch → regulated_scale. */
const V3_COMPLIANCE_ANSWERS = {
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
/** Complete v3 variant B answers (no tool_count, no compliance) → meeting_heavy. */
const V3_B_ANSWERS = {
  team_size: 5,
  work_mode: 'remote',
  meeting_hours: 20,
  timezone_span: 'wide',
  async_maturity: 'low',
  priorities: ['speed'],
};
const EXPANDED = {
  name: 'recommendation_expanded',
  step_id: 'result',
  properties: { result_id: 'regulated_scale', action: 'expand_recommendation', source: 'result_cta' },
};

describe('second iteration: publish v3 while v1 sessions are mid-flow, then roll back', () => {
  let app: FastifyInstance;
  const oldSessions: SessionState[] = [];
  let v3A: SessionState;
  let v3B: SessionState;

  const getSession = async (id: string): Promise<SessionState> => {
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<SessionState>();
  };
  const submit = (id: string, answers: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/sessions/${id}/result`, payload: { answers } });
  const analytics = async (qs: string): Promise<AnalyticsResponse> => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/analytics${qs}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<AnalyticsResponse>();
  };

  beforeAll(async () => {
    app = await makeApp({ adminToken: TOKEN });
  });
  afterAll(async () => {
    await app.close();
  });

  it('1. v1 is active; old sessions start on v1 and save partial progress', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ activeVersion: 1 });

    oldSessions.push(
      await createSession(app),
      await createSession(app, { variant: 'B' }),
      await createSession(app, { utm_campaign: 'meta_spring' }),
    );
    for (const s of oldSessions) {
      expect(s.funnelVersion).toBe(1);
      expect(s.funnel.version).toBe(1);
    }
    expect(oldSessions[1]).toMatchObject({ variant: 'B', variantSource: 'override' });

    for (const s of oldSessions) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/sessions/${s.sessionId}/state`,
        payload: { answers: V1_PARTIAL, currentStepId: 'work_mode' },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const events = oldSessions.flatMap((s) => [
      makeEvent(s),
      makeEvent(s, { name: 'step_completed', properties: { next_step_id: s.funnel.stepSequence[1] } }),
      makeEvent(s, { name: 'answer_submitted', step_id: 'team_size', properties: { answer_kind: 'number' } }),
    ]);
    const res = await ingest(app, events);
    expect(res.rejected).toEqual([]);
    expect(res.accepted).toHaveLength(events.length);
  });

  it('2. publishing v3 through the admin API activates it without a restart', async () => {
    const res = await adminPost(app, '/api/admin/versions', { config: RAW_V3 }, TOKEN);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ version: 3, activeVersion: 3, action: 'publish' });
  });

  it('3. new sessions run v3: B lacks tool_count, compliance opens security_constraints', async () => {
    expect((await createSession(app)).funnelVersion).toBe(3);
    v3A = await createSession(app, { variant: 'A' });
    v3B = await createSession(app, { variant: 'B' });
    expect([v3A.funnelVersion, v3B.funnelVersion]).toEqual([3, 3]);

    expect(v3B.funnel.stepSequence).toEqual(V3.experiment.variants.B!.stepSequence);
    expect(v3B.funnel.stepSequence).not.toContain('tool_count');
    expect(v3B.funnel.steps).not.toHaveProperty('tool_count');
    expect(v3A.funnel.stepSequence).toContain('tool_count');

    const visible = (priorities: string[]) =>
      computeVisibility(v3A.funnel, { ...V3_COMPLIANCE_ANSWERS, priorities }).visible;
    expect(visible(['speed'])).not.toContain('security_constraints');
    expect(visible(['compliance', 'speed'])).toContain('security_constraints');

    // Once the branch is open the server requires its answer.
    const { security_constraints: _omitted, ...withoutBranch } = V3_COMPLIANCE_ANSWERS;
    const missing = await submit(v3A.sessionId, withoutBranch);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      error: 'invalid_answers',
      details: { security_constraints: expect.any(String) },
    });

    const res = await submit(v3A.sessionId, V3_COMPLIANCE_ANSWERS);
    expect(res.statusCode, res.body).toBe(200);
    const { resultId } = res.json<SubmitResultResponse>();
    expect(resultId).toBe('regulated_scale');
    expect(resultId).toBe(computeResultId(v3A.funnel, V3_COMPLIANCE_ANSWERS));
    expect(V3.results).toHaveProperty(resultId);
  });

  it('4. recommendation_expanded: accepted for a v3 session, rejected for a v1 session', async () => {
    const res = await ingest(app, [makeEvent(v3A, EXPANDED), makeEvent(oldSessions[0]!, EXPANDED)]);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toEqual([{ index: 1, event_id: expect.any(String), reason: 'event_not_allowed_for_version' }]);

    // Leave the v3 B session in progress for step 6.
    const put = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${v3B.sessionId}/state`,
      payload: { answers: { work_mode: 'remote', meeting_hours: 20 }, currentStepId: 'timezone_span' },
    });
    expect(put.statusCode).toBe(200);
  });

  it('5. old sessions resume on v1 with their answers and finish on v1', async () => {
    for (const s of oldSessions) {
      const state = await getSession(s.sessionId);
      expect(state.funnelVersion).toBe(1);
      expect(state.funnel.version).toBe(1);
      expect(state.funnel.stepSequence).toEqual(V1.experiment.variants[state.variant]!.stepSequence);
      expect(state.funnel.stepSequence).not.toContain('security_constraints');
      expect(state.answers).toEqual(V1_PARTIAL);
      expect(state.currentStepId).toBe('work_mode');

      const res = await submit(s.sessionId, V1_ANSWERS);
      expect(res.statusCode, res.body).toBe(200);
      const { resultId } = res.json<SubmitResultResponse>();
      expect(resultId).toBe('async_native');
      expect(V1.results).toHaveProperty(resultId);

      const sent = await ingest(app, [
        makeEvent(s, { step_id: 'tool_count', properties: {} }),
        makeEvent(s, { name: 'result_viewed', step_id: 'result', properties: { result_id: resultId } }),
      ]);
      expect(sent.rejected).toEqual([]);
    }

    const log = (
      await adminGet(app, `/api/admin/events?sessionId=${oldSessions[0]!.sessionId}`, TOKEN)
    ).json<AdminEventsResponse>();
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events.every((e) => e.funnelVersion === 1)).toBe(true);
  });

  it('6. rollback: new sessions are v1, an in-progress v3 session stays on v3 and finishes', async () => {
    const rb = await adminPost(app, '/api/admin/rollback', {}, TOKEN);
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.json<ActivateResponse>()).toEqual({ activeVersion: 1, previousVersion: 3 });

    expect((await createSession(app)).funnelVersion).toBe(1);

    const state = await getSession(v3B.sessionId);
    expect(state.funnelVersion).toBe(3);
    expect(state.funnel.stepSequence).toEqual(V3.experiment.variants.B!.stepSequence);
    expect(state.currentStepId).toBe('timezone_span');

    const res = await submit(v3B.sessionId, V3_B_ANSWERS);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<SubmitResultResponse>().resultId).toBe('meeting_heavy');
    expect((await ingest(app, [makeEvent(v3B, EXPANDED)])).accepted).toHaveLength(1);
  });

  it('7. analytics keeps both versions', async () => {
    const all = await analytics('?version=all');
    const started = (v: number) => all.versions.find((x) => x.version === v)?.kpis.started ?? 0;
    expect(started(1)).toBe(4);
    expect(started(3)).toBe(3);

    const v3 = await analytics('?version=3');
    expect(v3.filters.version).toBe(3);
    expect(v3.kpis).toMatchObject({ started: 3, reachedResult: 0 });
    expect(v3.extraEvents.find((e) => e.name === 'recommendation_expanded')?.sessions).toBe(2);

    const v1 = await analytics('?version=1');
    expect(v1.kpis.started).toBe(4);
    expect(v1.extraEvents.find((e) => e.name === 'recommendation_expanded')).toBeUndefined();
  });
});
