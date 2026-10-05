/**
 * Client half of the event guarantees (the server half is apps/server/test/ingest.test.ts):
 * persistence across reloads, retries with the same event_ids, ack handling, 4xx vs 5xx, the
 * allowed-name filter and the property whitelist. localStorage is a Map-backed stub and
 * postEvents is mocked, so the real EventQueue code runs unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInput, IngestResponse } from '@funnel/shared';
import type * as ApiModule from '../src/lib/api';
import v1Config from '../../../configs/funnel-v1.json';
import v3Config from '../../../configs/funnel-v3.json';
import { MemoryStorage } from './support/browser';

const postEvents = vi.fn<(events: EventInput[]) => Promise<IngestResponse>>();

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, postEvents: (events: EventInput[]) => postEvents(events) };
});

const { EventQueue } = await import('../src/funnel/events/queue');
const { ApiError } = await import('../src/lib/api');

type Ctx = NonNullable<Parameters<InstanceType<typeof EventQueue>['setContext']>[0]>;

function ctx(config: { version: number; events: unknown }, sessionId = 'sess-1'): Ctx {
  return {
    sessionId,
    funnelId: 'workstyle-planner',
    funnelVersion: config.version,
    experimentId: `exp-v${config.version}`,
    variant: 'A',
    utm: { source: null, medium: null, campaign: 'meta_spring' },
    funnel: { events: config.events } as Ctx['funnel'],
  };
}

const storedIds = (): string[] =>
  (JSON.parse(localStorage.getItem('fr.queue') ?? '[]') as EventInput[]).map((e) => e.event_id);

function ack(over: Partial<IngestResponse> = {}): IngestResponse {
  return { batchId: 'b', accepted: [], duplicates: [], rejected: [], ...over };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  postEvents.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EventQueue', () => {
  it('persists events synchronously; a new instance (page reload) sees the same ids', () => {
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    expect(q.track('step_viewed', 'intro', { step_type: 'info' })).toBe(true);
    expect(q.track('step_completed', 'intro', { next_step_id: 'team_size' })).toBe(true);
    const ids = storedIds();
    expect(ids).toHaveLength(2);

    const reloaded = new EventQueue();
    expect(reloaded.pendingCount()).toBe(2);
    expect(storedIds()).toEqual(ids);
  });

  it('every event carries version, variant and utm from the session', () => {
    const q = new EventQueue();
    q.setContext(ctx(v3Config));
    q.track('step_viewed', 'intro', {});
    const [e] = JSON.parse(localStorage.getItem('fr.queue') as string) as EventInput[];
    expect(e).toMatchObject({
      session_id: 'sess-1',
      funnel_version: 3,
      variant: 'A',
      utm_campaign: 'meta_spring',
      step_id: 'intro',
    });
  });

  it('a network error keeps the batch and the retry re-sends the SAME event ids', async () => {
    vi.useFakeTimers();
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    q.track('step_viewed', 'intro', {});
    q.track('step_viewed', 'team_size', {});
    const ids = storedIds();

    postEvents.mockRejectedValueOnce(new ApiError(0, { error: 'network_error' }));
    await q.flush();
    expect(storedIds()).toEqual(ids); // nothing lost

    // The server committed the first try but the response was lost: the retry reports duplicates.
    postEvents.mockResolvedValueOnce(ack({ duplicates: ids }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents.mock.calls[1]?.[0].map((e) => e.event_id)).toEqual(ids);
    expect(storedIds()).toEqual([]);
  });

  it('accepted, duplicate and rejected ids are all acknowledged and leave the queue', async () => {
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    for (const step of ['intro', 'team_size', 'work_mode']) q.track('step_viewed', step, {});
    const [a, b, c] = storedIds();
    postEvents.mockResolvedValueOnce(
      ack({
        accepted: [a as string],
        duplicates: [b as string],
        rejected: [{ index: 2, event_id: c as string, reason: 'unknown_step' }],
      }),
    );
    await q.flush();
    expect(storedIds()).toEqual([]);
    expect(q.pendingCount()).toBe(0);
  });

  it('events tracked while a batch is in flight are kept', async () => {
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    q.track('step_viewed', 'intro', {});
    const [first] = storedIds();
    let resolve!: (r: IngestResponse) => void;
    postEvents.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const flushing = q.flush();
    q.track('step_viewed', 'team_size', {});
    resolve(ack({ accepted: [first as string] }));
    await flushing;
    expect(storedIds()).toHaveLength(1);
    expect(storedIds()[0]).not.toBe(first);
  });

  it('a 4xx envelope error drops the batch; a 5xx keeps it for retry', async () => {
    vi.useFakeTimers();
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    q.track('step_viewed', 'intro', {});

    postEvents.mockRejectedValueOnce(new ApiError(503, { error: 'internal_error' }));
    await q.flush();
    expect(storedIds()).toHaveLength(1);

    postEvents.mockRejectedValueOnce(new ApiError(400, { error: 'bad_request' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(storedIds()).toEqual([]);
  });

  it('never queues server-only, unknown or version-disallowed events', () => {
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    expect(q.track('session_started', null, {})).toBe(false);
    expect(q.track('totally_made_up', 'intro', {})).toBe(false);
    expect(q.track('recommendation_expanded', 'result', { source: 'result_cta' })).toBe(false); // v1
    expect(storedIds()).toEqual([]);

    q.setContext(ctx(v3Config));
    expect(q.track('recommendation_expanded', 'result', { source: 'result_cta' })).toBe(true); // v3
    expect(storedIds()).toHaveLength(1);

    q.setContext(null);
    expect(q.track('step_viewed', 'intro', {})).toBe(false);
  });

  it('keeps only whitelisted primitive properties (raw answers never leave the browser)', () => {
    const q = new EventQueue();
    q.setContext(ctx(v1Config));
    q.track('answer_submitted', 'team_size', { answer_kind: 'number', value: 42, answer: 'secret', nested: { a: 1 } });
    const [e] = JSON.parse(localStorage.getItem('fr.queue') as string) as EventInput[];
    expect(e?.properties).toEqual({ answer_kind: 'number' });
  });
});
