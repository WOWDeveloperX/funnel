/**
 * The publish checklist shows server validation issues in Russian: every issue the shared validator
 * produces for a broken config must be translated and filed under a check.
 */
import { validateConfig, type ValidateResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import { buildCheckRows, categorize, splitIssue, translateIssue } from '../src/admin/versions/validationModel';

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixtures poke into raw JSON

/** v1 with one deliberate defect per case. */
const BROKEN: Record<string, (c: Mutable) => void> = {
  'unknown step in a sequence': (c) => c.experiment.variants.A.stepSequence.splice(1, 0, 'ghost_step'),
  'duplicate step': (c) => c.experiment.variants.B.stepSequence.splice(1, 0, 'work_mode'),
  'result step not last': (c) => c.experiment.variants.A.stepSequence.push('team_size'),
  'unknown result in a rule': (c) => (c.resultRules[0].resultId = 'nope'),
  'unknown default result': (c) => (c.defaultResultId = 'missing'),
  'condition on an unknown answer': (c) =>
    (c.steps.office_days.visibleWhen = { answer: 'mystery', operator: 'equals', value: 1 }),
  'missing core event': (c) => (c.events.allowed = c.events.allowed.filter((e: Mutable) => e.name !== 'cta_clicked')),
  'select without options': (c) => delete c.steps.work_mode.input.options,
  'duplicate option value': (c) => c.steps.work_mode.input.options.push({ value: 'remote', label: 'Again' }),
  'min greater than max': (c) => (c.steps.team_size.input.min = 500),
  'id does not match key': (c) => (c.steps.team_size.id = 'team'),
  'all weights zero': (c) => {
    c.experiment.variants.A.weight = 0;
    c.experiment.variants.B.weight = 0;
  },
};

const hasCyrillic = (s: string) => /[А-Яа-яЁё]/.test(s);

/** The server's validate response for a raw config (no active version to diff against). */
function validate(raw: unknown): ValidateResponse {
  const { ok, errors, warnings } = validateConfig(raw);
  return { ok, errors, warnings, summary: null, diff: null, existing: 'new' };
}

describe('validation checklist', () => {
  for (const [name, mutate] of Object.entries(BROKEN)) {
    it(`${name}: every issue is translated and categorized`, () => {
      const raw = structuredClone(v1Config) as Mutable;
      mutate(raw);
      const result = validateConfig(raw);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      for (const issue of [...result.errors, ...result.warnings]) {
        const { path, message } = splitIssue(issue);
        const text = translateIssue(message, path);
        expect(hasCyrillic(text), `untranslated: ${issue}`).toBe(true);
        expect(['schema', 'steps', 'results', 'default']).toContain(categorize(path, message));
      }
    });
  }

  it('builds one error row per issue, each with a JSON path', () => {
    const raw = structuredClone(v1Config) as Mutable;
    raw.defaultResultId = 'missing';
    raw.experiment.variants.A.stepSequence.splice(1, 0, 'ghost_step');
    const result = validate(raw);
    const rows = buildCheckRows(result, raw);
    const errors = rows.filter((r) => r.state === 'error');
    expect(errors).toHaveLength(result.errors.length);
    for (const row of errors) {
      expect(row.path).toBeTruthy();
      expect(hasCyrillic(row.text)).toBe(true);
    }
  });

  it('a valid config ticks every check and lists its branches', () => {
    const result = validate(v1Config);
    expect(result.ok).toBe(true);
    const rows = buildCheckRows(result, v1Config);
    expect(rows.every((r) => r.state === 'ok')).toBe(true);
    expect(rows.find((r) => r.key === 'branches')?.branches?.map((b) => b.stepId)).toContain('office_days');
  });
});
