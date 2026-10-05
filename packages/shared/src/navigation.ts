/**
 * Visibility, navigation and progress over a resolved funnel. Pure functions: the same code runs
 * in the browser, on the server, in the generator and in tests.
 */
import { type Answers, evaluateCondition } from './conditions';
import { INTERACTIVE_STEP_TYPES, STEP_TYPES, type Step } from './config';
import type { ResolvedFunnel } from './resolve';

/** The subset of ResolvedFunnel the navigation helpers need. */
export type NavigableFunnel = Pick<ResolvedFunnel, 'stepSequence' | 'steps' | 'progress'>;

export interface Visibility {
  /** Visible step ids in sequence order. */
  visible: string[];
  /** Answers of visible steps only (hidden-branch answers are ignored but stay in storage). */
  effective: Answers;
}

export interface ProgressInfo {
  /** 1-based position among counted steps; for excluded types = number of counted steps before it. */
  index: number;
  total: number;
}

/** True for steps that collect an answer (single-select, multi-select, number). */
export function isInteractive(step: Pick<Step, 'type'> | null | undefined): boolean {
  return !!step && (INTERACTIVE_STEP_TYPES as readonly string[]).includes(step.type);
}

/** Answer storage key of a step: `input.name`, falling back to the id for interactive steps; null otherwise. */
export function answerKey(step: Pick<Step, 'id' | 'type' | 'input'> | null | undefined): string | null {
  if (!step) return null;
  if (step.input?.name) return step.input.name;
  return isInteractive(step) ? step.id : null;
}

/** Id of the (first) result step in the sequence, or null. */
export function findResultStepId(funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>): string | null {
  return funnel.stepSequence.find((id) => funnel.steps[id]?.type === 'result') ?? null;
}

/**
 * Walks stepSequence in order. A step is visible iff it has no visibleWhen or the condition holds
 * against answers of *previously visible* steps. Visible steps contribute their answer to `effective`.
 */
export function computeVisibility(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
): Visibility {
  const visible: string[] = [];
  const effective: Answers = {};
  for (const id of funnel.stepSequence) {
    const step = funnel.steps[id];
    if (!step) continue;
    if (step.visibleWhen && !evaluateCondition(step.visibleWhen, effective)) continue;
    visible.push(id);
    const key = answerKey(step);
    if (key && answers[key] !== undefined) effective[key] = answers[key];
  }
  return { visible, effective };
}

/** Visible steps (objects) in order. */
export function visibleSteps(funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>, answers: Answers): Step[] {
  return computeVisibility(funnel, answers).visible.map((id) => funnel.steps[id]!);
}

export function isStepVisible(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
  stepId: string,
): boolean {
  return computeVisibility(funnel, answers).visible.includes(stepId);
}

/** First visible step (normally the intro). */
export function firstStepId(funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>, answers: Answers): string | null {
  return computeVisibility(funnel, answers).visible[0] ?? null;
}

/**
 * Next visible step after `currentId`, recomputed with the latest answers. Works even if the current
 * step itself has become hidden (uses its position in the sequence). `currentId = null` → first step.
 */
export function nextStepId(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
  currentId: string | null,
): string | null {
  const { visible } = computeVisibility(funnel, answers);
  if (currentId === null) return visible[0] ?? null;
  const pos = funnel.stepSequence.indexOf(currentId);
  if (pos < 0) return null;
  return visible.find((id) => funnel.stepSequence.indexOf(id) > pos) ?? null;
}

/** Previous visible step before `currentId`, or null on the first visible step. */
export function prevStepId(
  funnel: Pick<ResolvedFunnel, 'stepSequence' | 'steps'>,
  answers: Answers,
  currentId: string,
): string | null {
  const { visible } = computeVisibility(funnel, answers);
  const pos = funnel.stepSequence.indexOf(currentId);
  if (pos < 0) return null;
  let prev: string | null = null;
  for (const id of visible) {
    if (funnel.stepSequence.indexOf(id) < pos) prev = id;
    else break;
  }
  return prev;
}

/**
 * Whether a step is a question in "Step i of N": a known type not in progress.excludeTypes.
 * Unknown types (a newer config on an older client) render as a skippable fallback, so they are
 * never counted as questions.
 */
export function countsTowardProgress(step: Pick<Step, 'type'> | undefined, exclude: ReadonlySet<string>): boolean {
  return step !== undefined && (STEP_TYPES as readonly string[]).includes(step.type) && !exclude.has(step.type);
}

/**
 * "Step i of N": counts visible (or all, if countVisibleOnly=false) steps that count toward
 * progress (see countsTowardProgress). A branch opening/closing changes `total`.
 */
export function progressFor(funnel: NavigableFunnel, answers: Answers, currentId: string): ProgressInfo {
  const exclude = new Set(funnel.progress?.excludeTypes ?? ['info', 'result']);
  const candidates =
    funnel.progress?.countVisibleOnly === false ? funnel.stepSequence : computeVisibility(funnel, answers).visible;
  const counted = candidates.filter((id) => countsTowardProgress(funnel.steps[id], exclude));
  const total = counted.length;
  const idx = counted.indexOf(currentId);
  if (idx >= 0) return { index: idx + 1, total };
  // Excluded or hidden step: number of counted steps positioned before it.
  const pos = funnel.stepSequence.indexOf(currentId);
  const before = counted.filter((id) => funnel.stepSequence.indexOf(id) < pos).length;
  return { index: pos < 0 ? 0 : before, total };
}
