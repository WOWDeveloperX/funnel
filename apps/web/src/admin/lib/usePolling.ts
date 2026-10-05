import { useCallback, useEffect, useEffectEvent, useState } from 'react';

export interface PollerOptions<T> {
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** Delay between the end of one request and the next one; null = fetch once, no polling. */
  intervalMs: number | null;
  onData: (data: T) => void;
  onError: (err: unknown) => void;
  onFetching: (fetching: boolean) => void;
}

const isAbortError = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * Framework-free polling loop (the core of usePolling). Fetches at once, then `intervalMs` after
 * each response. Returns `stop()`.
 *
 * - Requests never overlap: the next tick is scheduled after the previous one settles, and there
 *   is at most one pending timer.
 * - Timer ticks are skipped while the tab is hidden; becoming visible again aborts any in-flight
 *   request and fetches at once. An aborted request never reports data and never schedules.
 */
export function createPoller<T>({ fetcher, intervalMs, onData, onError, onFetching }: PollerOptions<T>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || intervalMs === null) return;
    timer = setTimeout(() => void run(true), intervalMs);
  };

  /** `background` = a timer tick: skipped while the tab is hidden (explicit runs always fetch). */
  async function run(background = false) {
    if (stopped) return;
    if (background && document.visibilityState === 'hidden') {
      schedule();
      return;
    }
    const ctrl = new AbortController();
    controller = ctrl;
    onFetching(true);
    try {
      const result = await fetcher(ctrl.signal);
      if (stopped || ctrl.signal.aborted) return;
      onData(result);
    } catch (err) {
      if (stopped || ctrl.signal.aborted || isAbortError(err)) return;
      onError(err);
    } finally {
      // A superseded (aborted) run leaves scheduling to the run that replaced it.
      if (!stopped && !ctrl.signal.aborted) {
        onFetching(false);
        schedule();
      }
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || intervalMs === null) return;
    clearTimeout(timer);
    controller?.abort();
    void run();
  };

  void run();
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export interface PollingState<T> {
  data: T | undefined;
  /** The `key` that `data` was fetched for (data is kept while a new key loads). */
  dataKey: string | null;
  error: unknown;
  /** True only until the first response for the current `key` arrives. */
  loading: boolean;
  /** True while any request is in flight (initial or background). */
  fetching: boolean;
  /** Fetch now (also resets the poll timer). */
  refresh: () => void;
}

/**
 * Fetches `fetcher` whenever `key` changes and then every `intervalMs` (null = no polling), see
 * createPoller. A key change aborts the in-flight request; previous data is kept until new data
 * arrives so the UI does not flash (pages can show `fetching` instead). The first fetch for a key
 * and `refresh()` always run, also when `intervalMs` is null.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string,
  intervalMs: number | null,
): PollingState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [tick, setTick] = useState(0);

  // Always calls the latest fetcher (it closes over the current filters) without restarting the loop.
  const fetchLatest = useEffectEvent((signal: AbortSignal) => fetcher(signal));

  useEffect(
    () =>
      createPoller({
        fetcher: (signal) => fetchLatest(signal),
        intervalMs,
        onData: (result) => {
          setData(result);
          setDataKey(key);
          setError(null);
          setLoadedKey(key);
        },
        onError: (err) => {
          setError(err);
          setLoadedKey(key);
        },
        onFetching: setFetching,
      }),
    [key, intervalMs, tick],
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, dataKey, error, loading: loadedKey !== key && data === undefined, fetching, refresh };
}
