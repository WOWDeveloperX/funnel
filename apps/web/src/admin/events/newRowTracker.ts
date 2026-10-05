const HIGHLIGHT_MS = 2500;
/** Keep memory bounded on long-running tabs. */
const MAX_TRACKED = 5000;

/**
 * Remembers when each row id of the live log first arrived, per filter `key`. Rows of the first
 * response for a key are the baseline (never "new"); rows arriving later are new for HIGHLIGHT_MS,
 * measured against the latest response. Fed from the fetch callback, read during render.
 */
export class NewRowTracker {
  private key: string | null = null;
  private baselined = false;
  private firstSeen = new Map<string, number>();
  private lastResponseAt = 0;

  /** Records the row ids of a response for filter `key`. */
  observe(key: string, ids: readonly string[], now: number = Date.now()): void {
    if (this.key !== key) {
      this.key = key;
      this.baselined = false;
      this.firstSeen = new Map();
    }
    for (const id of ids) if (!this.firstSeen.has(id)) this.firstSeen.set(id, this.baselined ? now : 0);
    this.baselined = true;
    this.lastResponseAt = now;
    if (this.firstSeen.size > MAX_TRACKED) {
      const keep = new Set(ids);
      for (const id of this.firstSeen.keys()) if (!keep.has(id)) this.firstSeen.delete(id);
    }
  }

  /** Whether row `id` (shown for filter `key`) arrived after the baseline, recently. */
  isNew(key: string, id: string): boolean {
    if (this.key !== key) return false;
    const t = this.firstSeen.get(id);
    return t !== undefined && t > 0 && this.lastResponseAt - t < HIGHLIGHT_MS;
  }
}
