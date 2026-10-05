/**
 * FunnelController — session lifecycle for the public funnel, kept outside React so history
 * listeners, timers and async requests always see the latest state (no stale closures) and
 * StrictMode's double effects cannot emit events twice.
 *
 * Responsibilities:
 * - boot: reuse localStorage['fr.sessionId'] (GET) or create a session (POST with all URL params);
 *   `?reset=1` forces a new one; 404 → new session; 410 → expired screen; unreachable server →
 *   cached snapshot + local mirror if we have them, otherwise an error screen with retry.
 * - navigation over the resolved config using only @funnel/shared helpers; `?step=` sync with
 *   pushState/replaceState; browser back/forward mapped to in-app back / guarded forward.
 * - persistence: local mirror on every change + debounced (300ms) PUT /state with retry.
 * - result: POST /result with a minimum loader time; invalid answers redirect to the step.
 * - analytics emission rules (step_viewed, answer_submitted, step_completed, back_clicked,
 *   result_viewed, cta_clicked, recommendation_expanded when allowed).
 */
import {
  type Answers,
  answerKey,
  computeVisibility,
  firstInvalidStepBefore,
  isEventAllowed,
  isInteractive,
  nextStepId,
  prevStepId,
  RECOMMENDATION_EXPANDED,
  type ResolvedFunnel,
  type ResolvedResult,
  type SessionState,
  validateAnswer,
  validateVisibleAnswers,
} from '@funnel/shared';
import { ApiError, createSession, getSession, putSessionState, submitResult } from '../../lib/api';
import { eventQueue } from '../events/queue';
import {
  clearSessionStorage,
  getStoredSessionId,
  readMirror,
  readSnapshot,
  setStoredSessionId,
  writeMirror,
  writeSnapshot,
} from '../storage';
import { type BootErrorKind, bootErrorKind, isUnreachable } from './errors';
import { firstInSequence, isReachable, resumeStepId } from './navigation';
import { currentUrl, landingQuery, pushStep, readHistoryState, removeResetParam, replaceStep } from './url';

const SAVE_DEBOUNCE_MS = 300;
const SAVE_RETRY_BASE_MS = 1000;
const SAVE_RETRY_MAX_MS = 30_000;
/** The result loader stays visible at least this long (1–1.5 s) so its 3-step checklist completes and the reveal does not flash. */
export const MIN_RESULT_LOADER_MS = 1200;

export type Phase = 'booting' | 'ready' | 'expired' | 'error';

export type ResultView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; resultId: string; result: ResolvedResult }
  | { status: 'error' };

export interface FunnelState {
  phase: Phase;
  /** Why booting failed (phase = 'error'); the screen picks localized copy for it. */
  bootError: BootErrorKind | null;
  expiredReason: 'expired' | 'not_found' | null;
  session: SessionState | null;
  answers: Answers;
  currentStepId: string | null;
  /** 1 = forward, -1 = back (drives the slide direction). */
  direction: 1 | -1;
  /** Increments on every navigation. */
  viewToken: number;
  /** Step whose validation message is currently revealed (null = none). */
  errorStepId: string | null;
  /** Increments to replay the shake animation. */
  shakeToken: number;
  result: ResultView;
  /** synced = server has the latest state; pending = save scheduled; offline = saves are failing. */
  sync: 'synced' | 'pending' | 'offline';
}

const INITIAL_STATE: FunnelState = {
  phase: 'booting',
  bootError: null,
  expiredReason: null,
  session: null,
  answers: {},
  currentStepId: null,
  direction: 1,
  viewToken: 0,
  errorStepId: null,
  shakeToken: 0,
  result: { status: 'idle' },
  sync: 'synced',
};

type HistoryMode = 'push' | 'replace' | 'none';

