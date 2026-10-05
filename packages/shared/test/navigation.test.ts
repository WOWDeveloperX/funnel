import { describe, expect, it } from 'vitest';
import {
  answerKey,
  computeVisibility,
  findResultStepId,
  firstInvalidStepBefore,
  isInteractive,
  nextStepId,
  prevStepId,
  progressFor,
  visibleSteps,
} from '../src/index';
import { resolved, v1, v3 } from './helpers';

describe('visibility — v1 office_days branch', () => {
  for (const variant of ['A', 'B'] as const) {
    const f = resolved(v1(), variant);

    it(`${variant}: hidden when work_mode is missing or remote`, () => {
      expect(computeVisibility(f, {}).visible).not.toContain('office_days');
      expect(computeVisibility(f, { work_mode: 'remote' }).visible).not.toContain('office_days');
    });

    it(`${variant}: visible for hybrid and office`, () => {
      expect(computeVisibility(f, { work_mode: 'hybrid' }).visible).toContain('office_days');
      expect(computeVisibility(f, { work_mode: 'office' }).visible).toContain('office_days');
    });

    it(`${variant}: hidden-step answers are kept out of effective answers`, () => {
      const { effective } = computeVisibility(f, { work_mode: 'remote', office_days: 3 });
      expect(effective).toEqual({ work_mode: 'remote' });
      const reopened = computeVisibility(f, { work_mode: 'office', office_days: 3 });
      expect(reopened.effective.office_days).toBe(3);
    });
  }

  it('A: visible sequence follows the variant order', () => {
    const f = resolved(v1(), 'A');
    expect(computeVisibility(f, { work_mode: 'hybrid' }).visible).toEqual([
      'intro',
      'team_size',
      'work_mode',
      'priorities',
      'timezone_span',
      'office_days',
      'async_maturity',
      'tool_count',
      'result',
    ]);
    expect(visibleSteps(f, {}).map((s) => s.id)).not.toContain('office_days');
  });
});

describe('visibility — v3 security_constraints branch', () => {
  for (const variant of ['A', 'B'] as const) {
    const f = resolved(v3(), variant);
    it(`${variant}: appears only when priorities contains compliance`, () => {
      expect(computeVisibility(f, {}).visible).not.toContain('security_constraints');
      expect(computeVisibility(f, { priorities: ['speed'] }).visible).not.toContain('security_constraints');
      expect(computeVisibility(f, { priorities: ['speed', 'compliance'] }).visible).toContain('security_constraints');
    });
  }

  it('B: shortened sequence without tool_count', () => {
    const f = resolved(v3(), 'B');
    expect(f.stepSequence).not.toContain('tool_count');
    expect(f.steps.tool_count).toBeUndefined();
  });
});

describe('navigation', () => {
  const f = resolved(v1(), 'A');

  it('next/prev skip hidden steps and react to the latest answers', () => {
    expect(nextStepId(f, { work_mode: 'remote' }, 'timezone_span')).toBe('async_maturity');
    expect(nextStepId(f, { work_mode: 'hybrid' }, 'timezone_span')).toBe('office_days');
    expect(prevStepId(f, { work_mode: 'remote' }, 'async_maturity')).toBe('timezone_span');
    expect(prevStepId(f, { work_mode: 'office' }, 'async_maturity')).toBe('office_days');
    expect(prevStepId(f, {}, 'intro')).toBeNull();
    expect(nextStepId(f, {}, 'result')).toBeNull();
    expect(nextStepId(f, {}, null)).toBe('intro');
  });

  it('works from a step that became hidden', () => {
    expect(nextStepId(f, { work_mode: 'remote' }, 'office_days')).toBe('async_maturity');
  });

  it('helpers', () => {
    expect(findResultStepId(f)).toBe('result');
    expect(isInteractive(f.steps.intro)).toBe(false);
    expect(isInteractive(f.steps.team_size)).toBe(true);
    expect(answerKey(f.steps.priorities)).toBe('priorities');
    expect(answerKey(f.steps.intro)).toBeNull();
  });

  it('firstInvalidStepBefore guards forward navigation', () => {
    expect(firstInvalidStepBefore(f, {}, 'work_mode')).toBe('team_size');
    expect(firstInvalidStepBefore(f, { team_size: 5 }, 'work_mode')).toBeNull();
    expect(firstInvalidStepBefore(f, { team_size: 5 }, 'intro')).toBeNull();
  });
});

describe('progressFor', () => {
  it('v1 A: excludes info/result, branch changes total', () => {
    const f = resolved(v1(), 'A');
    expect(progressFor(f, {}, 'team_size')).toEqual({ index: 1, total: 6 });
    expect(progressFor(f, { work_mode: 'remote' }, 'tool_count')).toEqual({ index: 6, total: 6 });
    expect(progressFor(f, { work_mode: 'hybrid' }, 'office_days')).toEqual({ index: 5, total: 7 });
    expect(progressFor(f, { work_mode: 'hybrid' }, 'tool_count')).toEqual({ index: 7, total: 7 });
  });

  it('excluded steps report the number of counted steps before them', () => {
    const f = resolved(v1(), 'A');
    expect(progressFor(f, {}, 'intro')).toEqual({ index: 0, total: 6 });
    expect(progressFor(f, {}, 'result')).toEqual({ index: 6, total: 6 });
  });

  it('unknown step types (forward-compat fallback) are not counted as questions', () => {
    const f = resolved(v1(), 'A');
    const g = { ...f, steps: { ...f.steps, team_size: { ...f.steps.team_size!, type: 'rating-scale' } } } as typeof f;
    expect(progressFor(g, {}, 'team_size')).toEqual({ index: 0, total: 5 });
    expect(progressFor(g, {}, 'work_mode').total).toBe(5);
  });

  it('v3 A and B totals with both branches', () => {
    const a = resolved(v3(), 'A');
    const b = resolved(v3(), 'B');
    expect(progressFor(a, {}, 'team_size').total).toBe(7);
    expect(progressFor(a, { work_mode: 'office', priorities: ['compliance'] }, 'team_size').total).toBe(9);
    expect(progressFor(b, {}, 'work_mode')).toEqual({ index: 1, total: 6 });
    expect(progressFor(b, { work_mode: 'hybrid', priorities: ['compliance'] }, 'office_days')).toEqual({
      index: 8,
      total: 8,
    });
  });
});
