import { describe, expect, it } from 'vitest';
import { deepMerge, resolveFunnel, UnknownVariantError } from '../src/index';
import { v1, v3 } from './helpers';

describe('resolveFunnel', () => {
  it('A keeps base content', () => {
    const f = resolveFunnel(v1(), 'A');
    expect(f.variant).toBe('A');
    expect(f.version).toBe(1);
    expect(f.experimentId).toBe('question-order-and-result-framing-v1');
    expect(f.overrideQueryParam).toBe('variant');
    expect(f.steps.intro!.content.title).toBe('Build a work model your team can actually follow');
    expect(f.results.balanced!.title).toBe('Balanced baseline');
    expect(f.sessionTtlHours).toBe(72);
    expect(f.progress).toEqual({ countVisibleOnly: true, excludeTypes: ['info', 'result'] });
  });

  it('B deep-merges step and result overrides', () => {
    const f = resolveFunnel(v1(), 'B');
    expect(f.stepSequence[1]).toBe('work_mode');
    expect(f.steps.intro!.content.title).toBe('How should your team really work?');
    expect(f.steps.intro!.type).toBe('info');
    expect(f.steps.priorities!.content.title).toBe('What would make the biggest difference right now?');
    // non-overridden nested fields survive
    expect(f.steps.priorities!.input?.options).toHaveLength(5);
    expect(f.steps.priorities!.validation?.maxSelections).toBe(3);
    expect(f.results.office_core!.title).toBe('Your office model can be more intentional');
    expect(f.results.office_core!.recommendations).toHaveLength(3);
  });

  it('v3 B results titles and only its own steps', () => {
    const f = resolveFunnel(v3(), 'B');
    expect(f.results.regulated_scale!.title).toBe('Your team needs a compliance-aware operating model');
    expect(f.results.meeting_heavy!.cta.label).toBe('Open the implementation details');
    expect(Object.keys(f.steps).sort()).toEqual([...f.stepSequence].sort());
    expect(f.events.allowed.map((e) => e.name)).toContain('recommendation_expanded');
  });

  it('does not mutate the source config and rejects unknown variants', () => {
    const cfg = v1();
    resolveFunnel(cfg, 'B');
    expect(cfg.steps.intro!.content.title).toBe('Build a work model your team can actually follow');
    expect(() => resolveFunnel(cfg, 'C')).toThrow(UnknownVariantError);
  });

  it('deepMerge: objects merge, arrays replace', () => {
    expect(deepMerge({ a: { x: 1, y: 2 }, list: [1, 2, 3] }, { a: { y: 3 }, list: [9] })).toEqual({
      a: { x: 1, y: 3 },
      list: [9],
    });
  });
});
