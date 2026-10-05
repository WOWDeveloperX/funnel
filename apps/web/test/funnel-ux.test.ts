import { describe, expect, it } from 'vitest';
import { parseConfig, resolveFunnel } from '@funnel/shared';
import v3Config from '../../../configs/funnel-v3.json';
import { stringsFor } from '../src/funnel/i18n/strings';
import { planFor } from '../src/funnel/plan';
import { NAV_SETTLE_MS, NavigationSettle } from '../src/funnel/session/navigationSettle';

describe('NavigationSettle (double click on Continue)', () => {
  it('ignores a second Continue right after a step change, accepts later ones', () => {
    let t = 1_000;
    const settle = new NavigationSettle(NAV_SETTLE_MS, () => t);
    expect(settle.settled()).toBe(true); // nothing happened yet

    settle.mark(); // first click navigated
    t += 120; // second click of a double click
    expect(settle.settled()).toBe(false);
    t += NAV_SETTLE_MS;
    expect(settle.settled()).toBe(true);
  });
});

describe('result plan panel', () => {
  const fallback = stringsFor('en').genericPlan;

  it('falls back to the generic cadence of the funnel language when a result has no plan', () => {
    expect(planFor({}, fallback)).toBe(fallback);
    expect(planFor({ plan: [] }, fallback)).toBe(fallback);
    expect(planFor({}, stringsFor('ru-RU').genericPlan)).toBe(stringsFor('ru').genericPlan);
  });

  it('config plan overrides fallback (variant resultOverrides can replace it)', () => {
    const raw = structuredClone(v3Config) as typeof v3Config & Record<string, unknown>;
    const results = raw.results as Record<string, Record<string, unknown>>;
    (results.balanced as Record<string, unknown>).plan = ['Week one', 'Week two'];
    const variants = (raw.experiment as { variants: Record<string, { resultOverrides: Record<string, unknown> }> })
      .variants;
    variants.B!.resultOverrides = { ...variants.B!.resultOverrides, balanced: { plan: ['B week one'] } };
    const config = parseConfig(raw);
    expect(planFor(resolveFunnel(config, 'A').results.balanced!, fallback)).toEqual(['Week one', 'Week two']);
    expect(planFor(resolveFunnel(config, 'B').results.balanced!, fallback)).toEqual(['B week one']);
  });
});
