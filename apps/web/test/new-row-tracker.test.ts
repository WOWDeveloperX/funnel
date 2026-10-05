/** Live event log highlighting: which rows count as "new" between polls. */
import { describe, expect, it } from 'vitest';
import { NewRowTracker } from '../src/admin/events/newRowTracker';

describe('NewRowTracker', () => {
  it('the first response is the baseline; later rows are new for one more poll', () => {
    const t = new NewRowTracker();
    t.observe('all', ['a', 'b'], 1_000);
    expect(t.isNew('all', 'a')).toBe(false);

    t.observe('all', ['c', 'a', 'b'], 3_000);
    expect(t.isNew('all', 'c')).toBe(true);
    expect(t.isNew('all', 'a')).toBe(false);

    t.observe('all', ['c', 'a', 'b'], 5_000); // 2 s later: still highlighted
    expect(t.isNew('all', 'c')).toBe(true);
    t.observe('all', ['c', 'a', 'b'], 7_000); // 4 s later: settled
    expect(t.isNew('all', 'c')).toBe(false);
  });

  it('a filter change starts a new baseline', () => {
    const t = new NewRowTracker();
    t.observe('all', ['a'], 1_000);
    t.observe('all', ['b', 'a'], 3_000);
    t.observe('name=cta_clicked', ['b', 'x'], 3_500);
    expect(t.isNew('name=cta_clicked', 'b')).toBe(false);
    expect(t.isNew('name=cta_clicked', 'x')).toBe(false);
    expect(t.isNew('all', 'b')).toBe(false); // other key: nothing is new
  });
});
