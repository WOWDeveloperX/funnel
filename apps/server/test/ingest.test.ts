import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IngestResponse, SessionState } from '@funnel/shared';
import {
  CONFIG_V3,
  createSession as createSessionIn,
  ingest as ingestInto,
  makeApp,
  makeEvent as ev,
  readJson,
} from './helpers';

const RAW_V3 = readJson(CONFIG_V3);

let app: FastifyInstance;

beforeEach(async () => {
  app = await makeApp();
});
afterEach(async () => {
  await app.close();
});

const createSession = (query: Record<string, string> = {}): Promise<SessionState> => createSessionIn(app, query);
const ingest = (events: unknown[]): Promise<IngestResponse> => ingestInto(app, events);

const count = (sql: string, ...params: unknown[]): number =>
  (app.ctx.db.prepare(sql).get(...params) as { n: number }).n;

describe('deduplication', () => {
  it('the same batch twice → second time all duplicates, event count unchanged', async () => {
    const s = await createSession();
    const batch = [
      ev(s),
      ev(s, { name: 'answer_submitted', step_id: 'team_size', properties: { answer_kind: 'number' } }),
      ev(s, { name: 'step_completed', step_id: 'intro', properties: { next_step_id: 'team_size' } }),
    ];
    const ids = batch.map((e) => e.event_id);

    const first = await ingest(batch);
    expect(first.accepted).toEqual(ids);
    expect(first.duplicates).toEqual([]);
    expect(first.rejected).toEqual([]);
    const before = count('SELECT COUNT(*) AS n FROM events');
    expect(before).toBe(4); // + server session_started

    const second = await ingest(batch);
    expect(second.accepted).toEqual([]);
    expect(second.duplicates).toEqual(ids);
    expect(second.batchId).not.toBe(first.batchId);
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(before);

    const batches = app.ctx.db
      .prepare('SELECT total, accepted, duplicates, rejected FROM ingest_batches ORDER BY received_at, rowid')
      .all();
    expect(batches).toEqual([
      { total: 3, accepted: 3, duplicates: 0, rejected: 0 },
      { total: 3, accepted: 0, duplicates: 3, rejected: 0 },
    ]);
  });

  it('duplicates inside one batch are reported as duplicates', async () => {
    const s = await createSession();
    const e = ev(s);
    const res = await ingest([e, { ...e }, ev(s, { step_id: 'team_size' })]);
    expect(res.accepted).toHaveLength(2);
    expect(res.accepted[0]).toBe(e.event_id);
    expect(res.duplicates).toEqual([e.event_id]);
    expect(count('SELECT COUNT(*) AS n FROM events WHERE event_id = ?', e.event_id)).toBe(1);
  });
});

