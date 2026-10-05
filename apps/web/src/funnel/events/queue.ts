/**
 * Client analytics queue.
 *
 * - track() builds an EventInput (random UUID event_id, ISO client_timestamp, session echoes) and
 *   appends it to a queue persisted in localStorage['fr.queue'], so events survive reloads.
 * - Flushes every 1500ms, or immediately once >= 10 events are queued.
 * - An event leaves the queue only when the server acknowledged its id (accepted, duplicate or
 *   rejected). Network/5xx errors retry the same events (same ids) with exponential backoff — safe
 *   because ingest is idempotent by event_id.
 * - On pagehide / visibilitychange=hidden the queue is sent with navigator.sendBeacon. Beaconed
 *   events stay queued until a normal flush acknowledges them (worst case: a reported duplicate).
 * - Events whose name is not in the pinned config's events.allowed (or that are server-only) are
 *   never sent; properties are reduced to the config whitelist before they are queued.
 */
import {
  type EventInput,
  type EventPropertyValue,
  filterProperties,
  isEventAllowed,
  type SessionState,
  SERVER_ONLY_EVENTS,
} from '@funnel/shared';
import { ApiError, postEvents } from '../../lib/api';

const QUEUE_KEY = 'fr.queue';
const FLUSH_INTERVAL_MS = 1500;
const FLUSH_THRESHOLD = 10;
/** Events per request (the API accepts up to 500; smaller batches keep retries cheap). */
const MAX_BATCH = 100;
/** Hard cap so a long offline period cannot fill localStorage. Oldest events are dropped first. */
const MAX_QUEUE = 1000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** sendBeacon payloads are limited (~64KB in most browsers). */
const BEACON_MAX_BYTES = 60_000;
const EVENTS_URL = '/api/events';

/** Session data echoed on every event (the server re-derives it from the session row anyway). */
type QueueContext = Pick<
  SessionState,
  'sessionId' | 'funnelId' | 'funnelVersion' | 'experimentId' | 'variant' | 'utm'
> & {
  funnel: Pick<SessionState['funnel'], 'events'>;
};

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for very old browsers / insecure contexts: still matches [A-Za-z0-9:_-]{8,128}.
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class EventQueue {
  private context: QueueContext | null = null;
  /** Used when localStorage is unavailable. */
  private memory: EventInput[] = [];
  private storageOk = true;

  private inFlight = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /** Session whose config decides which events may be sent and which properties survive. */
  setContext(session: QueueContext | null): void {
    this.context = session;
  }

  /**
   * Queues an event for the current session. Returns false when it was dropped (no session, or the
   * name is not allowed by the session's pinned config).
   */
  track(name: string, stepId: string | null, properties: Record<string, unknown> = {}): boolean {
    const ctx = this.context;
    if (!ctx) return false;
    if (SERVER_ONLY_EVENTS.includes(name) || !isEventAllowed(ctx.funnel, name)) {
      if (import.meta.env.DEV) console.debug(`[events] "${name}" is not allowed for v${ctx.funnelVersion}; dropped`);
      return false;
    }
    const props: Record<string, EventPropertyValue> = filterProperties(ctx.funnel, name, properties);
    const event: EventInput = {
      event_id: newEventId(),
      session_id: ctx.sessionId,
      name,
      client_timestamp: new Date().toISOString(),
      step_id: stepId,
      properties: props,
      funnel_id: ctx.funnelId,
      funnel_version: ctx.funnelVersion,
      experiment_id: ctx.experimentId,
      variant: ctx.variant,
      utm_source: ctx.utm.source,
      utm_medium: ctx.utm.medium,
      utm_campaign: ctx.utm.campaign,
    };
    this.mutate((list) => [...list, event].slice(-MAX_QUEUE));
    if (this.pendingCount() >= FLUSH_THRESHOLD) void this.flush();
    return true;
  }

  /** Sends the oldest batch. No-op while a request is in flight or a backoff retry is pending. */
  async flush(): Promise<void> {
    if (this.inFlight || this.retryTimer) return;
    const batch = this.load().slice(0, MAX_BATCH);
    if (batch.length === 0) return;

    this.inFlight = true;
    try {
      const res = await postEvents(batch);
      const acked = new Set<string>([...res.accepted, ...res.duplicates]);
      for (const r of res.rejected) {
        const id = r.event_id ?? batch[r.index]?.event_id;
        if (id) acked.add(id);
        if (import.meta.env.DEV) console.warn(`[events] rejected ${id ?? `#${r.index}`}: ${r.reason}`);
      }
      this.mutate((list) => list.filter((e) => !acked.has(e.event_id)));
      this.failures = 0;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429
      ) {
        // The envelope itself was refused; retrying the same payload can never succeed.
        const ids = new Set(batch.map((e) => e.event_id));
        this.mutate((list) => list.filter((e) => !ids.has(e.event_id)));
        console.warn('[events] batch refused by the server, dropped', err);
      } else {
        this.failures += 1;
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.failures - 1));
        this.retryTimer = setTimeout(
          () => {
            this.retryTimer = null;
            void this.flush();
          },
          delay + Math.random() * 250,
        );
      }
    } finally {
      this.inFlight = false;
    }

    // Drain quickly if more than a threshold is still waiting.
    if (this.failures === 0 && this.pendingCount() >= FLUSH_THRESHOLD) void this.flush();
  }

  /** Best-effort delivery while the page is being hidden/unloaded. Events stay queued until acked. */
  beacon(): void {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
    let list = this.load();
    while (list.length > 0) {
      let chunk = list.slice(0, MAX_BATCH);
      let body = JSON.stringify({ events: chunk });
      while (body.length > BEACON_MAX_BYTES && chunk.length > 1) {
        chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
        body = JSON.stringify({ events: chunk });
      }
      const ok = navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: 'application/json' }));
      if (!ok) break;
      list = list.slice(chunk.length);
    }
  }

  /** Starts the flush timer and page lifecycle listeners. Idempotent. */
  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.intervalTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('online', this.onOnline);
    void this.flush();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('online', this.onOnline);
  }

  /** Events waiting for delivery (read from storage, so other tabs' events count too). */
  pendingCount(): number {
    return this.load().length;
  }

  // -- internals ------------------------------------------------------------

  private onPageHide = () => this.beacon();

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.beacon();
  };

  private onOnline = () => {
    // Connectivity is back: skip the remaining backoff.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    void this.flush();
  };

  private load(): EventInput[] {
    if (!this.storageOk) return this.memory;
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as EventInput[]) : [];
    } catch {
      this.storageOk = false;
      return this.memory;
    }
  }

  /** Read-modify-write against the latest stored queue, so concurrent tabs do not lose events. */
  private mutate(fn: (list: EventInput[]) => EventInput[]): void {
    const next = fn(this.load());
    if (this.storageOk) {
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
      } catch {
        this.storageOk = false;
      }
    }
    if (!this.storageOk) this.memory = next;
  }
}

/** The app-wide queue. */
export const eventQueue = new EventQueue();
