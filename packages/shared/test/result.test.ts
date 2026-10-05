import { describe, expect, it } from 'vitest';
import { computeResultId, parseConfig, resolveFunnel, resolveResult } from '../src/index';
import { loadRaw, resolved, v1, v3 } from './helpers';

const base1 = {
  team_size: 10,
  priorities: ['focus'],
  timezone_span: 'same',
  async_maturity: 'low',
  tool_count: 5,
};

describe('v1 result rules', () => {
  for (const variant of ['A', 'B'] as const) {
    const f = resolved(v1(), variant);
    it(`${variant}: remote + global → async_native`, () => {
      expect(computeResultId(f, { ...base1, work_mode: 'remote', timezone_span: 'global' })).toBe('async_native');
    });
    it(`${variant}: high async maturity wins over hybrid`, () => {
      expect(computeResultId(f, { ...base1, work_mode: 'hybrid', office_days: 2, async_maturity: 'high' })).toBe(
        'async_native',
      );
    });
    it(`${variant}: hybrid → hybrid_structured, office → office_core`, () => {
      expect(computeResultId(f, { ...base1, work_mode: 'hybrid', office_days: 2 })).toBe('hybrid_structured');
      expect(computeResultId(f, { ...base1, work_mode: 'office', office_days: 5 })).toBe('office_core');
    });
    it(`${variant}: fallback → balanced`, () => {
      expect(computeResultId(f, { ...base1, work_mode: 'remote', timezone_span: 'same' })).toBe('balanced');
      expect(computeResultId(f, {})).toBe('balanced');
    });
  }
});

describe('v3 result rules', () => {
  const base3 = { ...base1, meeting_hours: 4 };
  for (const variant of ['A', 'B'] as const) {
    const f = resolved(v3(), variant);
    it(`${variant}: compliance + strict → regulated_scale`, () => {
      expect(
        computeResultId(f, {
          ...base3,
          work_mode: 'remote',
          priorities: ['compliance'],
          security_constraints: 'strict',
        }),
      ).toBe('regulated_scale');
      expect(
        computeResultId(f, {
          ...base3,
          work_mode: 'remote',
          priorities: ['compliance'],
          security_constraints: 'standard',
        }),
      ).toBe('balanced');
    });
    it(`${variant}: meeting_hours 20 → meeting_heavy (before async_native)`, () => {
      expect(computeResultId(f, { ...base3, work_mode: 'remote', timezone_span: 'global', meeting_hours: 20 })).toBe(
        'meeting_heavy',
      );
      expect(computeResultId(f, { ...base3, work_mode: 'remote', meeting_hours: 15 })).toBe('meeting_heavy');
      expect(computeResultId(f, { ...base3, work_mode: 'remote', meeting_hours: 14 })).toBe('balanced');
    });
    it(`${variant}: hidden security_constraints answer is ignored`, () => {
      // security_constraints stays in storage after compliance is deselected; it must not count.
      const answers = { ...base3, work_mode: 'remote', priorities: ['speed'], security_constraints: 'regulated' };
      expect(computeResultId(f, answers)).toBe('balanced');
    });
  }
});

describe('hidden-step answers are ignored by result rules', () => {
  it('a rule on a hidden branch answer does not fire', () => {
    const raw = loadRaw('funnel-v1.json') as { resultRules: unknown[] };
    raw.resultRules = [
      { resultId: 'office_core', when: { answer: 'office_days', operator: 'gte', value: 3 } },
      ...raw.resultRules,
    ];
    const f = resolveFunnel(parseConfig(raw), 'A');
    const answers = { ...base1, work_mode: 'remote', office_days: 5 };
    expect(computeResultId(f, answers)).toBe('balanced');
    expect(computeResultId(f, { ...answers, work_mode: 'hybrid' })).toBe('office_core');
  });
});

describe('resolveResult', () => {
  it('returns the variant-merged result', () => {
    expect(resolveResult(resolved(v1(), 'A'), 'async_native')?.title).toBe('Async-native');
    const b = resolveResult(resolved(v1(), 'B'), 'async_native');
    expect(b?.title).toBe('Your team is ready to reduce meetings');
    expect(b?.cta.label).toBe('See the 30-day action list');
    expect(b?.summary).toContain('written context'); // non-overridden fields kept
    expect(resolveResult(resolved(v1(), 'A'), 'nope')).toBeNull();
  });
});
