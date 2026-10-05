/**
 * Condition engine shared by visibility (`visibleWhen`) and result rules (`resultRules[].when`).
 *
 * Semantics:
 * - A missing answer (`undefined` or `null`) makes every operator evaluate to `false`,
 *   including `neq` / `nin` (missing is "unknown", not "different") and `exists`.
 * - `contains`: the answer is an array that contains `value`.
 * - Numbers are compared numerically (numeric strings are coerced).
 * - Unknown operators evaluate to `false` (validateConfig reports them as errors).
 */

export const CONDITION_OPERATORS = ['eq', 'neq', 'in', 'nin', 'contains', 'gte', 'gt', 'lte', 'lt', 'exists'] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Leaf condition comparing one stored answer. `operator` is a string so unknown ops survive parsing. */
export interface AnswerCondition {
  answer: string;
  operator: ConditionOperator | (string & {});
  value?: unknown;
}

export interface AllCondition {
  all: Condition[];
}

export interface AnyCondition {
  any: Condition[];
}

export interface NotCondition {
  not: Condition;
}

export type Condition = AnswerCondition | AllCondition | AnyCondition | NotCondition;

/** Answers keyed by `step.input.name`. Values are JSON (string | number | string[] ...). */
export type Answers = Record<string, unknown>;

export function isConditionOperator(op: unknown): op is ConditionOperator {
  return typeof op === 'string' && (CONDITION_OPERATORS as readonly string[]).includes(op);
}

export function isAnswerCondition(c: unknown): c is AnswerCondition {
  return typeof c === 'object' && c !== null && 'answer' in c;
}

export function isAllCondition(c: unknown): c is AllCondition {
  return typeof c === 'object' && c !== null && Array.isArray((c as AllCondition).all);
}

export function isAnyCondition(c: unknown): c is AnyCondition {
  return typeof c === 'object' && c !== null && Array.isArray((c as AnyCondition).any);
}

export function isNotCondition(c: unknown): c is NotCondition {
  return typeof c === 'object' && c !== null && 'not' in c;
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null;
}

/** Converts numbers and numeric strings to a finite number, otherwise null. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Equality with numeric coercion for number-vs-numeric-string and structural equality for arrays/objects. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    return na !== null && nb !== null && na === nb;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** `in` semantics: scalar answer is one of the values; array answer intersects the values. */
function isIn(answer: unknown, list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  if (Array.isArray(answer)) return answer.some((a) => list.some((v) => looseEquals(a, v)));
  return list.some((v) => looseEquals(answer, v));
}

function compareNumbers(answer: unknown, value: unknown, cmp: (a: number, b: number) => boolean): boolean {
  const a = toNumber(answer);
  const b = toNumber(value);
  return a !== null && b !== null && cmp(a, b);
}

function evaluateLeaf(cond: AnswerCondition, answers: Answers): boolean {
  const answer = answers[cond.answer];
  if (isMissing(answer)) return false;
  const { value } = cond;
  switch (cond.operator) {
    case 'eq':
      return looseEquals(answer, value);
    case 'neq':
      return !looseEquals(answer, value);
    case 'in':
      return isIn(answer, value);
    case 'nin':
      return Array.isArray(value) && !isIn(answer, value);
    case 'contains':
      return Array.isArray(answer) && answer.some((a) => looseEquals(a, value));
    case 'gte':
      return compareNumbers(answer, value, (a, b) => a >= b);
    case 'gt':
      return compareNumbers(answer, value, (a, b) => a > b);
    case 'lte':
      return compareNumbers(answer, value, (a, b) => a <= b);
    case 'lt':
      return compareNumbers(answer, value, (a, b) => a < b);
    case 'exists':
      return true; // presence already established above
    default:
      return false; // unknown operator
  }
}

/**
 * Evaluates a condition tree against answers. `all: []` is true, `any: []` is false.
 * Malformed nodes evaluate to false.
 */
export function evaluateCondition(cond: Condition | null | undefined, answers: Answers): boolean {
  if (!cond || typeof cond !== 'object') return false;
  if (isAllCondition(cond)) return cond.all.every((c) => evaluateCondition(c, answers));
  if (isAnyCondition(cond)) return cond.any.some((c) => evaluateCondition(c, answers));
  if (isNotCondition(cond)) return !evaluateCondition(cond.not, answers);
  if (isAnswerCondition(cond)) return evaluateLeaf(cond, answers);
  return false;
}

/** Collects every answer name referenced anywhere in a condition tree (deduplicated, in order). */
export function conditionAnswerNames(cond: Condition | null | undefined): string[] {
  const out: string[] = [];
  const walk = (c: unknown): void => {
    if (!c || typeof c !== 'object') return;
    if (isAllCondition(c)) c.all.forEach(walk);
    else if (isAnyCondition(c)) c.any.forEach(walk);
    else if (isNotCondition(c)) walk(c.not);
    else if (isAnswerCondition(c) && typeof c.answer === 'string' && !out.includes(c.answer)) out.push(c.answer);
  };
  walk(cond);
  return out;
}

/** Collects every leaf condition (used by validateConfig for operator/value checks). */
export function conditionLeaves(cond: Condition | null | undefined): AnswerCondition[] {
  const out: AnswerCondition[] = [];
  const walk = (c: unknown): void => {
    if (!c || typeof c !== 'object') return;
    if (isAllCondition(c)) c.all.forEach(walk);
    else if (isAnyCondition(c)) c.any.forEach(walk);
    else if (isNotCondition(c)) walk(c.not);
    else if (isAnswerCondition(c)) out.push(c);
  };
  walk(cond);
  return out;
}
