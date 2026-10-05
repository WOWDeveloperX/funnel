import { parseConfig, progressFor, resolveFunnel } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import v3Config from '../../../configs/funnel-v3.json';
import { progressSegments } from '../src/funnel/progress';
import { stringsFor } from '../src/funnel/i18n';

const v1A = resolveFunnel(parseConfig(v1Config), 'A');
const v3A = resolveFunnel(parseConfig(v3Config), 'A');

const states = (segs: ReturnType<typeof progressSegments>) => segs.map((s) => `${s.stepId}:${s.state}`);

describe('segmented progress', () => {
  it('shows an undecided branch as a dashed segment that is not counted in N', () => {
    const segs = progressSegments(v1A, {}, 'team_size');
    expect(states(segs)).toEqual([
      'team_size:current',
      'work_mode:todo',
      'priorities:todo',
      'timezone_span:todo',
      'office_days:maybe',
      'async_maturity:todo',
      'tool_count:todo',
    ]);
    const counted = segs.filter((s) => s.state !== 'maybe').length;
    expect(counted).toBe(progressFor(v1A, {}, 'team_size').total);
  });

  it('a decided branch becomes a regular segment or disappears', () => {
    const open = progressSegments(v1A, { team_size: 8, work_mode: 'hybrid' }, 'priorities');
    expect(states(open)).toContain('office_days:todo');
    expect(states(open).slice(0, 3)).toEqual(['team_size:done', 'work_mode:done', 'priorities:current']);
    expect(open.length).toBe(progressFor(v1A, { team_size: 8, work_mode: 'hybrid' }, 'priorities').total);

    const closed = progressSegments(v1A, { team_size: 8, work_mode: 'remote' }, 'priorities');
    expect(closed.map((s) => s.stepId)).not.toContain('office_days');
  });

  it('v3: security_constraints is undecided until priorities are answered', () => {
    expect(states(progressSegments(v3A, { team_size: 5, work_mode: 'remote' }, 'priorities'))).toContain(
      'security_constraints:maybe',
    );
    const withCompliance = { team_size: 5, work_mode: 'remote', priorities: ['compliance'] };
    expect(states(progressSegments(v3A, withCompliance, 'security_constraints'))).toContain(
      'security_constraints:current',
    );
    const without = { team_size: 5, work_mode: 'remote', priorities: ['speed'] };
    expect(progressSegments(v3A, without, 'timezone_span').map((s) => s.stepId)).not.toContain('security_constraints');
  });
});

describe('funnel chrome locale', () => {
  it('follows funnel.locale: ru-* → Russian, everything else → English', () => {
    expect(stringsFor('en-AU').continue).toBe('Continue');
    expect(stringsFor('ru-RU').continue).toBe('Продолжить');
    expect(stringsFor('ru').questions(5)).toBe('5 вопросов');
    expect(stringsFor('ru').questions(2)).toBe('2 вопроса');
    expect(stringsFor(undefined).back).toBe('Back');
  });
});
