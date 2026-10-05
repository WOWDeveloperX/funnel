import { describe, expect, it } from 'vitest';
import {
  allowedPropertiesFor,
  CORE_EVENTS,
  EventInputSchema,
  filterProperties,
  isEventAllowed,
  isValidTimestamp,
} from '../src/index';
import { resolved, v1, v3 } from './helpers';

describe('events', () => {
  it('core events list', () => {
    expect(CORE_EVENTS).toHaveLength(7);
  });

  it('allowed per version', () => {
    expect(isEventAllowed(resolved(v1(), 'A'), 'recommendation_expanded')).toBe(false);
    expect(isEventAllowed(resolved(v3(), 'A'), 'recommendation_expanded')).toBe(true);
    expect(allowedPropertiesFor(resolved(v3(), 'B'), 'recommendation_expanded')).toEqual([
      'result_id',
      'action',
      'source',
    ]);
    expect(allowedPropertiesFor(resolved(v1(), 'A'), 'nope')).toBeNull();
  });

  it('filterProperties keeps whitelisted primitives only', () => {
    const f = resolved(v1(), 'A');
    expect(
      filterProperties(f, 'step_viewed', {
        step_type: 'number',
        visible_step_index: 2,
        visible_step_count: Number.POSITIVE_INFINITY,
        answer: 42,
        extra: 'x',
      }),
    ).toEqual({ step_type: 'number', visible_step_index: 2 });
    expect(filterProperties(f, 'cta_clicked', { result_id: { nested: true }, action: 'expand' })).toEqual({
      action: 'expand',
    });
    expect(filterProperties(f, 'unknown', { a: 1 })).toEqual({});
  });

  it('EventInput schema', () => {
    const ok = EventInputSchema.safeParse({
      event_id: 'abcdefgh-1234',
      session_id: 's1',
      name: 'step_viewed',
      client_timestamp: new Date().toISOString(),
      step_id: null,
    });
    expect(ok.success).toBe(true);
    expect(
      EventInputSchema.safeParse({ event_id: 'short', session_id: 's', name: 'x', client_timestamp: 't' }).success,
    ).toBe(false);
    expect(isValidTimestamp('2026-10-03T10:00:00.000Z')).toBe(true);
    expect(isValidTimestamp('yesterday')).toBe(false);
  });
});
