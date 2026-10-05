/**
 * Simulated funnel client: walks a server-resolved funnel with the shared engine and records the
 * exact events the real web client would emit.
 * Nothing here knows step ids — everything comes from `session.funnel`.
 */
import { randomUUID } from 'node:crypto';
import {
  type Answers,
  type EventInput,
  type ResolvedFunnel,
  type ResolvedResult,
  type SessionState,
  type Step,
  type UpdateSessionStateRequest,
  RECOMMENDATION_EXPANDED,
  answerKey,
  computeVisibility,
  isEventAllowed,
  isInteractive,
  nextStepId,
  prevStepId,
  validateAnswer,
} from '@funnel/shared';
import type { Rng } from './prng';

// ---------------------------------------------------------------------------
// Answer generation (config-driven, mildly weighted)
// ---------------------------------------------------------------------------

/** Mildly decreasing weights by option position, so every option still occurs. */
const optionWeights = (n: number): number[] => Array.from({ length: n }, (_, i) => 1 / (1 + 0.15 * i));

/** Weights for choosing how many options a multi-select answer has (1, 2, 3, ...). */
const MULTI_COUNT_WEIGHTS = [0.45, 0.35, 0.2];

function isRequired(step: Step): boolean {
  return step.validation?.required !== false;
}

/** A plausible valid answer for an interactive step (undefined for info/result/unknown types). */
export function randomAnswer(step: Step, rng: Rng): unknown {
  const input = step.input;
  switch (step.type) {
    case 'single-select': {
      const options = input?.options ?? [];
      if (options.length === 0) return undefined;
      return rng.weighted(options, optionWeights(options.length)).value;
    }
    case 'multi-select': {
      const options = input?.options ?? [];
      if (options.length === 0) return [];
      const lo = Math.min(options.length, Math.max(step.validation?.minSelections ?? 0, isRequired(step) ? 1 : 0));
      const hi = Math.max(lo, Math.min(step.validation?.maxSelections ?? options.length, options.length));
      const counts: number[] = [];
      const weights: number[] = [];
      for (let k = lo; k <= hi; k++) {
        counts.push(k);
        weights.push(MULTI_COUNT_WEIGHTS[k - 1] ?? 0.1);
      }
      const k = counts.length > 0 ? rng.weighted(counts, weights) : lo;
      return rng.weightedSample(options, optionWeights(options.length), k).map((o) => o.value);
    }
    case 'number': {
      const min = input?.min ?? 0;
      const max = input?.max ?? Math.max(min + 100, 100);
      const inc = input?.step && input.step > 0 ? input.step : 1;
      const range = max - min;
      // Small ranges (e.g. office days 0..5) are uniform; large ones are skewed towards small values
      // (team sizes, tool counts and meeting hours cluster low with a long tail).
      const raw = range <= 10 ? rng.float(min, max + inc) : min + range * Math.pow(rng.next(), 2.2);
      const snapped = min + Math.floor((raw - min) / inc) * inc;
      return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/** Typical dwell time (seconds) on a step before the next interaction, by step type. */
const DWELL_SECONDS: Record<string, [number, number]> = {
  info: [2, 9],
  'single-select': [3, 12],
  'multi-select': [6, 22],
  number: [4, 16],
  result: [4, 25],
};

export class FunnelWalker {
  /** Events in emission order (client timestamps strictly increase). */
  readonly events: EventInput[] = [];
  answers: Answers;
  current: string | null;
  clockMs: number;
  backs = 0;

  constructor(
    readonly session: SessionState,
    private readonly rng: Rng,
    startMs: number,
  ) {
    this.answers = { ...session.answers };
    this.current = session.currentStepId ?? nextStepId(session.funnel, this.answers, null);
    this.clockMs = startMs;
  }

  get funnel(): ResolvedFunnel {
    return this.session.funnel;
  }

  get step(): Step | null {
    return this.current ? (this.funnel.steps[this.current] ?? null) : null;
  }

  /** Moves the simulated client clock forward by a dwell typical for `type`. */
  dwell(type: string | undefined, scale = 1): void {
    const [lo, hi] = DWELL_SECONDS[type ?? ''] ?? [2, 10];
    this.clockMs += Math.round(this.rng.float(lo, hi) * 1000 * scale) + this.rng.int(50, 900);
  }

  /** Builds an event for this session (the caller checks `events.allowed`). */
  private makeEvent(name: string, stepId: string | null, properties: Record<string, unknown> = {}): EventInput {
    this.clockMs += this.rng.int(15, 400); // events of one interaction are a few ms apart
    const s = this.session;
    return {
      event_id: randomUUID(),
      session_id: s.sessionId,
      name,
      client_timestamp: new Date(this.clockMs).toISOString(),
      step_id: stepId,
      properties,
      funnel_id: s.funnelId,
      funnel_version: s.funnelVersion,
      experiment_id: s.experimentId,
      variant: s.variant,
      utm_source: s.utm.source,
      utm_medium: s.utm.medium,
      utm_campaign: s.utm.campaign,
    };
  }

  /** Records an event iff the pinned config allows it (like the real client). */
  track(name: string, stepId: string | null, properties: Record<string, unknown> = {}): EventInput | null {
    if (!isEventAllowed(this.funnel, name)) return null;
    const event = this.makeEvent(name, stepId, properties);
    this.events.push(event);
    return event;
  }

  /** step_viewed for the current step. */
  view(): void {
    const id = this.current;
    const step = this.step;
    if (!id || !step) throw new Error('view() without a current step');
    const { visible } = computeVisibility(this.funnel, this.answers);
    this.track('step_viewed', id, {
      step_type: step.type,
      visible_step_index: visible.indexOf(id) + 1,
      visible_step_count: visible.length,
    });
  }

  /** Validates and stores an answer for the current step + answer_submitted. Returns the error, if any. */
  submit(value: unknown): string | null {
    const step = this.step;
    if (!step || !isInteractive(step)) return null;
    const err = validateAnswer(step, value);
    if (err) return err;
    this.dwell(step.type);
    this.answers[answerKey(step)!] = value;
    this.track('answer_submitted', step.id, { answer_kind: step.type });
    return null;
  }

  /** step_completed for the current step and move to the next visible step. */
  advance(): string | null {
    const from = this.current;
    if (!from) return null;
    const step = this.step;
    if (step && !isInteractive(step)) this.dwell(step.type); // info: reading time before "Start"
    const next = nextStepId(this.funnel, this.answers, from);
    this.track('step_completed', from, { next_step_id: next });
    this.current = next;
    this.clockMs += this.rng.int(250, 900); // transition animation
    return next;
  }

  /** back_clicked from the current step to the previous visible one. Null if there is none. */
  back(): string | null {
    const from = this.current;
    if (!from) return null;
    const prev = prevStepId(this.funnel, this.answers, from);
    if (!prev) return null;
    this.dwell(this.step?.type, 0.4);
    this.track('back_clicked', from, { destination_step_id: prev });
    this.current = prev;
    this.backs++;
    return prev;
  }

  resultViewed(resultId: string): void {
    this.clockMs += this.rng.int(900, 2500); // loader (min ~900ms) + request
    this.track('result_viewed', this.current, { result_id: resultId });
  }

  /** cta_clicked, then recommendation_expanded only if the pinned config allows it. */
  ctaClicked(resultId: string, result: Pick<ResolvedResult, 'cta'>): { expanded: boolean } {
    this.dwell('result');
    this.track('cta_clicked', this.current, { result_id: resultId, action: result.cta.action });
    const expanded =
      isEventAllowed(this.funnel, RECOMMENDATION_EXPANDED) &&
      this.track(RECOMMENDATION_EXPANDED, this.current, {
        result_id: resultId,
        action: result.cta.action,
        source: 'result_cta',
      }) !== null;
    return { expanded };
  }

  statePayload(): UpdateSessionStateRequest {
    return { answers: { ...this.answers }, currentStepId: this.current };
  }
}
