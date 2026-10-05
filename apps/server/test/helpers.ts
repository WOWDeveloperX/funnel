import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { EventInput, IngestResponse, SessionState } from '@funnel/shared';
import { type BuildAppOptions, buildApp } from '../src/app';

/** Absolute path of a file under the repo root (robust to the cwd vitest runs from). */
function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
}

export const SEED_V1 = repoPath('configs/funnel-v1.json');
export const CONFIG_V3 = repoPath('configs/funnel-v3.json');

export const readJson = <T = Record<string, unknown>>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** An isolated in-memory app seeded with v1. */
export function makeApp(opts: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  return buildApp({ dbPath: ':memory:', seedConfigPath: SEED_V1, ...opts });
}

/** POST /api/sessions with landing-page query params; asserts 201. */
export async function createSession(app: FastifyInstance, query: Record<string, string> = {}): Promise<SessionState> {
  const res = await app.inject({ method: 'POST', url: '/api/sessions', payload: { query } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SessionState>();
}

const tokenHeaders = (token?: string): Record<string, string> => (token ? { 'x-admin-token': token } : {});

export function adminPost(app: FastifyInstance, url: string, body: unknown = {}, token?: string) {
  return app.inject({ method: 'POST', url, payload: body as object, headers: tokenHeaders(token) });
}

export function adminGet(app: FastifyInstance, url: string, token?: string) {
  return app.inject({ method: 'GET', url, headers: tokenHeaders(token) });
}

/** POST /api/events; asserts 200. */
export async function ingest(app: FastifyInstance, events: unknown[]): Promise<IngestResponse> {
  const res = await app.inject({ method: 'POST', url: '/api/events', payload: { events } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<IngestResponse>();
}

let eventSeq = 0;

/** A valid step_viewed on the intro of `session` with a unique event_id; override any field. */
export function makeEvent(
  session: Pick<SessionState, 'sessionId'>,
  overrides: Partial<EventInput> & Record<string, unknown> = {},
): EventInput {
  eventSeq += 1;
  return {
    event_id: `evt-${String(eventSeq).padStart(6, '0')}`,
    session_id: session.sessionId,
    name: 'step_viewed',
    client_timestamp: '2026-10-05T10:00:00.000Z',
    step_id: 'intro',
    properties: { step_type: 'info', visible_step_index: 1, visible_step_count: 8 },
    ...overrides,
  };
}
