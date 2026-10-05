import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/index';
import { loadRaw } from './helpers';

// Tests poke arbitrary paths of a raw (unvalidated) config; a loose type keeps them readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const clone = (name: 'funnel-v1.json' | 'funnel-v3.json'): Raw => structuredClone(loadRaw(name)) as Raw;

function errorsOf(mutate: (c: Raw) => void, name: 'funnel-v1.json' | 'funnel-v3.json' = 'funnel-v1.json'): string[] {
  const c = clone(name);
  mutate(c);
  const res = validateConfig(c);
  expect(res.ok).toBe(false);
  expect(res.config).toBeUndefined();
  return res.errors;
}

describe('validateConfig — shipped configs', () => {
  it.each(['funnel-v1.json', 'funnel-v3.json'] as const)('%s is valid', (name) => {
    const res = validateConfig(loadRaw(name));
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.config?.funnelId).toBe('workstyle-planner');
  });

  it('tolerates unknown extra fields', () => {
    const c = clone('funnel-v1.json');
    c.somethingNew = { a: 1 };
    c.steps.intro.content.illustration = 'hero.png';
    const res = validateConfig(c);
    expect(res.ok).toBe(true);
    expect((res.config as Raw).somethingNew).toEqual({ a: 1 });
  });

  it('v3 B warns nothing about removed tool_count (no rule uses it)', () => {
    const res = validateConfig(loadRaw('funnel-v3.json'));
    expect(res.warnings.filter((w) => w.includes('tool_count'))).toEqual([]);
  });
});

describe('validateConfig — broken configs', () => {
  it('shape errors (zod)', () => {
    expect(errorsOf((c) => delete c.steps).join('\n')).toMatch(/steps/);
    expect(errorsOf((c) => (c.version = 'one')).join('\n')).toMatch(/version/);
  });

  it('missing defaultResultId', () => {
    expect(errorsOf((c) => delete c.defaultResultId).join('\n')).toMatch(/defaultResultId/);
  });

  it('unknown defaultResultId', () => {
    expect(errorsOf((c) => (c.defaultResultId = 'ghost'))).toContain('defaultResultId: unknown result "ghost"');
  });

  it('duplicate and unknown steps in a sequence', () => {
    const errs = errorsOf((c) => {
      c.experiment.variants.A.stepSequence = ['intro', 'team_size', 'team_size', 'ghost', 'result'];
    });
    expect(errs).toContain('experiment.variants.A.stepSequence: duplicate step "team_size"');
    expect(errs).toContain('experiment.variants.A.stepSequence: unknown step "ghost"');
  });

  it('sequence must end in a result step', () => {
    const errs = errorsOf((c) => {
      c.experiment.variants.B.stepSequence = ['intro', 'work_mode', 'result', 'tool_count'];
    });
    expect(errs).toContain('experiment.variants.B.stepSequence: must end with a result step');
    expect(errs).toContain('experiment.variants.B.stepSequence: result step "result" must be the last step');
  });

  it('step id must equal its key; unknown step type', () => {
    const errs = errorsOf((c) => {
      c.steps.team_size.id = 'size';
      c.steps.tool_count.type = 'slider';
    });
    expect(errs).toContain('steps.team_size: id "size" does not match its key "team_size"');
    expect(errs).toContain('steps.tool_count: unknown step type "slider"');
  });

  it('select without options; number min > max', () => {
    const errs = errorsOf((c) => {
      delete c.steps.work_mode.input.options;
      c.steps.team_size.input.min = 300;
    });
    expect(errs).toContain('steps.work_mode: single-select step requires input.options');
    expect(errs).toContain('steps.team_size: input.min (300) is greater than input.max (200)');
  });

  it('visibleWhen / rules referencing unknown answers or operators', () => {
    const errs = errorsOf((c) => {
      c.steps.office_days.visibleWhen = { answer: 'workmode', operator: 'in', value: ['office'] };
      c.resultRules[1].when = { answer: 'work_mode', operator: 'equals', value: 'hybrid' };
    });
    expect(errs).toContain('steps.office_days.visibleWhen: references unknown answer "workmode"');
    expect(errs.some((e) => e.startsWith('resultRules[1].when: unknown operator "equals"'))).toBe(true);
  });

  it('rules and overrides referencing unknown results/steps', () => {
    const errs = errorsOf((c) => {
      c.resultRules[0].resultId = 'ghost_result';
      c.experiment.variants.B.stepOverrides.ghost = { content: { title: 'x' } };
      c.experiment.variants.B.resultOverrides.ghost = { title: 'x' };
    });
    expect(errs).toContain('resultRules[0]: unknown resultId "ghost_result"');
    expect(errs).toContain('experiment.variants.B.stepOverrides: unknown step "ghost"');
    expect(errs).toContain('experiment.variants.B.resultOverrides: unknown result "ghost"');
  });

  it('all-zero weights', () => {
    const errs = errorsOf((c) => {
      c.experiment.variants.A.weight = 0;
      c.experiment.variants.B.weight = 0;
    });
    expect(errs).toContain('experiment.variants: weights are all zero');
  });

  it('missing core events', () => {
    const errs = errorsOf((c) => {
      c.events.allowed = c.events.allowed.filter((e: Raw) => e.name !== 'cta_clicked');
    });
    expect(errs).toContain('events.allowed: missing core event "cta_clicked"');
  });
});

describe('validateConfig — warnings', () => {
  it('branch asked before its dependency', () => {
    const c = clone('funnel-v1.json');
    c.experiment.variants.B.stepSequence = [
      'intro',
      'office_days',
      'work_mode',
      'timezone_span',
      'team_size',
      'async_maturity',
      'priorities',
      'tool_count',
      'result',
    ];
    const res = validateConfig(c);
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain(
      'experiment.variants.B: step "office_days" visibleWhen references "work_mode", which is asked later in this variant',
    );
  });

  it('unused step', () => {
    const c = clone('funnel-v1.json');
    c.steps.extra = { id: 'extra', type: 'info', content: { title: 'Unused' } };
    const res = validateConfig(c);
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain('steps.extra: defined but not used by any variant');
  });
});
