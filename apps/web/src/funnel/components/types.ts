import type { Step } from '@funnel/shared';

/** Props shared by the interactive step renderers (controlled components). */
export interface StepRendererProps {
  step: Step;
  /** Stored answer for `answerKey(step)` (may be undefined or of an unexpected shape). */
  value: unknown;
  /** Revealed validation message, or null. */
  error: string | null;
  /** Increments when the input should shake (failed continue). */
  shakeToken: number;
  onChange: (value: unknown) => void;
}
