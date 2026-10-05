/**
 * The polling loop behind usePolling (createPoller), run with fake timers and a stubbed `document`:
 * one request at a time, one pending timer, hidden tabs skip ticks, and a hide → show while a
 * request is in flight must not start a second loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller } from '../src/admin/lib/usePolling';

const INTERVAL = 1000;

class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private listeners = new Set<() => void>();
  addEventListener(type: string, fn: () => void) {
    if (type === 'visibilitychange') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === 'visibilitychange') this.listeners.delete(fn);
  }
  setVisibility(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    for (const fn of this.listeners) fn();
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

/** A fetcher whose calls stay pending until resolved by hand. */
function manualFetcher() {
  const calls: { signal: AbortSignal; resolve: (v: number) => void }[] = [];
  const fetcher = vi.fn(
    (signal: AbortSignal) =>
      new Promise<number>((resolve) => {
        calls.push({ signal, resolve });
      }),
  );
  return { fetcher, calls };
}

let doc: FakeDocument;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new FakeDocument();
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number | null = INTERVAL) {
  const onData = vi.fn();
  const onError = vi.fn();
  const onFetching = vi.fn();
  const stop = createPoller({ fetcher, intervalMs, onData, onError, onFetching });
  return { stop, onData, onError, onFetching };
}

describe('createPoller', () => {
  it('fetches at once, then once per interval after each response', async () => {
    const fetcher = vi.fn(async () => 42);
    const { stop, onData } = start(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith(42);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetcher).toHaveBeenCalledTimes(3);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.listenerCount).toBe(0);
  });

  it('hide → show during an in-flight request leaves one timer and one fetch per interval', async () => {
    const { fetcher, calls } = manualFetcher();
    const { stop, onData, onFetching } = start(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    doc.setVisibility('hidden');
    doc.setVisibility('visible'); // aborts request #1 and starts #2 at once
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls[0]!.signal.aborted).toBe(true);

    calls[0]!.resolve(1); // the superseded request settles late
    calls[1]!.resolve(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(2);
    expect(onFetching).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetcher).toHaveBeenCalledTimes(3);
    calls[2]!.resolve(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetcher).toHaveBeenCalledTimes(4);
    stop();
  });

  it('skips ticks while the tab is hidden and fetches again when it becomes visible', async () => {
    const fetcher = vi.fn(async () => 'ok');
    const { stop } = start(fetcher);
    await vi.advanceTimersByTimeAsync(0);

    doc.visibilityState = 'hidden'; // no event yet: the tick itself notices
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    doc.setVisibility('visible');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    stop();
  });

  it('reports errors and keeps polling; intervalMs null fetches once', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const a = start(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(failing).toHaveBeenCalledTimes(2);
    a.stop();

    const once = vi.fn(async () => 1);
    const b = start(once, null);
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    doc.setVisibility('visible');
    expect(once).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    b.stop();
  });

  it('stop() aborts the in-flight request and drops its result', async () => {
    const { fetcher, calls } = manualFetcher();
    const { stop, onData } = start(fetcher);
    stop();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(onData).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
