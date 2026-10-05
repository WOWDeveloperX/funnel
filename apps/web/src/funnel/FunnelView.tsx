/**
 * Renders the current step of a ready session. All funnel logic (visibility, navigation,
 * validation, progress) comes from @funnel/shared via the controller; this file only wires UI.
 * It renders the funnel already translated into the UI language (FunnelApp → ./localize): the
 * structure is identical to the controller's funnel, only the copy differs.
 */
import {
  answerKey,
  isInteractive,
  progressFor,
  prevStepId,
  type ResolvedFunnel,
  type Step,
  translate,
  type TranslationCatalog,
  validateAnswer,
} from '@funnel/shared';
import clsx from 'clsx';
import { CloudOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { InfoStep } from './components/InfoStep';
import { MultiSelectStep } from './components/MultiSelectStep';
import { NumberStep } from './components/NumberStep';
import { ActionButton } from './components/primitives';
import { ProgressHeader } from './components/ProgressHeader';
import { ResultStep } from './components/ResultStep';
import { optionKey } from './components/options';
import { SingleSelectStep } from './components/SingleSelectStep';
import { StepShell } from './components/StepShell';
import { UnknownStep } from './components/UnknownStep';
import { useStrings } from './i18n';
import { localizeResultView } from './localize';
import { progressSegments } from './progress';
import type { FunnelController, FunnelState } from './session/controller';
import { NavigationSettle } from './session/navigationSettle';

/** Delay between picking a single-select option and moving on (lets the selection animation land). */
const AUTO_ADVANCE_MS = 300;

/** Types that hide the header (back button + progress). */
const HEADERLESS_TYPES = new Set(['info', 'result']);

interface FunnelViewProps {
  state: FunnelState;
  /** The session's pinned funnel, translated into the UI language. */
  funnel: ResolvedFunnel;
  /** Catalog `funnel` was translated with (null = source language); also used for result copy. */
  catalog: TranslationCatalog | null;
  /** The step on screen (`state.currentStepId`, narrowed by the caller). */
  stepId: string;
  controller: FunnelController;
}

export function FunnelView({ state, funnel, catalog, stepId, controller }: FunnelViewProps) {
  const t = useStrings();
  const step: Step = funnel.steps[stepId] ?? { id: stepId, type: 'unknown', content: {} };
  const key = answerKey(step);
  const value = key ? state.answers[key] : undefined;

  // Live validation; the message is only *shown* once revealed (failed continue, blur, server 400).
  // Config messages are already translated with the step; the engine's built-in English defaults
  // are looked up in the catalog too (untranslated text falls back to itself).
  const liveError = isInteractive(step) ? validateAnswer(step, value) : null;
  const shownError = state.errorStepId === stepId && liveError !== null ? translate(liveError, catalog) : null;
  const result = useMemo(() => localizeResultView(state.result, catalog), [state.result, catalog]);

  const progress = progressFor(funnel, state.answers, stepId);
  // The first question hides Back: the only way back is the intro, and the browser's own
  // Back button still returns there.
  const prevId = prevStepId(funnel, state.answers, stepId);
  const canGoBack = prevId !== null && !(progress.index <= 1 && funnel.steps[prevId]?.type === 'info');

  // -- auto-advance for single-select ---------------------------------------------------------
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAutoAdvance = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
  }, []);
  useEffect(() => cancelAutoAdvance, [state.viewToken, cancelAutoAdvance]);

  // A double click on Continue must not also "continue" the step it just navigated to (the footer
  // button outlives the step transition, and an already-answered next step is valid at once).
  const settle = useRef(new NavigationSettle());
  useEffect(() => settle.current.mark(), [state.viewToken]);

  const handleContinue = useCallback(() => {
    if (!settle.current.settled()) return;
    cancelAutoAdvance();
    controller.next();
  }, [controller, cancelAutoAdvance]);

  const handleChange = (next: unknown) => {
    if (!key) return;
    controller.setAnswer(key, next);
    if (step.type === 'single-select') {
      cancelAutoAdvance();
      autoTimer.current = setTimeout(() => {
        autoTimer.current = null;
        controller.next();
      }, AUTO_ADVANCE_MS);
    }
  };

  // -- page-level effects ----------------------------------------------------------------------
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [state.viewToken]);

  // Enter continues (buttons, links and option cards handle Enter themselves).
  useEffect(() => {
    if (step.type === 'result') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('button, a, textarea, select, [role="radio"], [role="checkbox"]')) return;
      e.preventDefault();
      handleContinue();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [step.type, handleContinue]);

  // -- step body --------------------------------------------------------------------------------
  const common = { step, value, error: shownError, shakeToken: state.shakeToken, onChange: handleChange };
  let body: ReactNode;
  switch (step.type) {
    case 'info':
      body = <InfoStep step={step} />;
      break;
    case 'single-select':
      body = <SingleSelectStep {...common} />;
      break;
    case 'multi-select':
      body = <MultiSelectStep {...common} />;
      break;
    case 'number':
      body = <NumberStep {...common} onBlur={() => controller.revealErrors(stepId)} />;
      break;
    case 'result':
      body = (
        <ResultStep
          step={step}
          result={result}
          onRetry={controller.retryResult}
          onCta={controller.ctaClicked}
          onStartOver={controller.startOver}
        />
      );
      break;
    default:
      body = <UnknownStep />;
  }

  // -- footer -------------------------------------------------------------------------------------
  let footer: ReactNode = null;
  if (step.type !== 'result') {
    const isInfo = step.type === 'info';
    const isIntro = isInfo && progress.index === 0 && progress.total > 0;
    // Only the question count is computed; a time estimate comes from the config (content.durationHint)
    // so runtime copy can never contradict the variant's own copy (v3 B: "90-second operating check").
    const durationHint = isInfo ? step.content.durationHint : undefined;
    const options = step.type === 'single-select' ? (step.input?.options ?? []) : [];
    const lastKey = options.length > 0 ? optionKey(Math.min(options.length, 26) - 1) : undefined;
    footer = (
      <div
        className={clsx('flex flex-col gap-3', !isInfo && 'md:flex-row md:items-center md:justify-between md:gap-6')}
      >
        {lastKey && (
          <span aria-hidden className="hidden font-mono text-xs font-medium text-faint md:inline">
            {t.keysHint(lastKey)}
          </span>
        )}
        <ActionButton
          size={isInfo ? 'lg' : 'adaptive'}
          className={clsx('w-full', !isInfo && 'md:ml-auto md:w-auto md:min-w-[220px]')}
          softDisabled={liveError !== null && shownError === null}
          onClick={handleContinue}
        >
          {(isInfo && step.content.primaryActionLabel) || t.continue}
        </ActionButton>
        {isIntro && (
          <p className="flex justify-center gap-2.5 font-mono text-xs font-medium text-muted">
            {durationHint && (
              <>
                <span>{durationHint}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{t.questions(progress.total)}</span>
          </p>
        )}
      </div>
    );
  }

  const banner =
    state.sync === 'offline' ? (
      <div
        role="status"
        className="mx-[18px] mt-3 flex items-start gap-2.5 rounded-[14px] bg-ink px-3.5 py-3 text-sm font-medium text-paper md:mx-[26px] md:mt-5"
      >
        <CloudOff className="mt-px size-4 shrink-0 text-signal" aria-hidden />
        {t.offline}
      </div>
    ) : null;

  return (
    <StepShell
      stepKey={stepId}
      direction={state.direction}
      banner={banner}
      header={
        HEADERLESS_TYPES.has(step.type) ? null : (
          <ProgressHeader
            stepId={stepId}
            index={progress.index}
            total={progress.total}
            segments={progressSegments(funnel, state.answers, stepId)}
            canGoBack={canGoBack}
            onBack={controller.back}
          />
        )
      }
      footer={footer}
    >
      {body}
    </StepShell>
  );
}
