/**
 * FunnelController (session lifecycle, navigation, analytics emission) with the API mocked and a
 * fake window/history/localStorage — the real controller and event queue code runs unchanged.
 */
import {
  answerKey,
  type Answers,
  computeVisibility,
  type EventInput,
  isInteractive,
  parseConfig,
  resolveFunnel,
  type SessionState,
  type Step,
  validateAnswer,
} from '@funnel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import v3Config from '../../../configs/funnel-v3.json';
import { FunnelController, MIN_RESULT_LOADER_MS } from '../src/funnel/session/controller';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { syncLanguageParam } from '../src/lib/language';
import { FakeDocument, FakeWindow, MemoryStorage } from './support/browser';

const api = vi.hoisted(() => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  putSessionState: vi.fn(),
  submitResult: vi.fn(),
  postEvents: vi.fn(),
}));

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, ...api };
});

const configs = { 1: parseConfig(v1Config), 3: parseConfig(v3Config) } as const;

function makeSession(version: 1 | 3, variant: string, over: Partial<SessionState> = {}): SessionState {
  const funnel = resolveFunnel(configs[version], variant);
  return {
    sessionId: `sess-v${version}-${variant}`,
    funnelId: funnel.funnelId,
    funnelVersion: version,
    experimentId: funnel.experimentId,
    variant,
    variantSource: 'hash',
    utm: { source: null, medium: null, campaign: null },
    answers: {},
    currentStepId: null,
    resultId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    funnel,
    translations: [],
    ...over,
  };
}

/** A valid answer for every visible interactive step (follows branches as they open). */
function completeAnswers(session: SessionState): Answers {
  const funnel = session.funnel;
  const answers: Answers = {};
  const candidates = (step: Step): unknown[] => {
    const options = (step.input?.options ?? []).map((o) => o.value);
    if (step.type === 'number') return [step.input?.min ?? 1, 1, 0];
    if (step.type === 'single-select') return options.slice(0, 1);
    return options.map((_, i) => options.slice(0, i + 1));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const id of computeVisibility(funnel, answers).visible) {
      const step = funnel.steps[id]!;
      const key = answerKey(step);
      if (!isInteractive(step) || !key || validateAnswer(step, answers[key]) === null) continue;
      const value = candidates(step).find((v) => validateAnswer(step, v) === null);
      if (value === undefined) throw new Error(`no valid test answer for ${id}`);
      answers[key] = value;
      changed = true;
    }
  }
  return answers;
}

let win: FakeWindow;
let storage: MemoryStorage;
let controller: FunnelController;

const queued = (): EventInput[] => JSON.parse(storage.getItem('fr.queue') ?? '[]') as EventInput[];
const names = () => queued().map((e) => `${e.name}:${e.step_id}`);

function boot(url = 'http://localhost/'): FunnelController {
  win = new FakeWindow(url);
  vi.stubGlobal('window', win);
  controller = new FunnelController();
  controller.start();
  return controller;
}

/** Lets the async boot / result chain settle (fake timers). */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', new FakeDocument());
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  for (const fn of Object.values(api)) fn.mockReset();
  api.putSessionState.mockResolvedValue({ ok: true, updatedAt: '2026-01-01T00:00:00.000Z' });
  // Deliveries never settle, so emitted events stay inspectable in the queue.
  api.postEvents.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  controller.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FunnelController boot', () => {
  it('a stored session resumes on its pinned version and variant', async () => {
    const stored = makeSession(1, 'B', { currentStepId: 'work_mode' });
    storage.setItem('fr.sessionId', stored.sessionId);
    api.getSession.mockResolvedValue(stored);

    const c = boot();
    await settle();
    const s = c.getSnapshot();
    expect(api.getSession).toHaveBeenCalledWith(stored.sessionId);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(s.phase).toBe('ready');
    expect(s.session?.funnelVersion).toBe(1);
    expect(s.session?.variant).toBe('B');
    expect(s.currentStepId).toBe('work_mode');
    expect(win.url.searchParams.get('step')).toBe('work_mode');
    expect(queued()).toEqual([
      expect.objectContaining({ name: 'step_viewed', step_id: 'work_mode', funnel_version: 1, variant: 'B' }),
    ]);
  });

  it('?reset=1 ignores the stored session and creates a new one with the landing params', async () => {
    storage.setItem('fr.sessionId', 'old-session');
    api.createSession.mockResolvedValue(makeSession(3, 'B'));

    const c = boot('http://localhost/?variant=B&utm_campaign=spring&reset=1');
    await settle();
    expect(api.getSession).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith({ query: { variant: 'B', utm_campaign: 'spring' } });
    expect(c.getSnapshot().session?.sessionId).toBe('sess-v3-B');
    expect(storage.getItem('fr.sessionId')).toBe('sess-v3-B');
    expect(win.url.searchParams.has('reset')).toBe(false);
  });

  it('?lang= is a UI preference: not sent with the session, kept in the URL, never changes events', async () => {
    api.createSession.mockResolvedValue(makeSession(3, 'A'));

    const c = boot('http://localhost/?lang=en&utm_campaign=spring');
    await settle();
    expect(api.createSession).toHaveBeenCalledWith({ query: { utm_campaign: 'spring' } });
    expect(win.url.searchParams.get('lang')).toBe('en');
    expect(win.url.searchParams.get('step')).toBe('intro');
    const emitted = names();

    // Switching the language mid-flow only re-renders: the controller sees nothing, emits nothing.
    syncLanguageParam('ru');
    await settle(1000);
    expect(win.url.searchParams.get('lang')).toBe('ru');
    expect(win.url.searchParams.get('step')).toBe('intro');
    expect(names()).toEqual(emitted);
    expect(c.getSnapshot().currentStepId).toBe('intro');
  });

  it('GET 404 → a new session', async () => {
    storage.setItem('fr.sessionId', 'gone');
    api.getSession.mockRejectedValue(new ApiError(404, { error: 'not_found', message: 'Session not found' }));
    api.createSession.mockResolvedValue(makeSession(1, 'A'));

    const c = boot();
    await settle();
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().phase).toBe('ready');
    expect(c.getSnapshot().session?.sessionId).toBe('sess-v1-A');
  });

  it('GET 410 → the expired screen', async () => {
    storage.setItem('fr.sessionId', 'old');
    api.getSession.mockRejectedValue(new ApiError(410, { error: 'expired', message: 'Session expired' }));

    const c = boot();
    await settle();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toMatchObject({ phase: 'expired', expiredReason: 'expired' });
  });

  it('an unreachable server without a cached snapshot → a network boot error', async () => {
    api.createSession.mockRejectedValue(new ApiError(0, { error: 'network_error' }));
    const c = boot();
    await settle();
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', bootError: 'network' });
  });
});

