/**
 * Segmented progress bar model. Pure: derived from the resolved funnel + answers with the shared
 * navigation helpers, so it always agrees with `progressFor` ("Step i of N").
 *
 * - one segment per progress-counted visible step (types in `progress.excludeTypes` and unknown
 *   types are skipped);
 * - a conditional step that is hidden only because the answers it depends on are not given yet
 *   is shown as a dashed "maybe" segment (it is NOT counted in N — the counter stays truthful);
 * - once its branch is decided the segment either becomes a regular one or disappears.
 */
import {
  type Answers,
  computeVisibility,
  conditionAnswerNames,
  countsTowardProgress,
  type NavigableFunnel,
} from '@funnel/shared';

export type SegmentState = 'done' | 'current' | 'todo' | 'maybe';

export interface ProgressSegment {
  stepId: string;
  state: SegmentState;
}

export function progressSegments(funnel: NavigableFunnel, answers: Answers, currentId: string): ProgressSegment[] {
  const exclude = new Set(funnel.progress?.excludeTypes ?? ['info', 'result']);
  const visibleOnly = funnel.progress?.countVisibleOnly !== false;
  const { visible, effective } = computeVisibility(funnel, answers);
  const visibleSet = new Set(visible);
  const currentPos = funnel.stepSequence.indexOf(currentId);

  const segments: ProgressSegment[] = [];
  funnel.stepSequence.forEach((id, pos) => {
    const step = funnel.steps[id];
    if (!step || !countsTowardProgress(step, exclude)) return;
    const counted = !visibleOnly || visibleSet.has(id);
    if (!counted) {
      // Hidden conditional step: still possible while any answer its condition reads is missing.
      const names = conditionAnswerNames(step.visibleWhen);
      const undecided = names.length > 0 && names.some((name) => effective[name] === undefined);
      if (undecided && pos > currentPos) segments.push({ stepId: id, state: 'maybe' });
      return;
    }
    const state: SegmentState = id === currentId ? 'current' : pos < currentPos ? 'done' : 'todo';
    segments.push({ stepId: id, state });
  });
  return segments;
}
