/**
 * GET /api/admin/events → feed: accepted + duplicate + rejected deliveries, newest first.
 * Deliveries go through the real ingest endpoint:
 *
 *   createSession             → accepted session_started:S (server-side)
 *   batch 1: evt1, evt2, evt1 again, unknown-session event, client session_started
 *            → accepted evt1, evt2; duplicate evt1 (in-batch); rejected unknown_session, server_only_event
 *   batch 2: evt2 again        → duplicate evt2 (cross-batch)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdminEventsResponse, AdminFeedRow, EventInput, SessionState } from '@funnel/shared';
import { createSession, ingest as postEvents, makeApp, makeEvent } from './helpers';

const TOKEN = 'secret';
const T0 = Date.parse('2026-10-05T10:00:00.000Z');

describe('GET /api/admin/events feed', () => {
  let app: FastifyInstance;
  let s: SessionState;

  const ev = (id: string, overrides: Partial<EventInput> = {}): EventInput =>
    makeEvent(s, { event_id: id, ...overrides });
  const ingest = (events: unknown[]) => postEvents(app, events);
  const get = async (qs = ''): Promise<AdminEventsResponse> => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/events${qs}`, headers: { 'x-admin-token': TOKEN } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<AdminEventsResponse>();
  };
  const brief = (rows: AdminFeedRow[]) => rows.map((r) => `${r.kind}:${r.eventId}`);

  beforeAll(async () => {
    // Only Date is faked: each delivery step gets its own server receive time, no real sleeps.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    app = await makeApp({ adminToken: TOKEN });
    s = await createSession(app);
    vi.setSystemTime(T0 + 5);
    const b1 = await ingest([
      ev('feed-evt1'),
      ev('feed-evt2', { name: 'step_completed', properties: { next_step_id: 'team_size' } }),
      ev('feed-evt1'),
      ev('feed-bad1', { session_id: 'nope-session' }),
      ev('feed-srv1', { name: 'session_started', step_id: null, properties: {} }),
    ]);
    expect(b1.accepted).toEqual(['feed-evt1', 'feed-evt2']);
    expect(b1.duplicates).toEqual(['feed-evt1']);
    expect(b1.rejected.map((r) => r.reason)).toEqual(['unknown_session', 'server_only_event']);
    vi.setSystemTime(T0 + 10);
    const b2 = await ingest([ev('feed-evt2', { name: 'step_completed', properties: { next_step_id: 'team_size' } })]);
    expect(b2.duplicates).toEqual(['feed-evt2']);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('ingest logs one duplicate_deliveries row per duplicate (in-batch and cross-batch)', () => {
    const rows = app.ctx.db.prepare('SELECT event_id, batch_id FROM duplicate_deliveries ORDER BY id').all() as {
      event_id: string;
      batch_id: string;
    }[];
    expect(rows.map((r) => r.event_id)).toEqual(['feed-evt1', 'feed-evt2']);
    expect(rows[0]?.batch_id).not.toBe(rows[1]?.batch_id);
  });

  it('merges all kinds newest first (same batch: rejected, duplicate, accepted; each newest first)', async () => {
    const r = await get();
    expect(brief(r.feed)).toEqual([
      'duplicate:feed-evt2',
      'rejected:feed-srv1',
      'rejected:feed-bad1',
      'duplicate:feed-evt1',
      'accepted:feed-evt2',
      'accepted:feed-evt1',
      `accepted:session_started:${s.sessionId}`,
    ]);
    const ts = r.feed.map((f) => f.receivedAt);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect(new Set(r.feed.map((f) => f.key)).size).toBe(r.feed.length);
    expect(r.feed.every((f) => f.key.startsWith(`${f.kind}:`))).toBe(true);
    // `events` is unchanged: stored events only.
    expect(r.events.map((e) => e.eventId)).toEqual(['feed-evt2', 'feed-evt1', `session_started:${s.sessionId}`]);
  });

  it('duplicate rows describe the stored original', async () => {
    const r = await get();
    const accepted = r.feed.find((f) => f.key === 'accepted:feed-evt2') as AdminFeedRow;
    const dup = r.feed.find((f) => f.kind === 'duplicate' && f.eventId === 'feed-evt2') as AdminFeedRow;
    expect(dup).toMatchObject({
      name: 'step_completed',
      sessionId: s.sessionId,
      stepId: 'intro',
      funnelVersion: 1,
      variant: s.variant,
      clientTs: accepted.clientTs,
      properties: { next_step_id: 'team_size' },
      reason: null,
    });
    expect(dup.receivedAt > accepted.receivedAt).toBe(true);
  });

  it('rejected rows: best-effort fields from the payload, version/variant only from a known session', async () => {
    const r = await get();
    expect(r.feed.find((f) => f.eventId === 'feed-bad1')).toMatchObject({
      kind: 'rejected',
      name: 'step_viewed',
      sessionId: 'nope-session',
      stepId: 'intro',
      funnelVersion: null,
      variant: null,
      clientTs: '2026-10-05T10:00:00.000Z',
      properties: {},
      reason: 'unknown_session',
    });
    expect(r.feed.find((f) => f.eventId === 'feed-srv1')).toMatchObject({
      name: 'session_started',
      sessionId: s.sessionId,
      stepId: null,
      funnelVersion: 1,
      variant: s.variant,
      reason: 'server_only_event',
    });
  });

  it('applies the sessionId / name filters and the limit to every kind', async () => {
    expect(brief((await get(`?sessionId=${s.sessionId}`)).feed)).toEqual([
      'duplicate:feed-evt2',
      'rejected:feed-srv1',
      'duplicate:feed-evt1',
      'accepted:feed-evt2',
      'accepted:feed-evt1',
      `accepted:session_started:${s.sessionId}`,
    ]);
    expect(brief((await get('?name=step_viewed')).feed)).toEqual([
      'rejected:feed-bad1',
      'duplicate:feed-evt1',
      'accepted:feed-evt1',
    ]);
    expect(brief((await get('?sessionId=nope-session')).feed)).toEqual(['rejected:feed-bad1']);
    expect(brief((await get('?limit=2')).feed)).toEqual(['duplicate:feed-evt2', 'rejected:feed-srv1']);
  });

  it('still requires the admin token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
    expect(res.statusCode).toBe(401);
  });
});