describe('per-event validation', () => {
  it('rejects invalid events without failing the valid ones', async () => {
    const v1 = await createSession();
    const good1 = ev(v1);
    const good2 = ev(v1, {
      name: 'back_clicked',
      step_id: 'work_mode',
      properties: { destination_step_id: 'team_size' },
    });
    const batch: unknown[] = [
      good1,
      { ...ev(v1), event_id: 'short' }, // 1: invalid event_id
      42, // 2: not an object
      ev(v1, { session_id: 'no-such-session' }), // 3
      ev(v1, { name: 'recommendation_expanded', step_id: 'result', properties: { result_id: 'balanced' } }), // 4: v1
      ev(v1, { step_id: 'security_constraints' }), // 5: not a v1 step
      ev(v1, { name: 'session_started', step_id: null }), // 6: server only
      ev(v1, { client_timestamp: 'yesterday-ish' }), // 7
      ev(v1, { name: 'totally_made_up' }), // 8
      good2,
    ];
    const res = await ingest(batch);
    expect(res.accepted).toEqual([good1.event_id, good2.event_id]);
    expect(res.duplicates).toEqual([]);

    const reasons = Object.fromEntries(res.rejected.map((r) => [r.index, r.reason]));
    expect(reasons[1]).toMatch(/^invalid_shape: /);
    expect(reasons[2]).toMatch(/^invalid_shape/);
    expect(reasons[3]).toBe('unknown_session');
    expect(reasons[4]).toBe('event_not_allowed_for_version');
    expect(reasons[5]).toBe('unknown_step');
    expect(reasons[6]).toBe('server_only_event');
    expect(reasons[7]).toBe('invalid_timestamp');
    expect(reasons[8]).toBe('event_not_allowed_for_version');
    expect(res.rejected).toHaveLength(8);
    expect(res.rejected.find((r) => r.index === 1)?.event_id).toBe('short');
    expect(res.rejected.find((r) => r.index === 2)?.event_id).toBeNull();

    expect(count('SELECT COUNT(*) AS n FROM rejected_events WHERE batch_id = ?', res.batchId)).toBe(8);
    expect(app.ctx.db.prepare('SELECT total, accepted, duplicates, rejected FROM ingest_batches').get()).toEqual({
      total: 10,
      accepted: 2,
      duplicates: 0,
      rejected: 8,
    });
  });

  it('accepts recommendation_expanded for a v3 session, still rejects it for a v1 session', async () => {
    const v1 = await createSession();
    const pub = await app.inject({ method: 'POST', url: '/api/admin/versions', payload: { config: RAW_V3 } });
    expect(pub.statusCode).toBe(201);
    const v3 = await createSession();
    expect(v3.funnelVersion).toBe(3);

    const props = { result_id: 'balanced', action: 'expand_recommendation', source: 'result_cta' };
    const res = await ingest([
      ev(v3, { name: 'recommendation_expanded', step_id: 'result', properties: props }),
      ev(v1, { name: 'recommendation_expanded', step_id: 'result', properties: props }),
    ]);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toEqual([{ index: 1, event_id: expect.any(String), reason: 'event_not_allowed_for_version' }]);
  });

  it('step events need a step_id; result events must be on the pinned result step', async () => {
    const s = await createSession();
    const resultProps = { result_id: 'office_core', action: 'expand_recommendation' };
    const batch: unknown[] = [
      ev(s, { step_id: null }), // 0: step_viewed without step
      ev(s, { name: 'step_completed', step_id: undefined, properties: {} }), // 1
      ev(s, { name: 'back_clicked', step_id: null, properties: {} }), // 2
      ev(s, { name: 'cta_clicked', step_id: 'intro', properties: resultProps }), // 3: CTA "on the intro"
      ev(s, { name: 'result_viewed', step_id: 'intro', properties: { result_id: 'office_core' } }), // 4
      ev(s, { name: 'cta_clicked', step_id: null, properties: resultProps }), // 5
      ev(s, { name: 'result_viewed', step_id: 'result', properties: { result_id: 'balanced' } }), // ok
      ev(s, { name: 'cta_clicked', step_id: 'result', properties: resultProps }), // ok
    ];
    const res = await ingest(batch);
    expect(res.accepted).toHaveLength(2);
    expect(Object.fromEntries(res.rejected.map((r) => [r.index, r.reason]))).toEqual({
      0: 'missing_step_id',
      1: 'missing_step_id',
      2: 'missing_step_id',
      3: 'step_mismatch',
      4: 'step_mismatch',
      5: 'step_mismatch',
    });
  });

  it('step_id must belong to the session variant', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/versions', payload: { config: RAW_V3 } });
    const b = await createSession({ variant: 'B' }); // v3 B has no tool_count
    const a = await createSession({ variant: 'A' });
    const res = await ingest([ev(b, { step_id: 'tool_count' }), ev(a, { step_id: 'tool_count' })]);
    expect(res.rejected).toEqual([{ index: 0, event_id: expect.any(String), reason: 'unknown_step' }]);
    expect(res.accepted).toHaveLength(1);
  });
});

