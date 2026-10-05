/**
 * Minimal browser stand-ins for DOM-free tests (the web project runs in the node environment):
 * localStorage, window.location + history (with popstate) and document visibility.
 */

export class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

type Listener = (e: { type: string }) => void;

class Listeners {
  private map = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener): void {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.map.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of [...(this.map.get(type) ?? [])]) fn({ type });
  }
  count(type: string): number {
    return this.map.get(type)?.size ?? 0;
  }
}

interface Entry {
  url: string;
  state: unknown;
}

/** window with location.href, a history stack (back() fires popstate) and event listeners. */
export class FakeWindow extends Listeners {
  private entries: Entry[];
  private index = 0;

  constructor(href = 'http://localhost/') {
    super();
    this.entries = [{ url: href, state: null }];
  }

  get location(): { href: string } {
    return { href: this.entries[this.index]!.url };
  }

  get history() {
    return {
      state: this.entries[this.index]!.state,
      pushState: (state: unknown, _title: string, url: string) => {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push({ url: this.resolve(url), state: structuredClone(state) });
        this.index += 1;
      },
      replaceState: (state: unknown, _title: string, url: string) => {
        this.entries[this.index] = { url: this.resolve(url), state: structuredClone(state) };
      },
      back: () => {
        if (this.index === 0) return;
        this.index -= 1;
        this.dispatch('popstate');
      },
    };
  }

  /** Current URL as a URL object. */
  get url(): URL {
    return new URL(this.location.href);
  }

  private resolve(url: string): string {
    return new URL(url, this.location.href).href;
  }
}

export class FakeDocument extends Listeners {
  visibilityState: 'visible' | 'hidden' = 'visible';
}
