import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assignVariant, fnv1a32 } from '../src/index';
import { v1 } from './helpers';

describe('fnv1a32', () => {
  it('matches reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('assignVariant', () => {
  const experiment = v1().experiment;

  it('is deterministic', () => {
    const id = 'c0ffee00-1111-2222-3333-444455556666';
    const first = assignVariant(experiment, id);
    for (let i = 0; i < 10; i++) expect(assignVariant(experiment, id)).toBe(first);
  });

  it('splits roughly 50/50 over 2000 ids', () => {
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 2000; i++) counts[assignVariant(experiment, randomUUID())]!++;
    expect(counts.A! + counts.B!).toBe(2000);
    expect(counts.A!).toBeGreaterThan(850);
    expect(counts.A!).toBeLessThan(1150);

    const seq: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 2000; i++) seq[assignVariant(experiment, `session-${i}`)]!++;
    expect(seq.A!).toBeGreaterThan(850);
    expect(seq.A!).toBeLessThan(1150);
  });

  it('respects weights', () => {
    const skewed = { id: 'x', variants: { A: { weight: 0 }, B: { weight: 100 } } };
    expect(assignVariant(skewed, 'anything')).toBe('B');
  });
});
