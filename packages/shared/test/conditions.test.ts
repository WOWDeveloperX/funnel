import { describe, expect, it } from 'vitest';
import { type Condition, conditionAnswerNames, evaluateCondition } from '../src/index';

const leaf = (answer: string, operator: string, value?: unknown): Condition => ({ answer, operator, value });

describe('evaluateCondition — operators', () => {
  const answers = { mode: 'hybrid', size: 12, sizeStr: '12', tags: ['a', 'compliance'], zero: 0, empty: [] };

  it('eq / neq', () => {
    expect(evaluateCondition(leaf('mode', 'eq', 'hybrid'), answers)).toBe(true);
    expect(evaluateCondition(leaf('mode', 'eq', 'remote'), answers)).toBe(false);
    expect(evaluateCondition(leaf('mode', 'neq', 'remote'), answers)).toBe(true);
    expect(evaluateCondition(leaf('mode', 'neq', 'hybrid'), answers)).toBe(false);
    // numbers compared numerically
    expect(evaluateCondition(leaf('sizeStr', 'eq', 12), answers)).toBe(true);
    expect(evaluateCondition(leaf('zero', 'eq', 0), answers)).toBe(true);
  });

  it('in / nin', () => {
    expect(evaluateCondition(leaf('mode', 'in', ['hybrid', 'office']), answers)).toBe(true);
    expect(evaluateCondition(leaf('mode', 'in', ['remote']), answers)).toBe(false);
    expect(evaluateCondition(leaf('mode', 'nin', ['remote']), answers)).toBe(true);
    expect(evaluateCondition(leaf('mode', 'nin', ['hybrid']), answers)).toBe(false);
    expect(evaluateCondition(leaf('mode', 'in', 'hybrid'), answers)).toBe(false); // non-array value
  });

  it('contains', () => {
    expect(evaluateCondition(leaf('tags', 'contains', 'compliance'), answers)).toBe(true);
    expect(evaluateCondition(leaf('tags', 'contains', 'speed'), answers)).toBe(false);
    expect(evaluateCondition(leaf('mode', 'contains', 'hyb'), answers)).toBe(false); // answer must be an array
    expect(evaluateCondition(leaf('empty', 'contains', 'a'), answers)).toBe(false);
  });

  it('gte / gt / lte / lt', () => {
    expect(evaluateCondition(leaf('size', 'gte', 12), answers)).toBe(true);
    expect(evaluateCondition(leaf('size', 'gt', 12), answers)).toBe(false);
    expect(evaluateCondition(leaf('size', 'lte', 12), answers)).toBe(true);
    expect(evaluateCondition(leaf('size', 'lt', 12), answers)).toBe(false);
    expect(evaluateCondition(leaf('size', 'lt', 13), answers)).toBe(true);
    expect(evaluateCondition(leaf('sizeStr', 'gt', 11), answers)).toBe(true);
    expect(evaluateCondition(leaf('mode', 'gt', 1), answers)).toBe(false); // non-numeric
  });

  it('exists', () => {
    expect(evaluateCondition(leaf('mode', 'exists'), answers)).toBe(true);
    expect(evaluateCondition(leaf('zero', 'exists'), answers)).toBe(true);
    expect(evaluateCondition(leaf('missing', 'exists'), answers)).toBe(false);
  });

  it('unknown operator is false', () => {
    expect(evaluateCondition(leaf('mode', 'matches', 'hybrid'), answers)).toBe(false);
  });
});

describe('evaluateCondition — missing answers', () => {
  it.each(['eq', 'neq', 'in', 'nin', 'contains', 'gte', 'gt', 'lte', 'lt', 'exists'])(
    '%s is false when the answer is missing',
    (op) => {
      const value = op === 'in' || op === 'nin' ? ['x'] : op.startsWith('g') || op.startsWith('l') ? 1 : 'x';
      expect(evaluateCondition(leaf('missing', op, value), {})).toBe(false);
      expect(evaluateCondition(leaf('missing', op, value), { missing: null })).toBe(false);
    },
  );
});

describe('evaluateCondition — combinators', () => {
  const a = { mode: 'remote', tz: 'global', maturity: 'low' };
  const asyncRule: Condition = {
    any: [
      { all: [leaf('mode', 'eq', 'remote'), leaf('tz', 'in', ['wide', 'global'])] },
      leaf('maturity', 'eq', 'high'),
    ],
  };

  it('all / any / not', () => {
    expect(evaluateCondition(asyncRule, a)).toBe(true);
    expect(evaluateCondition(asyncRule, { ...a, tz: 'same' })).toBe(false);
    expect(evaluateCondition(asyncRule, { maturity: 'high' })).toBe(true);
    expect(evaluateCondition({ not: leaf('mode', 'eq', 'remote') }, a)).toBe(false);
    expect(evaluateCondition({ not: leaf('mode', 'eq', 'office') }, a)).toBe(true);
    // not over a missing answer: inner is false → not is true
    expect(evaluateCondition({ not: leaf('missing', 'eq', 'x') }, a)).toBe(true);
  });

  it('empty all is true, empty any is false, malformed is false', () => {
    expect(evaluateCondition({ all: [] }, a)).toBe(true);
    expect(evaluateCondition({ any: [] }, a)).toBe(false);
    expect(evaluateCondition({} as Condition, a)).toBe(false);
    expect(evaluateCondition(undefined, a)).toBe(false);
  });

  it('collects referenced answer names', () => {
    expect(conditionAnswerNames(asyncRule)).toEqual(['mode', 'tz', 'maturity']);
  });
});
