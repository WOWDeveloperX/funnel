import { describe, expect, it } from 'vitest';
import { validateAnswer, validateVisibleAnswers } from '../src/index';
import { resolved, v1 } from './helpers';

const f = resolved(v1(), 'A');

describe('validateAnswer — number', () => {
  const step = f.steps.team_size!;
  it('required / min / max / integer', () => {
    expect(validateAnswer(step, undefined)).toBe('Enter the team size.');
    expect(validateAnswer(step, null)).toBe('Enter the team size.');
    expect(validateAnswer(step, '')).toBe('Enter the team size.');
    expect(validateAnswer(step, 0)).toBe('The team must have at least one person.');
    expect(validateAnswer(step, 201)).toBe('For this demo, enter a value up to 200.');
    expect(validateAnswer(step, 2.5)).toBe('Enter a whole number.');
    expect(validateAnswer(step, Number.NaN)).toBe('Enter a number.');
    expect(validateAnswer(step, '12')).toBe('Enter a number.');
    expect(validateAnswer(step, 1)).toBeNull();
    expect(validateAnswer(step, 200)).toBeNull();
  });

  it('office_days accepts 0..5', () => {
    const od = f.steps.office_days!;
    expect(validateAnswer(od, 0)).toBeNull();
    expect(validateAnswer(od, 6)).toBe('Enter a value from 0 to 5.');
    expect(validateAnswer(od, -1)).toBe('Enter a value from 0 to 5.');
  });
});

describe('validateAnswer — single-select', () => {
  const step = f.steps.work_mode!;
  it('required and option membership', () => {
    expect(validateAnswer(step, undefined)).toBe("Select the team's main work mode.");
    expect(validateAnswer(step, 'remote')).toBeNull();
    expect(validateAnswer(step, 'mars')).toBe('Select one of the available options.');
    expect(validateAnswer(step, ['remote'])).toBe('Select one of the available options.');
  });
});

describe('validateAnswer — multi-select', () => {
  const step = f.steps.priorities!;
  it('min / max / membership / uniqueness', () => {
    expect(validateAnswer(step, undefined)).toBe('Choose at least one priority.');
    expect(validateAnswer(step, [])).toBe('Choose at least one priority.');
    expect(validateAnswer(step, ['speed'])).toBeNull();
    expect(validateAnswer(step, ['speed', 'focus', 'culture'])).toBeNull();
    expect(validateAnswer(step, ['speed', 'focus', 'culture', 'cost'])).toBe('Choose no more than three priorities.');
    expect(validateAnswer(step, ['speed', 'nope'])).toBe('Select from the available options.');
    expect(validateAnswer(step, ['speed', 'speed'])).toBe('Select from the available options.');
    expect(validateAnswer(step, 'speed')).toBe('Select from the available options.');
  });
});

describe('validateAnswer — info/result/unknown', () => {
  it('always valid', () => {
    expect(validateAnswer(f.steps.intro!, undefined)).toBeNull();
    expect(validateAnswer(f.steps.result!, undefined)).toBeNull();
    expect(validateAnswer({ type: 'video' }, undefined)).toBeNull();
  });
});

describe('validateVisibleAnswers', () => {
  const complete = {
    team_size: 8,
    work_mode: 'remote',
    priorities: ['focus'],
    timezone_span: 'same',
    async_maturity: 'low',
    tool_count: 5,
  };
  it('only visible interactive steps are required', () => {
    expect(validateVisibleAnswers(f, complete)).toEqual({});
    expect(validateVisibleAnswers(f, { ...complete, work_mode: 'office' })).toEqual({
      office_days: 'Enter the expected number of office days.',
    });
    expect(Object.keys(validateVisibleAnswers(f, {}))).toEqual([
      'team_size',
      'work_mode',
      'priorities',
      'timezone_span',
      'async_maturity',
      'tool_count',
    ]);
  });
});
