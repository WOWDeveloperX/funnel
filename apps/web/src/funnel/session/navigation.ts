/** Pure navigation helpers over a resolved funnel (no state, no side effects). */
import {
  type Answers,
  computeVisibility,
  findResultStepId,
  firstInvalidStepBefore,
  type ResolvedFunnel,
  validateVisibleAnswers,
} from '@funnel/shared';

/** Earliest step id (in sequence order) among `ids`. */
export function firstInSequence(funnel: Pick<ResolvedFunnel, 'stepSequence'>, ids: string[]): string | null {
  const set = new Set(ids);
  return funnel.stepSequence.find((id) => set.has(id)) ?? null;
}

/** First visible interactive step without a valid answer, else the result step (else the last visible). */
export function resumeStepId(funnel: ResolvedFunnel, answers: Answers): string | null {
  const invalid = firstInSequence(funnel, Object.keys(validateVisibleAnswers(funnel, answers)));
  if (invalid) return invalid;
  const { visible } = computeVisibility(funnel, answers);
  const resultId = findResultStepId(funnel);
  if (resultId && visible.includes(resultId)) return resultId;
  return visible[visible.length - 1] ?? null;
}

/** A step may be shown if it is visible and every visible step before it has a valid answer. */
export function isReachable(funnel: ResolvedFunnel, answers: Answers, stepId: string | null): stepId is string {
  if (!stepId) return false;
  return (
    computeVisibility(funnel, answers).visible.includes(stepId) &&
    firstInvalidStepBefore(funnel, answers, stepId) === null
  );
}
