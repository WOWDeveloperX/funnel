/**
 * View model of a candidate config's validation (POST /admin/versions/validate): checklist rows with
 * UI copy for every server issue, and the +/−/~/= diff lines vs the active version. Pure data in the
 * language of the given dictionary section (Russian by default); ValidationReport.tsx renders it.
 */
import { conditionAnswerNames, type ConfigDiff, parseConfig, type ValidateResponse } from '@funnel/shared';
import { type AdminMessages, ru } from '../i18n/ru';

/** The `validation` section of an admin dictionary. */
export type ValidationCopy = AdminMessages['validation'];

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export type CheckState = 'ok' | 'error' | 'warning' | 'info';

export interface BranchInfo {
  stepId: string;
  dependsOn: string[];
}

export interface CheckRow {
  key: string;
  state: CheckState;
  /** Row text; for `variants` / `branches` rows it is the label in front of the list. */
  text: string;
  /** JSON path shown under the text (error mode). */
  path?: string;
  /** Step count per variant (rendered as variant badges). */
  variants?: { key: string; stepCount: number }[];
  /** Steps with `visibleWhen` (rendered as step ids). */
  branches?: BranchInfo[];
}

export type CheckKey = 'schema' | 'steps' | 'results' | 'default';

const CHECKS: { key: CheckKey; path: string }[] = [
  { key: 'schema', path: 'schema' },
  { key: 'steps', path: 'experiment.variants[].stepSequence' },
  { key: 'results', path: 'resultRules[].resultId' },
  { key: 'default', path: 'defaultResultId' },
];

/** "path: message" → { path, message } (paths never contain spaces). */
export function splitIssue(issue: string): { path: string | null; message: string } {
  const idx = issue.indexOf(': ');
  if (idx > 0 && !/\s/.test(issue.slice(0, idx))) return { path: issue.slice(0, idx), message: issue.slice(idx + 2) };
  return { path: null, message: issue };
}

/** Which check an error belongs to. */
export function categorize(path: string | null, message: string): CheckKey {
  const where = path ?? message;
  if (/stepSequence/.test(where)) return 'steps';
  if (/^resultRules|resultOverrides|^results\b/.test(where)) return 'results';
  if (/defaultResultId/.test(where)) return 'default';
  return 'schema';
}

/**
 * UI text for one server issue message (English, from validateConfig in @funnel/shared) in the
 * dictionary's language; messages without a rule (and every message in English) are returned as is.
 */
export function translateIssue(message: string, path?: string | null, v: ValidationCopy = ru.validation): string {
  const unknownResult = message.match(/^unknown result "(.+)"$/);
  if (unknownResult && path === 'defaultResultId') return v.unknownDefault(unknownResult[1]!);
  for (const rule of v.issues) {
    const m = message.match(rule.re);
    if (m) return rule.text(m);
  }
  return message;
}

/** Steps with `visibleWhen`, computed with the shared engine helpers from the raw candidate. */
function branchesOf(raw: unknown): BranchInfo[] {
  try {
    const config = parseConfig(raw);
    return Object.values(config.steps)
      .filter((s) => s.visibleWhen)
      .map((s) => ({ stepId: s.id, dependsOn: conditionAnswerNames(s.visibleWhen) }));
  } catch {
    return [];
  }
}

/**
 * One row per check. A valid config gets every check ticked plus variants and branches; an invalid
 * one expands each failed check into one row per error with its JSON path. Warnings and the
 * "already published" state follow.
 */
export function buildCheckRows(result: ValidateResponse, raw: unknown, v: ValidationCopy = ru.validation): CheckRow[] {
  const rows: CheckRow[] = [];
  const { summary } = result;

  if (result.ok) {
    for (const c of CHECKS) rows.push({ key: c.key, state: 'ok', text: v.checks[c.key] });
    if (summary && summary.variants.length > 0) {
      rows.push({
        key: 'variants',
        state: 'ok',
        text: v.variants,
        variants: summary.variants.map((x) => ({ key: x.key, stepCount: x.stepCount })),
      });
    }
    const branches = branchesOf(raw);
    rows.push(
      branches.length === 0
        ? { key: 'branches', state: 'ok', text: v.noBranches }
        : { key: 'branches', state: 'ok', text: v.branches, branches },
    );
  } else {
    const byCheck = new Map<CheckKey, { path: string | null; message: string }[]>();
    for (const issue of result.errors) {
      const parts = splitIssue(issue);
      const key = categorize(parts.path, parts.message);
      byCheck.set(key, [...(byCheck.get(key) ?? []), parts]);
    }
    for (const c of CHECKS) {
      const errors = byCheck.get(c.key);
      if (!errors) {
        rows.push({ key: c.key, state: 'ok', text: v.checks[c.key], path: c.path });
        continue;
      }
      errors.forEach((e, i) =>
        rows.push({
          key: `${c.key}-${i}`,
          state: 'error',
          text: translateIssue(e.message, e.path, v),
          path: e.path ?? c.path,
        }),
      );
    }
  }

  result.warnings.forEach((w, i) => {
    const parts = splitIssue(w);
    rows.push({
      key: `warn-${i}`,
      state: 'warning',
      text: translateIssue(parts.message, parts.path, v),
      path: parts.path ?? undefined,
    });
  });

  if (summary && result.existing === 'identical') {
    rows.push({ key: 'existing', state: 'info', text: v.identical(summary.version) });
  }
  if (summary && result.existing === 'conflict') {
    rows.push({
      key: 'existing',
      state: 'error',
      text: v.conflict(summary.version),
      path: 'version',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DiffSign = '+' | '−' | '~' | '=';

export interface DiffLine {
  sign: DiffSign;
  group: string;
  text: string;
}

/** Diff vs the active version as lines grouped by steps, variants, experiment, events and results. */
export function diffLines(diff: ConfigDiff, v: ValidationCopy = ru.validation): DiffLine[] {
  const lines: DiffLine[] = [];
  const push = (sign: DiffSign, group: string, items: string[]) =>
    items.forEach((text) => lines.push({ sign, group, text }));

  // Steps
  const before = lines.length;
  push('+', 'steps', diff.stepsAdded);
  push('−', 'steps', diff.stepsRemoved);
  push('~', 'steps', diff.stepsChanged);
  if (lines.length === before) lines.push({ sign: '=', group: 'steps', text: v.unchanged });

  // Variants: only what the global step changes don't already explain.
  for (const key of Object.keys(diff.variants).sort()) {
    const variant = diff.variants[key]!;
    const group = `variant ${key}`;
    if (variant.sequence.length === 0) {
      lines.push({ sign: '−', group, text: v.variantRemoved });
      continue;
    }
    push(
      '+',
      group,
      variant.added.filter((s) => !diff.stepsAdded.includes(s)),
    );
    push(
      '−',
      group,
      variant.removed.filter((s) => !diff.stepsRemoved.includes(s)),
    );
    if (variant.reordered) lines.push({ sign: '~', group, text: v.reordered });
  }
  if (diff.experimentChanged) lines.push({ sign: '~', group: 'experiment', text: v.experimentChanged });

  // Events
  const ev = lines.length;
  push('+', 'events', diff.eventsAdded);
  push('−', 'events', diff.eventsRemoved);
  if (lines.length === ev) lines.push({ sign: '=', group: 'events', text: v.unchanged });

  // Results
  const rs = lines.length;
  push('+', 'results', diff.resultsAdded);
  push('−', 'results', diff.resultsRemoved);
  if (lines.length === rs) lines.push({ sign: '=', group: 'results', text: v.unchanged });

  return lines;
}
