/**
 * Upgrading an existing database: a file created by the original schema (only MIGRATIONS[0] applied)
 * must be migrated automatically on open — no manual schema change, no data loss.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminEventsResponse, AnalyticsResponse, IngestResponse } from '@funnel/shared';
import { buildApp } from '../src/app';
import { MIGRATIONS, openDb } from '../src/db';
import { seedIfEmpty } from '../src/services/versions';
import { SEED_V1 } from './helpers';

const TOKEN = 'secret';

describe('schema migrations on an existing database', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fr-migrate-'));
    dbPath = join(dir, 'old.db');

    // A database exactly as the first release left it: schema_migrations at version 1.
    const old = new Database(dbPath);
    old.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    old.exec(MIGRATIONS[0] as string);
    old.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run('2026-10-01T00:00:00.000Z');
    seedIfEmpty(old, JSON.parse(readFileSync(SEED_V1, 'utf8')));
    old
      .prepare(
        `INSERT INTO sessions (id, funnel_id, funnel_version, experiment_id, variant, variant_source, utm_campaign,
                             answers_json, current_step_id, result_id, created_at, updated_at, expires_at)
       VALUES ('old-session', 'workstyle-planner', 1, 'question-order-and-result-framing-v1', 'A', 'hash', 'meta',
               '{"team_size":12}', 'team_size', NULL, '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z',
               '2099-01-01T00:00:00.000Z')`,
      )
      .run();
    const insertEvent = old.prepare(
      `INSERT INTO events (event_id, session_id, name, step_id, funnel_id, funnel_version, experiment_id, variant,
                           utm_campaign, client_ts, server_ts, properties_json)
       VALUES (?, 'old-session', ?, ?, 'workstyle-planner', 1, 'question-order-and-result-framing-v1', 'A', 'meta', ?, ?, '{}')`,
    );
    insertEvent.run('session_started:old-session', 'session_started', null, null, '2026-10-01T10:00:00.000Z');
    insertEvent.run('old-event-0001', 'step_viewed', 'intro', '2026-10-01T10:00:01.000Z', '2026-10-01T10:00:02.000Z');
    old.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('openDb applies the pending migration and keeps the data', () => {
    const db = openDb(dbPath);
    try {
      const versions = (
        db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
      ).map((r) => r.version);
      expect(versions).toEqual(MIGRATIONS.map((_, i) => i + 1));
      const table = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'duplicate_deliveries'`)
        .get();
      expect(table).toEqual({ name: 'duplicate_deliveries' });
      const index = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'duplicate_deliveries'`)
        .all();
      expect(index).toEqual([{ name: 'idx_duplicate_deliveries_received' }]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 2 });
      expect(db.prepare(`SELECT answers_json FROM sessions WHERE id = 'old-session'`).get()).toEqual({
        answers_json: '{"team_size":12}',
      });
    } finally {
      db.close();
    }
    // Reopening is a no-op (each migration runs once).
    const again = openDb(dbPath);
    try {
      expect(again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: MIGRATIONS.length });
    } finally {
      again.close();
    }
  });

  it('the upgraded database serves sessions, ingest, the feed and analytics', async () => {
    const app = await buildApp({ dbPath, seedConfigPath: SEED_V1, adminToken: TOKEN });
    try {
      // Old session resumes on its pinned version with its answers.
      const session = await app.inject({ method: 'GET', url: '/api/sessions/old-session' });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ funnelVersion: 1, answers: { team_size: 12 } });

      const base = {
        session_id: 'old-session',
        name: 'step_viewed',
        client_timestamp: '2026-10-01T10:00:05.000Z',
        properties: {},
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/events',
        payload: {
          events: [
            { ...base, event_id: 'old-event-0001', step_id: 'intro' },
            { ...base, event_id: 'new-event-0001', step_id: 'team_size' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<IngestResponse>();
      expect(body.accepted).toEqual(['new-event-0001']);
      expect(body.duplicates).toEqual(['old-event-0001']);

      const feed = (
        await app.inject({
          method: 'GET',
          url: '/api/admin/events?sessionId=old-session',
          headers: { 'x-admin-token': TOKEN },
        })
      ).json<AdminEventsResponse>().feed;
      expect(feed.map((f) => `${f.kind}:${f.eventId}`)).toEqual([
        'duplicate:old-event-0001',
        'accepted:new-event-0001',
        'accepted:old-event-0001',
        'accepted:session_started:old-session',
      ]);

      const analytics = (await app.inject({ method: 'GET', url: '/api/admin/analytics' })).json<AnalyticsResponse>();
      expect(analytics.kpis.started).toBe(1);
      expect(analytics.steps.find((s) => s.stepId === 'team_size')?.viewed).toBe(1);
    } finally {
      await app.close();
    }
  });
});
