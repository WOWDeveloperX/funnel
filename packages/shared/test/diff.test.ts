import { describe, expect, it } from 'vitest';
import { diffConfigs } from '../src/index';
import { v1, v3 } from './helpers';

describe('diffConfigs v1 → v3', () => {
  const d = diffConfigs(v1(), v3());

  it('versions', () => {
    expect(d.fromVersion).toBe(1);
    expect(d.toVersion).toBe(3);
  });

  it('per-variant sequence changes', () => {
    expect(d.variants.A!.added).toEqual(['security_constraints', 'meeting_hours']);
    expect(d.variants.A!.removed).toEqual([]);
    expect(d.variants.A!.reordered).toBe(false);
    expect(d.variants.B!.added).toEqual(['meeting_hours', 'security_constraints']);
    expect(d.variants.B!.removed).toEqual(['tool_count']);
    expect(d.variants.B!.sequence).toEqual(v3().experiment.variants.B!.stepSequence);
  });

  it('steps, events, results, experiment', () => {
    expect(d.stepsAdded.sort()).toEqual(['meeting_hours', 'security_constraints']);
    expect(d.stepsRemoved).toEqual([]);
    expect(d.stepsChanged).toEqual(['priorities']); // new "compliance" option
    expect(d.eventsAdded).toEqual(['recommendation_expanded']);
    expect(d.eventsRemoved).toEqual([]);
    expect(d.resultsAdded).toEqual(['regulated_scale', 'meeting_heavy']);
    expect(d.resultsRemoved).toEqual([]);
    expect(d.experimentChanged).toBe(true);
  });

  it('identical configs produce an empty diff', () => {
    const same = diffConfigs(v1(), v1());
    expect(same.variants.A).toEqual({
      added: [],
      removed: [],
      reordered: false,
      sequence: v1().experiment.variants.A!.stepSequence,
    });
    expect(same.stepsChanged).toEqual([]);
    expect(same.experimentChanged).toBe(false);
  });

  it('detects reordering', () => {
    const b = v1();
    b.experiment.variants.A!.stepSequence = [...v1().experiment.variants.B!.stepSequence];
    expect(diffConfigs(v1(), b).variants.A!.reordered).toBe(true);
  });
});
