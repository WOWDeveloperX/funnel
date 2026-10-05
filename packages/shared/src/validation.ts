/**
 * Answer validation. Messages come from `step.validation.messages`, with English defaults.
 */
import type { Answers } from './conditions';
import type { Step, ValidationMessageKey } from './config';
import { answerKey, computeVisibility, isInteractive } from './navigation';
import type { ResolvedFunnel } from './resolve';

export const DEFAULT_VALIDATION_MESSAGES: Record<ValidationMessageKey, string> = {
  required: 'This question requires an answer.',
  min: 'The value is too small.',
  max: 'The value is too large.',
  invalid: 'Enter a valid answer.',
  minSelections: 'Select at least one option.',
  maxSelections: 'Too many options selected.',
};

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function message(step: Pick<Step, 'validation'>, key: ValidationMessageKey, fallback?: string): string {
  return step.validation?.messages?.[key] ?? fallback ?? DEFAULT_VALIDATION_MESSAGES[key];
}

/** Steps are required unless `validation.required === false`. */
function isRequired(step: Pick<Step, 'validation'>): boolean {
  return step.validation?.required !== false;
}

/**
 * Returns an error message, or null when `value` is a valid answer for `step`.
 * info / result / unknown step types are always valid.
 */
export function validateAnswer(step: Pick<Step, 'type' | 'input' | 'validation'>, value: unknown): string | null {
  switch (step.type) {
    case 'number': {
      if (isEmpty(value)) return isRequired(step) ? message(step, 'required') : null;
      if (typeof value !== 'number' || !Number.isFinite(value)) return message(step, 'invalid', 'Enter a number.');
      const { min, max, step: increment } = step.input ?? {};
      if (min !== undefined && value < min) return message(step, 'min', `Enter a value of at least ${min}.`);
      if (max !== undefined && value > max) return message(step, 'max', `Enter a value up to ${max}.`);
      if (increment !== undefined && Number.isInteger(increment) && !Number.isInteger(value)) {
        return message(step, 'invalid', 'Enter a whole number.');
      }
      return null;
    }
    case 'single-select': {
      if (isEmpty(value)) return isRequired(step) ? message(step, 'required', 'Select an option.') : null;
      const options = step.input?.options ?? [];
      if (typeof value !== 'string' || !options.some((o) => o.value === value)) {
        return message(step, 'invalid', 'Select one of the available options.');
      }
      return null;
    }
    case 'multi-select': {
      const list = isEmpty(value) ? [] : value;
      if (!Array.isArray(list)) return message(step, 'invalid', 'Select from the available options.');
      const options = step.input?.options ?? [];
      const allValid = list.every((v) => typeof v === 'string' && options.some((o) => o.value === v));
      const unique = new Set(list).size === list.length;
      if (!allValid || !unique) return message(step, 'invalid', 'Select from the available options.');
      const { minSelections, maxSelections } = step.validation ?? {};
      const effectiveMin = Math.max(minSelections ?? 0, isRequired(step) ? 1 : 0);
      if (list.length < effectiveMin) {
        const fallback =
          list.length === 0 && step.validation?.messages?.required
            ? step.validation.messages.required
            : `Select at least ${effectiveMin} option${effectiveMin === 1 ? '' : 's'}.`;
        return message(step, 'minSelections', fallback);
      }
      if (maxSelections !== undefined && list.length > maxSelections) {
        return message(step, 'maxSelections', `Select no more than ${maxSelections} options.`);
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validates every visible interactive step (computed with the given answers).
 * Returns `{ [stepId]: message }` — empty object when everything is valid.
 * Used by POST /sessions/:id/result and by the client before showing the result.
 */
export function validateVisibleAnswers(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const id of computeVisibility(funnel, answers).visible) {
    const step = funnel.steps[id];
    if (!step || !isInteractive(step)) continue;
    const key = answerKey(step)!;
    const err = validateAnswer(step, answers[key]);
    if (err) errors[id] = err;
  }
  return errors;
}

/**
 * First visible interactive step positioned before `targetId` whose answer is invalid/missing,
 * or null if the user may navigate to `targetId` (used for forward-through-history guards).
 */
export function firstInvalidStepBefore(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
  targetId: string,
): string | null {
  const targetPos = funnel.stepSequence.indexOf(targetId);
  if (targetPos < 0) return null;
  for (const id of computeVisibility(funnel, answers).visible) {
    if (funnel.stepSequence.indexOf(id) >= targetPos) break;
    const step = funnel.steps[id];
    if (!step || !isInteractive(step)) continue;
    if (validateAnswer(step, answers[answerKey(step)!]) !== null) return id;
  }
  return null;
}
