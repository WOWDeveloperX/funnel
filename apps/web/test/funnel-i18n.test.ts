/**
 * Funnel content localization wiring: the session's catalogs translate the pinned funnel into the
 * selected UI language without touching anything the controller, navigation or analytics rely on.
 */
import {
  collectMessages,
  parseCatalog,
  parseConfig,
  resolveFunnel,
  type ResolvedFunnel,
  type SessionState,
  translate,
  unitFor,
} from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import v3Config from '../../../configs/funnel-v3.json';
import ruCatalogJson from '../../../configs/translations/workstyle-planner.ru.json';
import { stringsFor } from '../src/funnel/i18n/strings';
import { localizeResultView, localizeSession } from '../src/funnel/localize';
import { landingQuery } from '../src/funnel/session/url';

const ru = parseCatalog(ruCatalogJson);
const v3 = parseConfig(v3Config);

function session(variant: 'A' | 'B', translations = [ru]): Pick<SessionState, 'funnel' | 'translations'> {
  return { funnel: resolveFunnel(v3, variant), translations };
}

/** Everything behaviour depends on: ids, order, answer keys, option values, limits, conditions, events. */
function structure(f: ResolvedFunnel) {
  return {
    ids: [f.funnelId, f.version, f.variant, f.experimentId, f.locale],
    sequence: f.stepSequence,
    steps: Object.values(f.steps).map((s) => ({
      id: s.id,
      type: s.type,
      name: s.input?.name,
      values: s.input?.options?.map((o) => o.value),
      limits: [s.input?.min, s.input?.max, s.input?.step],
      validation: { ...s.validation, messages: Object.keys(s.validation?.messages ?? {}) },
      visibleWhen: s.visibleWhen,
    })),
    rules: f.resultRules,
    defaultResultId: f.defaultResultId,
    results: Object.values(f.results).map((r) => [r.id, r.cta.action, r.recommendations.length]),
    events: f.events,
  };
}

describe('funnel content in the UI language', () => {
  it('Russian (default) translates the source-language funnel through the session catalog', () => {
    const s = session('B');
    const { funnel, catalog } = localizeSession(s, 'ru');
    expect(catalog?.locale).toBe('ru');

    const raw = s.funnel;
    expect(funnel.title).toBe(translate(raw.title, ru));
    expect(funnel.title).not.toBe(raw.title);
    // The variant B framing (intro override) is translated as B, not as the base copy.
    expect(funnel.steps.intro!.content.title).toBe(translate(raw.steps.intro!.content.title!, ru));
    expect(funnel.steps.intro!.content.title).not.toBe(translate(v3.steps.intro!.content.title!, ru));
    // Options, validation messages and result copy too.
    const work = funnel.steps.work_mode!;
    expect(work.input!.options!.map((o) => o.label)).toEqual(
      raw.steps.work_mode!.input!.options!.map((o) => translate(o.label, ru)),
    );
    expect(work.validation?.messages?.required).toBe(
      translate(raw.steps.work_mode!.validation!.messages!.required!, ru),
    );
    const result = funnel.results.balanced!;
    expect(result.cta.label).toBe(translate(raw.results.balanced!.cta.label, ru));
  });

  it('every user-facing config string has a Russian translation (nothing falls back to English)', () => {
    for (const config of [parseConfig(v1Config), v3]) {
      const missing = collectMessages(config).filter((text) => translate(text, ru) === text);
      expect(missing, `untranslated: ${missing.join(' | ')}`).toEqual([]);
    }
  });

  it('units agree with the number in Russian (1 человек, 2 человека, 5 человек)', () => {
    const { funnel } = localizeSession(session('A'), 'ru');
    const input = funnel.steps.team_size!.input!;
    expect(input.unitForms).toBeDefined();
    const forms = input.unitForms!;
    expect(unitFor(input, 1, 'ru')).toBe(forms.one);
    expect(unitFor(input, 2, 'ru')).toBe(forms.few);
    expect(unitFor(input, 5, 'ru')).toBe(forms.many);
    expect(unitFor(input, 21, 'ru')).toBe(forms.one);
  });

  it('English shows the source funnel as is (no catalog, same object)', () => {
    const s = session('A');
    const { funnel, catalog } = localizeSession(s, 'en');
    expect(catalog).toBeNull();
    expect(funnel).toBe(s.funnel);
    expect(unitFor(funnel.steps.team_size!.input!, 2, 'en')).toBe('people');
  });

  it('switching the language changes only copy: structure, ids and the session stay untouched', () => {
    const s = session('A');
    const before = JSON.stringify(s);
    const inRu = localizeSession(s, 'ru').funnel;
    const inEn = localizeSession(s, 'en').funnel;
    expect(structure(inRu)).toEqual(structure(inEn));
    expect(JSON.stringify(s)).toBe(before); // pure: the controller's funnel is never mutated
  });

  it('a snapshot cached before catalogs existed renders in the source language', () => {
    const legacy = { funnel: resolveFunnel(v3, 'A') } as Pick<SessionState, 'funnel'>;
    const { funnel, catalog } = localizeSession(legacy, 'ru');
    expect(catalog).toBeNull();
    expect(funnel.title).toBe(v3.title);
  });

  it('the result view is translated; the tag uses a catalog translation of the humanized id when there is one', () => {
    const raw = resolveFunnel(v3, 'A').results.balanced!;
    const ready = { status: 'ready' as const, resultId: 'balanced', result: raw };
    const view = localizeResultView(ready, ru);
    expect(view.status).toBe('ready');
    if (view.status !== 'ready') return;
    expect(view.result.title).toBe(translate(raw.title, ru));
    expect(view.result.recommendations).toEqual(raw.recommendations.map((r) => translate(r, ru)));
    // No `badge` in the config: the tag is the humanized id, translated through the catalog.
    expect(raw.badge).toBeUndefined();
    expect(view.result.badge).toBe(ru.messages['balanced']);
    expect(view.result.badge).not.toBe('balanced');
    // Non-ready views and the source language pass through unchanged.
    expect(localizeResultView({ status: 'loading' }, ru)).toEqual({ status: 'loading' });
    expect(localizeResultView(ready, null)).toBe(ready);
  });
});

describe('funnel chrome strings follow the UI language', () => {
  it('pluralises the intro question count', () => {
    expect(stringsFor('ru').questions(1)).toBe('1 вопрос');
    expect(stringsFor('ru').questions(3)).toBe('3 вопроса');
    expect(stringsFor('ru').questions(8)).toBe('8 вопросов');
    expect(stringsFor('en').questions(1)).toBe('1 question');
    expect(stringsFor('en').questions(8)).toBe('8 questions');
  });

  it('`lang` is a UI preference: it is never sent with the landing query that creates a session', () => {
    const url = new URL('http://localhost/?lang=en&utm_campaign=spring&variant=B&step=intro&reset=1');
    expect(landingQuery(url)).toEqual({ utm_campaign: 'spring', variant: 'B' });
  });
});