interface GoOptions {
  direction: 1 | -1;
  history: HistoryMode;
  /** Persist the new current step (default true). */
  save?: boolean;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FunnelController {
  private state: FunnelState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private started = false;
  private booted = false;
  private bootToken = 0;
  private resultToken = 0;

  // Debounced state persistence
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight = false;
  private saveQueued = false;
  private saveFailures = 0;
  /** Bumps on every local change; a successful PUT clears `dirty` only if nothing changed meanwhile. */
  private changeCounter = 0;

  // -- store API (useSyncExternalStore) ---------------------------------------

  getSnapshot = (): FunnelState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<FunnelState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // -- lifecycle ------------------------------------------------------------

  /** Attaches listeners and boots once. Safe to call repeatedly (StrictMode). */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('popstate', this.onPopState);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('online', this.onOnline);
    eventQueue.start();
    if (!this.booted) {
      this.booted = true;
      void this.boot(false);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('popstate', this.onPopState);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('online', this.onOnline);
    eventQueue.stop();
  }

  /** Retry after a boot error. */
  retryBoot = (): void => {
    void this.boot(false);
  };

  /** "Start over" / "Start again": forget the session and create a new one. */
  startOver = (): void => {
    this.cancelSave();
    clearSessionStorage(this.state.session?.sessionId ?? getStoredSessionId());
    eventQueue.setContext(null);
    this.resultToken++;
    void this.boot(true);
  };

  private async boot(forceNew: boolean): Promise<void> {
    const token = ++this.bootToken;
    this.set({ ...INITIAL_STATE, viewToken: this.state.viewToken, shakeToken: this.state.shakeToken });

    const url = currentUrl();
    const reset = forceNew || url.searchParams.get('reset') === '1';
    const urlStep = reset ? null : url.searchParams.get('step');
    removeResetParam();

    try {
      const storedId = getStoredSessionId();
      let session: SessionState | null = null;
      let fromCache = false;

      if (reset) {
        clearSessionStorage(storedId);
      } else if (storedId) {
        try {
          session = await getSession(storedId);
        } catch (err) {
          if (token !== this.bootToken) return;
          if (err instanceof ApiError && err.status === 410) {
            this.set({ phase: 'expired', expiredReason: 'expired' });
            return;
          }
          if (err instanceof ApiError && err.status === 404) {
            clearSessionStorage(storedId); // unknown on the server → start fresh below
          } else if (isUnreachable(err)) {
            const cached = readSnapshot(storedId);
            if (!cached) throw err;
            if (Date.parse(cached.expiresAt) < Date.now()) {
              this.set({ phase: 'expired', expiredReason: 'expired' });
              return;
            }
            session = cached;
            fromCache = true;
          } else {
            throw err;
          }
        }
      }

      if (!session) session = await createSession({ query: landingQuery(url) });
      if (token !== this.bootToken) return;
      this.enterSession(session, fromCache, urlStep);
    } catch (err) {
      if (token !== this.bootToken) return;
      this.set({ phase: 'error', bootError: bootErrorKind(err) });
    }
  }

  /** `fromCache`: rendering a cached snapshot because the server was unreachable at boot. */
  private enterSession(session: SessionState, fromCache: boolean, urlStep: string | null): void {
    setStoredSessionId(session.sessionId);
    if (!fromCache) writeSnapshot(session);
    eventQueue.setContext(session);

    // A dirty mirror holds changes the server never acknowledged → it is newer than the server copy.
    const mirror = readMirror(session.sessionId);
    const useMirror = !!mirror && (mirror.dirty || fromCache);
    const answers = useMirror ? mirror.answers : (session.answers ?? {});
    const stored = useMirror ? mirror.currentStepId : session.currentStepId;

    const funnel = session.funnel;
    let target: string | null;
    if (isReachable(funnel, answers, urlStep)) target = urlStep;
    else if (isReachable(funnel, answers, stored)) target = stored;
    else if (stored === null && Object.keys(answers).length === 0)
      target = computeVisibility(funnel, answers).visible[0] ?? null;
    else target = resumeStepId(funnel, answers); // stored step hidden/unreachable → first step lacking a valid answer

    this.set({
      phase: 'ready',
      session,
      answers,
      currentStepId: null,
      sync: fromCache ? 'offline' : 'synced',
    });
    if (!target) {
      this.set({ phase: 'error', bootError: 'empty' });
      return;
    }
    // From cache, the save doubles as a connectivity probe (it retries with backoff until it lands).
    const needsSave = fromCache || (mirror?.dirty ?? false) || target !== stored;
    this.go(target, { direction: 1, history: 'replace', save: needsSave });
  }

  // -- navigation -------------------------------------------------------------

  private get funnel(): ResolvedFunnel | null {
    return this.state.session?.funnel ?? null;
  }

  /** Commits a navigation: state, URL, step_viewed, persistence and (for the result) loading. */
  private go(target: string, opts: GoOptions): void {
    const funnel = this.funnel;
    if (!funnel) return;
    const from = this.state.currentStepId;
    const isResult = funnel.steps[target]?.type === 'result';
    this.resultToken++; // cancels any in-flight result request

    this.set({
      currentStepId: target,
      direction: opts.direction,
      viewToken: this.state.viewToken + 1,
      errorStepId: null,
      result: isResult ? { status: 'loading' } : { status: 'idle' },
    });

    if (opts.history === 'push') pushStep(target, from);
    else if (opts.history === 'replace') replaceStep(target);

    const { visible } = computeVisibility(funnel, this.state.answers);
    eventQueue.track('step_viewed', target, {
      step_type: funnel.steps[target]?.type ?? 'unknown',
      visible_step_index: visible.indexOf(target) + 1,
      visible_step_count: visible.length,
    });

    if (opts.save !== false) this.scheduleSave();
    if (isResult) void this.loadResult();
  }

  /**
   * Continue from the current step. Validates interactive answers; on failure reveals the message
   * and replays the shake. Returns true when navigation happened.
   */
  next = (): boolean => {
    const funnel = this.funnel;
    const cur = this.state.currentStepId;
    if (!funnel || !cur || this.state.phase !== 'ready') return false;
    const step = funnel.steps[cur];
    if (step && isInteractive(step)) {
      const err = validateAnswer(step, this.state.answers[answerKey(step)!]);
      if (err) {
        this.set({ errorStepId: cur, shakeToken: this.state.shakeToken + 1 });
        return false;
      }
      eventQueue.track('answer_submitted', cur, { answer_kind: step.type });
    }
    const target = nextStepId(funnel, this.state.answers, cur);
    if (!target) return false;
    eventQueue.track('step_completed', cur, { next_step_id: target });
    this.go(target, { direction: 1, history: 'push' });
    return true;
  };

  /** In-app back. Uses history.back() when the previous entry is that step, so the stacks stay aligned. */
  back = (): void => {
    const funnel = this.funnel;
    const cur = this.state.currentStepId;
    if (!funnel || !cur) return;
    const prev = prevStepId(funnel, this.state.answers, cur);
    if (!prev) return;
    const entry = readHistoryState();
    if (entry && entry.stepId === cur && entry.from === prev) {
      window.history.back(); // → onPopState emits back_clicked and navigates
      return;
    }
    eventQueue.track('back_clicked', cur, { destination_step_id: prev });
    this.go(prev, { direction: -1, history: 'replace' });
  };

  private onPopState = (): void => {
    const funnel = this.funnel;
    const cur = this.state.currentStepId;
    if (!funnel || !cur || this.state.phase !== 'ready') return;
    const requested = currentUrl().searchParams.get('step');
    if (!requested || requested === cur) return;

    const seq = funnel.stepSequence;
    const reqPos = seq.indexOf(requested);
    const curPos = seq.indexOf(cur);
    const answers = this.state.answers;
    if (reqPos < 0) {
      replaceStep(cur); // foreign/stale entry: keep showing the current step
      return;
    }

    if (reqPos < curPos) {
      // Browser back = in-app back. A step hidden since then falls back to the previous visible one.
      const visible = computeVisibility(funnel, answers).visible.includes(requested);
      const dest = visible ? requested : prevStepId(funnel, answers, cur);
      if (!dest) {
        replaceStep(cur);
        return;
      }
      eventQueue.track('back_clicked', cur, { destination_step_id: dest });
      this.go(dest, { direction: -1, history: dest === requested ? 'none' : 'replace' });
      return;
    }

    // Browser forward: only through steps whose answers are all valid.
    let dest = computeVisibility(funnel, answers).visible.includes(requested)
      ? requested
      : nextStepId(funnel, answers, requested);
    if (!dest) dest = cur;
    const blocked = firstInvalidStepBefore(funnel, answers, dest);
    if (blocked) dest = blocked;
    if (dest === cur) {
      replaceStep(cur);
      if (blocked) this.set({ errorStepId: cur, shakeToken: this.state.shakeToken + 1 });
      return;
    }
    const forward = seq.indexOf(dest) > curPos;
    if (forward) eventQueue.track('step_completed', cur, { next_step_id: dest });
    this.go(dest, { direction: forward ? 1 : -1, history: dest === requested ? 'none' : 'replace' });
  };

  // -- answers ------------------------------------------------------------------

  /** Stores (or clears, with `undefined`) an answer. Hidden-branch answers are kept, never deleted. */
  setAnswer = (key: string, value: unknown): void => {
    const answers = { ...this.state.answers };
    if (value === undefined) delete answers[key];
    else answers[key] = value;
    this.set({ answers });
    this.scheduleSave();
  };

  /** Reveals the validation message of `stepId` if its answer is currently invalid (e.g. on blur). */
  revealErrors = (stepId: string): void => {
    const step = this.funnel?.steps[stepId];
    if (!step || this.state.currentStepId !== stepId) return;
    if (validateAnswer(step, this.state.answers[answerKey(step) ?? '']) !== null) this.set({ errorStepId: stepId });
  };

  // -- result ---------------------------------------------------------------------

  retryResult = (): void => {
    const funnel = this.funnel;
    const cur = this.state.currentStepId;
    if (funnel && cur && funnel.steps[cur]?.type === 'result') void this.loadResult();
  };

  private async loadResult(): Promise<void> {
    const funnel = this.funnel;
    const session = this.state.session;
    const resultStepId = this.state.currentStepId;
    if (!funnel || !session || !resultStepId) return;
    const token = ++this.resultToken;
    const answers = this.state.answers;

    // Should not happen thanks to the navigation guards, but never ask the server for a result
    // we already know it will refuse.
    const invalid = firstInSequence(funnel, Object.keys(validateVisibleAnswers(funnel, answers)));
    if (invalid) {
      this.redirectToInvalid(invalid);
      return;
    }

    this.set({ result: { status: 'loading' } });
    try {
      const [res] = await Promise.all([submitResult(session.sessionId, answers), delay(MIN_RESULT_LOADER_MS)]);
      if (token !== this.resultToken) return;
      this.set({
        result: { status: 'ready', resultId: res.resultId, result: res.result },
        session: { ...session, resultId: res.resultId },
      });
      eventQueue.track('result_viewed', resultStepId, { result_id: res.resultId });
    } catch (err) {
      if (token !== this.resultToken) return;
      if (err instanceof ApiError && err.code === 'invalid_answers' && err.details) {
        const bad = firstInSequence(funnel, Object.keys(err.details));
        if (bad) {
          this.redirectToInvalid(bad);
          return;
        }
      }
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
        this.set({ phase: 'expired', expiredReason: err.status === 410 ? 'expired' : 'not_found' });
        return;
      }
      this.set({ result: { status: 'error' } });
    }
  }