describe('privacy & source of truth', () => {
  it('strips non-whitelisted and non-primitive properties', async () => {
    const s = await createSession();
    const e = ev(s, {
      name: 'answer_submitted',
      step_id: 'team_size',
      properties: { answer_kind: 'number', value: 42, team_size: 42, nested: { a: 1 } },
    });
    const viewed = ev(s, {
      properties: { step_type: { evil: true }, visible_step_index: 2, visible_step_count: 'x'.repeat(300) },
    });
    const res = await ingest([e, viewed]);
    expect(res.accepted).toHaveLength(2);

    const props = (id: string) =>
      JSON.parse(
        (app.ctx.db.prepare('SELECT properties_json AS p FROM events WHERE event_id = ?').get(id) as { p: string }).p,
      ) as Record<string, unknown>;
    expect(props(e.event_id)).toEqual({ answer_kind: 'number' });
    expect(props(viewed.event_id)).toEqual({ visible_step_index: 2, visible_step_count: 'x'.repeat(256) });

    // Raw answer values never reach the events table.
    const all = app.ctx.db.prepare('SELECT properties_json AS p FROM events').all() as { p: string }[];
    expect(all.some((r) => r.p.includes('42') && r.p.includes('value'))).toBe(false);
  });

  it('rejected payloads keep property keys but not their values', async () => {
    const s = await createSession();
    await ingest([ev(s, { client_timestamp: 'nope', properties: { secret_answer: 'remote-and-sad' } })]);
    const row = app.ctx.db.prepare('SELECT payload_json AS p FROM rejected_events').get() as { p: string };
    expect(row.p).toContain('secret_answer');
    expect(row.p).not.toContain('remote-and-sad');
  });

  it('funnel/version/experiment/variant/utm are copied from the session, not the client', async () => {
    const s = await createSession({ variant: 'B', utm_campaign: 'meta_spring', utm_source: 'meta' });
    const e = ev(s, {
      funnel_id: 'other-funnel',
      funnel_version: 99,
      experiment_id: 'fake',
      variant: 'A',
      utm_source: 'liar',
      utm_medium: 'liar',
      utm_campaign: 'liar',
      client_timestamp: '2026-10-05T12:00:00+02:00',
    });
    expect((await ingest([e])).accepted).toEqual([e.event_id]);
    const row = app.ctx.db.prepare('SELECT * FROM events WHERE event_id = ?').get(e.event_id);
    expect(row).toMatchObject({
      session_id: s.sessionId,
      funnel_id: 'workstyle-planner',
      funnel_version: 1,
      experiment_id: s.experimentId,
      variant: 'B',
      utm_source: 'meta',
      utm_medium: null,
      utm_campaign: 'meta_spring',
      client_ts: '2026-10-05T10:00:00.000Z', // normalized to UTC ISO
      step_id: 'intro',
    });
  });
});

describe('envelope', () => {
  it('400 for an empty, oversized or malformed batch', async () => {
    const s = await createSession();
    const tooMany = Array.from({ length: 501 }, () => ev(s));
    for (const payload of [{ events: [] }, { events: tooMany }, { nope: [] }, { events: 'x' }]) {
      const res = await app.inject({ method: 'POST', url: '/api/events', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_batch', message: expect.any(String) });
    }
    const badJson = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: '{"events": [',
      headers: { 'content-type': 'application/json' },
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toMatchObject({ error: 'bad_request' });
    expect(count('SELECT COUNT(*) AS n FROM ingest_batches')).toBe(0);
  });

  it('accepts exactly 500 events and text/plain bodies (sendBeacon)', async () => {
    const s = await createSession();
    const full = await ingest(Array.from({ length: 500 }, () => ev(s)));
    expect(full.accepted).toHaveLength(500);

    const beacon = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: JSON.stringify({ events: [ev(s)] }),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
    expect(beacon.statusCode).toBe(200);
    expect(beacon.json<IngestResponse>().accepted).toHaveLength(1);
  });
});
