import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MIGRATIONS } from '../src/db';
import { buildApp } from '../src/app';
import { SEED_V1 } from './helpers';

describe('health + skeleton', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1, adminToken: 'secret' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports the seeded active version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, activeVersion: 1, db: 'ok', adminAuthRequired: true });
  });

  it('seeds version 1 with a seed activation', () => {
    const { db } = app.ctx;
    expect(app.ctx.defaultFunnelId).toBe('workstyle-planner');
    expect(db.prepare('SELECT version, config_hash FROM funnel_versions').all()).toHaveLength(1);
    expect(db.prepare('SELECT action, previous_version FROM version_activations').get()).toEqual({
      action: 'seed',
      previous_version: null,
    });
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: MIGRATIONS.length });
  });

  it('unknown /api route → 404 JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('POST /api/admin/* requires the token when configured', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/admin/rollback', payload: {} });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ error: 'unauthorized' });
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/admin/rollback',
      payload: {},
      headers: { 'x-admin-token': 'secret' },
    });
    expect(allowed.statusCode).not.toBe(401);
  });
});

describe('health without ADMIN_TOKEN', () => {
  it('reports adminAuthRequired = false', async () => {
    const app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1 });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.json()).toEqual({ ok: true, activeVersion: 1, db: 'ok', adminAuthRequired: false });
    } finally {
      await app.close();
    }
  });
});

describe('default funnel', () => {
  it('without a seed config, an empty database is a startup error', async () => {
    await expect(buildApp({ dbPath: ':memory:' })).rejects.toThrow('No funnel configured');
  });

  it('without a seed config, an existing database uses its first active funnel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fr-default-'));
    const dbPath = join(dir, 'funnel.db');
    try {
      await (await buildApp({ dbPath, seedConfigPath: SEED_V1 })).close();
      const app = await buildApp({ dbPath });
      try {
        expect(app.ctx.defaultFunnelId).toBe('workstyle-planner');
        expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ activeVersion: 1 });
      } finally {
        await app.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SPA fallback', () => {
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fr-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = await buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1, webDist: dir });
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html for navigation routes', async () => {
    for (const url of ['/', '/admin', '/admin/analytics?version=3', '/admin/events']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/text\/html/);
    }
  });

  it('serves existing assets and 404s missing ones (no HTML for a stale hashed chunk)', async () => {
    const ok = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toMatch(/javascript/);
    for (const url of ['/assets/AnalyticsPage-old123.js', '/assets/missing.css', '/favicon-missing.png']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).not.toMatch(/text\/html/);
    }
  });
});