  private redirectToInvalid(stepId: string): void {
    this.go(stepId, { direction: -1, history: 'replace' });
    this.set({ errorStepId: stepId });
  }

  /**
   * Primary CTA. Always emits cta_clicked; when it opens the plan panel (`expanding`) it also emits
   * recommendation_expanded — only if the pinned config allows that event (v3+).
   */
  ctaClicked = (expanding: boolean): void => {
    const funnel = this.funnel;
    const r = this.state.result;
    const stepId = this.state.currentStepId;
    if (!funnel || r.status !== 'ready' || !stepId) return;
    const action = r.result.cta.action;
    eventQueue.track('cta_clicked', stepId, { result_id: r.resultId, action });
    if (expanding && isEventAllowed(funnel, RECOMMENDATION_EXPANDED)) {
      eventQueue.track(RECOMMENDATION_EXPANDED, stepId, { result_id: r.resultId, action, source: 'result_cta' });
    }
  };

  // -- persistence -------------------------------------------------------------

  private scheduleSave(): void {
    const session = this.state.session;
    if (!session) return;
    this.changeCounter++;
    writeMirror(session.sessionId, {
      answers: this.state.answers,
      currentStepId: this.state.currentStepId,
      dirty: true,
      savedAt: new Date().toISOString(),
    });
    if (this.state.sync === 'synced') this.set({ sync: 'pending' });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save(false);
    }, SAVE_DEBOUNCE_MS);
  }

  private cancelSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.saveTimer = null;
    this.retryTimer = null;
    this.saveQueued = false;
    this.saveFailures = 0;
  }

  private async save(keepalive: boolean): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    if (this.saveInFlight) {
      this.saveQueued = true;
      return;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const sessionId = session.sessionId;
    const revision = this.changeCounter;
    const body = { answers: this.state.answers, currentStepId: this.state.currentStepId };

    this.saveInFlight = true;
    try {
      await putSessionState(sessionId, body, { keepalive });
      if (this.state.session?.sessionId !== sessionId) return;
      this.saveFailures = 0;
      if (revision === this.changeCounter) {
        writeMirror(sessionId, { ...body, dirty: false, savedAt: new Date().toISOString() });
        this.set({ sync: 'synced' });
      }
    } catch (err) {
      if (this.state.session?.sessionId !== sessionId) return;
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
        this.cancelSave();
        this.set({ phase: 'expired', expiredReason: err.status === 410 ? 'expired' : 'not_found' });
        return;
      }
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429
      ) {
        // The server refused this payload; retrying it unchanged cannot succeed. The mirror stays dirty.
        console.warn('[funnel] state update refused by the server', err);
        return;
      }
      this.saveFailures++;
      this.set({ sync: 'offline' });
      const wait = Math.min(SAVE_RETRY_MAX_MS, SAVE_RETRY_BASE_MS * 2 ** (this.saveFailures - 1));
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.save(false);
      }, wait);
    } finally {
      this.saveInFlight = false;
      if (this.saveQueued) {
        this.saveQueued = false;
        void this.save(false);
      }
    }
  }

  /** Leaving the page: flush a pending debounced save with keepalive so it survives unload. */
  private onPageHide = (): void => {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.save(true);
    }
  };

  private onOnline = (): void => {
    if (this.state.sync === 'offline') {
      this.saveFailures = 0;
      void this.save(false);
    }
  };
}
