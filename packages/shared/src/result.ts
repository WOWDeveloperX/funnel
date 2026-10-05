/**
 * Result computation: first matching rule over the *effective* answers (hidden-branch answers
 * are ignored), otherwise the default result.
 */
import { type Answers, evaluateCondition } from './conditions';
import { computeVisibility } from './navigation';
import type { ResolvedFunnel, ResolvedResult } from './resolve';

export function computeResultId(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps' | 'resultRules' | 'defaultResultId'>,
  answers: Answers,
): string {
  const { effective } = computeVisibility(funnel, answers);
  const rule = funnel.resultRules.find((r) => evaluateCondition(r.when, effective));
  return rule ? rule.resultId : funnel.defaultResultId;
}

/** The variant-merged result definition, or null if the id is unknown. */
export function resolveResult(funnel: Pick<ResolvedFunnel, 'results'>, resultId: string): ResolvedResult | null {
  return funnel.results[resultId] ?? null;
}