describe('FunnelController navigation and events', () => {
  async function onStep(stepId: string, version: 1 | 3 = 1, variant = 'A') {
    const s = makeSession(version, variant, { currentStepId: stepId });
    storage.setItem('fr.sessionId', s.sessionId);
    api.getSession.mockResolvedValue(s);
    const c = boot();
    await settle();
    storage.removeItem('fr.queue'); // drop the boot step_viewed
    return c;
  }

  it('next() queues answer_submitted → step_completed → step_viewed with version and variant', async () => {
    const c = await onStep('team_size');
    expect(c.next()).toBe(false); // no answer yet: validation message, no events
    expect(c.getSnapshot().errorStepId).toBe('team_size');
    expect(queued()).toEqual([]);

    c.setAnswer('team_size', 12);
    expect(c.next()).toBe(true);
    expect(c.getSnapshot().currentStepId).toBe('work_mode');
    expect(names()).toEqual(['answer_submitted:team_size', 'step_completed:team_size', 'step_viewed:work_mode']);
    for (const e of queued()) expect(e).toMatchObject({ funnel_version: 1, variant: 'A', session_id: 'sess-v1-A' });
    expect(queued()[1]?.properties).toEqual({ next_step_id: 'work_mode' });
    expect(win.url.searchParams.get('step')).toBe('work_mode');
  });

  it('back() queues back_clicked and returns to the previous step', async () => {
    const c = await onStep('team_size');
    c.setAnswer('team_size', 12);
    c.next();
    storage.removeItem('fr.queue');

    c.back();
    expect(c.getSnapshot().currentStepId).toBe('team_size');
    expect(names()).toEqual(['back_clicked:work_mode', 'step_viewed:team_size']);
    expect(queued()[0]?.properties).toEqual({ destination_step_id: 'team_size' });
  });

  it('answers are saved to the server after the debounce', async () => {
    const c = await onStep('team_size');
    c.setAnswer('team_size', 7);
    await settle(400);
    expect(api.putSessionState).toHaveBeenLastCalledWith(
      'sess-v1-A',
      { answers: { team_size: 7 }, currentStepId: 'team_size' },
      { keepalive: false },
    );
    expect(c.getSnapshot().sync).toBe('synced');
  });

  async function onResult(version: 1 | 3) {
    const base = makeSession(version, 'A');
    const s = { ...base, answers: completeAnswers(base), currentStepId: 'result' };
    storage.setItem('fr.sessionId', s.sessionId);
    api.getSession.mockResolvedValue(s);
    const resultId = s.funnel.defaultResultId;
    api.submitResult.mockResolvedValue({ resultId, result: s.funnel.results[resultId] });
    const c = boot();
    await settle(MIN_RESULT_LOADER_MS + 50);
    expect(c.getSnapshot().result.status).toBe('ready');
    storage.removeItem('fr.queue');
    return c;
  }

  it('the primary CTA queues recommendation_expanded for v3 sessions', async () => {
    const c = await onResult(3);
    c.ctaClicked(true);
    expect(names()).toEqual(['cta_clicked:result', 'recommendation_expanded:result']);
    expect(queued()[1]).toMatchObject({ funnel_version: 3, properties: { source: 'result_cta' } });
  });

  it('…and not for v1 sessions, whose config does not allow it', async () => {
    const c = await onResult(1);
    c.ctaClicked(true);
    expect(names()).toEqual(['cta_clicked:result']);
  });
});
