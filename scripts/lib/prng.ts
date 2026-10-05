/**
 * Tiny seeded PRNG (mulberry32) with the helpers the simulators need. Seeding makes the simulated
 * *behaviour* reproducible; ids (session ids from the server, event ids) stay globally unique.
 */

/** mulberry32: 32-bit state, good enough statistical quality for traffic simulation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a seed with a salt (e.g. a session index) into an independent child seed. */
function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private readonly nextFloat: () => number;

  constructor(readonly seed: number) {
    this.nextFloat = mulberry32(seed);
  }

  /** Independent generator derived from this seed (stable regardless of call order elsewhere). */
  fork(salt: number): Rng {
    return new Rng(mixSeed(this.seed, salt));
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextFloat();
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks one item with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (items.length === 0 || total <= 0) throw new Error('Rng.weighted needs positive weights');
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** `k` distinct items, weighted, without replacement (result keeps the original item order). */
  weightedSample<T>(items: readonly T[], weights: readonly number[], k: number): T[] {
    const pool = items.map((item, i) => ({ item, w: weights[i] ?? 1, i }));
    const chosen: { item: T; i: number }[] = [];
    while (chosen.length < k && pool.length > 0) {
      const entry = this.weighted(
        pool,
        pool.map((p) => p.w),
      );
      chosen.push(entry);
      pool.splice(pool.indexOf(entry), 1);
    }
    return chosen.sort((a, b) => a.i - b.i).map((c) => c.item);
  }
}
