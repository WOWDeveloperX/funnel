import { resultTag, type Step } from '@funnel/shared';
import clsx from 'clsx';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { ArrowDown, ArrowRight, Check, ChevronUp, RotateCcw, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pad2 } from '../format';
import { DESKTOP_QUERY, useFocusOnMount, useMediaQuery } from '../hooks';
import { useStrings } from '../i18n';
import { planFor } from '../plan';
import type { ResultView } from '../session/controller';
import { DESK_COLUMNS, DESK_STATUS, DESK_STATUS_ACTION, DESK_STATUS_COPY, DESK_STATUS_VISUAL } from './desk';
import { LanguageCorner } from './LanguageCorner';
import { ActionButton, ErrorMark } from './primitives';

const EXPAND_ACTION = 'expand_recommendation';

interface ResultStepProps {
  step: Step;
  result: ResultView;
  onRetry: () => void;
  /** CTA click; `expanding` = this click opens the plan panel. */
  onCta: (expanding: boolean) => void;
  onStartOver: () => void;
}

/**
 * Result screen: dark "build" loader → staggered reveal, or error + retry. Every state carries the
 * phone language switch in its top-right corner (ink on dark surfaces, paper on light ones).
 * ≥1024px every state is a two-column card: dark summary / loader / error visual on the left, the
 * recommendations, plan or action on the right.
 */
export function ResultStep({ step, result, onRetry, onCta, onStartOver }: ResultStepProps) {
  const phase = result.status === 'idle' ? 'loading' : result.status;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'loading' && <ResultLoading key="loading" title={step.content.loadingTitle} />}

      {result.status === 'error' && (
        <ResultError
          key="error"
          title={step.content.errorTitle}
          retryLabel={step.content.retryLabel}
          onRetry={onRetry}
        />
      )}

      {result.status === 'ready' && (
        <ResultReady key={`ready:${result.resultId}`} result={result} onCta={onCta} onStartOver={onStartOver} />
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const BUILD_BARS = [
  { width: '100%', lime: true },
  { width: '78%', lime: false },
  { width: '90%', lime: false },
  { width: '62%', lime: false },
  { width: '84%', lime: false },
] as const;

/** Checklist advance interval: three steps complete within ~1.2s (the loader's minimum time). */
const CHECK_STEP_MS = 400;

function ResultLoading({ title }: { title?: string }) {
  const t = useStrings();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= t.loadingSteps.length - 1) return;
    const timer = setTimeout(() => setStage((s) => s + 1), CHECK_STEP_MS);
    return () => clearTimeout(timer);
  }, [stage, t.loadingSteps.length]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="relative flex flex-1 flex-col justify-center gap-[34px] bg-ink px-6 pt-[max(env(safe-area-inset-top),24px)] pb-[34px] text-paper md:px-10 md:py-12 lg:px-16 lg:py-14"
    >
      <LanguageCorner tone="ink" />
      {/* The live region wraps only the loader copy, not the language switch. */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col gap-[34px] lg:grid lg:grid-cols-2 lg:items-center lg:gap-x-16"
      >
        <div aria-hidden className="flex flex-col gap-2.5 lg:col-start-2 lg:row-[1/3] lg:gap-3.5">
          {BUILD_BARS.map((bar, i) => (
            <div key={i} className="h-3.5 overflow-hidden rounded-[7px] bg-[#1a2129]" style={{ width: bar.width }}>
              <motion.div
                className={clsx('h-full origin-left rounded-[7px]', bar.lime ? 'bg-signal' : 'bg-paper')}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: [0, 1, 1] }}
                transition={{
                  duration: 1.4,
                  times: [0, 0.6, 1],
                  ease: [0.6, 0, 0.2, 1],
                  repeat: Infinity,
                  delay: i * 0.15,
                }}
              />
            </div>
          ))}
        </div>

        <p className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.03em] text-pretty lg:col-start-1 lg:row-start-1 lg:self-end lg:text-[clamp(34px,3.4vw,44px)] hyphens-auto lg:wrap-break-word">
          {title ?? t.loadingTitle}
        </p>

        <ol className="flex flex-col gap-3.5 lg:col-start-1 lg:row-start-2 lg:self-start">
          {t.loadingSteps.map((label, i) => {
            const state = i < stage ? 'done' : i === stage ? 'current' : 'pending';
            return (
              <li
                key={label}
                className={clsx(
                  'flex items-center gap-3 text-[15px] transition-colors duration-200',
                  state === 'pending' ? 'text-ad-faint' : 'text-paper',
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    'grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-ink transition-colors duration-200',
                    state === 'done' && 'border-signal bg-signal',
                    state === 'current' && 'animate-glow border-signal',
                    state === 'pending' && 'border-[#2a333f]',
                  )}
                >
                  {state === 'done' && <Check className="size-3" strokeWidth={3.5} />}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

function ResultError({ title, retryLabel, onRetry }: { title?: string; retryLabel?: string; onRetry: () => void }) {
  const t = useStrings();
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={clsx(
        'relative flex flex-1 flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),26px)] md:px-[30px] md:pt-10 md:pb-7',
        DESK_STATUS,
        DESK_COLUMNS,
      )}
    >
      <LanguageCorner tone="paper" />
      <div className="flex flex-1 flex-col justify-center gap-[22px] py-10 lg:contents">
        <div className={clsx('max-lg:contents lg:items-center', DESK_STATUS_VISUAL)}>
          <ErrorMark />
        </div>
        <div role="alert" className={clsx('flex flex-col gap-[22px]', DESK_STATUS_COPY)}>
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.03em] text-pretty outline-none lg:text-[40px]"
          >
            {title ?? t.resultErrorTitle}
          </h1>
          <p className="text-base leading-normal text-ink-2">{t.resultErrorText}</p>
        </div>
      </div>
      <ActionButton
        className={clsx('w-full', DESK_STATUS_ACTION)}
        onClick={onRetry}
        icon={<RotateCw className="size-5" strokeWidth={2.25} />}
      >
        {retryLabel ?? t.retry}
      </ActionButton>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
};

function ResultReady({
  result,
  onCta,
  onStartOver,
}: {
  result: Extract<ResultView, { status: 'ready' }>;
  onCta: (expanding: boolean) => void;
  onStartOver: () => void;
}) {
  const t = useStrings();
  const { title, summary, recommendations, cta, badge } = result.result;
  const expands = cta.action === EXPAND_ACTION;
  const [expanded, setExpanded] = useState(false);
  // The full view only staggers in the first time; coming back from the plan it just fades in.
  const [revealed, setRevealed] = useState(false);
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  const toggled = useRef(false);
  // Desktop keeps the dark summary on the left while the right column swaps between the
  // recommendations and the plan; phones swap the whole screen (summary included).
  const wide = useMediaQuery(DESKTOP_QUERY);

  // Expanded = the plan takes over the screen (the right column on desktop). Focus follows the
  // toggle to the incoming view's anchor as soon as it mounts (plan title / the CTA again).
  const focusIfToggled = useCallback((el: HTMLElement | null) => {
    if (!el || !toggled.current) return;
    toggled.current = false;
    el.focus({ preventScroll: true });
  }, []);

  const handleCta = () => {
    const opening = expands && !expanded;
    onCta(opening);
    if (expands) {
      toggled.current = true;
      setRevealed(true);
      setExpanded(!expanded);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };
  const collapse = () => {
    toggled.current = true;
    setExpanded(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const startOver = (
    <button
      type="button"
      onClick={onStartOver}
      className="inline-flex items-center gap-2 self-center rounded-lg px-2 py-1 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      <RotateCcw className="size-3.5" aria-hidden />
      <span className="underline underline-offset-[3px]">{t.startOver}</span>
    </button>
  );

  const summaryPanel = (
    <div className="relative isolate flex flex-col gap-[18px] overflow-hidden rounded-b-[32px] bg-ink px-[22px] pt-[max(calc(env(safe-area-inset-top)+16px),40px)] pb-[26px] text-paper md:px-[30px] md:pt-10 md:pb-[30px] lg:flex-1 lg:justify-end lg:rounded-bl-none lg:rounded-tr-[32px] lg:px-10 lg:pt-10 lg:pb-11">
      <span
        aria-hidden
        className="absolute -top-10 -right-[60px] -z-10 size-[220px] rounded-full bg-[radial-gradient(circle,rgb(200_245_74/0.33),transparent_65%)] lg:-top-16 lg:-right-20 lg:size-[340px]"
      />
      <LanguageCorner tone="ink" />
      <motion.span
        variants={item}
        className="inline-flex items-center gap-2 self-start rounded-full bg-signal px-3 py-[7px] font-mono text-xs font-semibold tracking-[0.06em] text-ink"
      >
        <span aria-hidden>●</span>
        {resultTag(result.resultId, { badge })}
      </motion.span>
      <motion.h1
        ref={titleRef}
        tabIndex={-1}
        variants={item}
        className="font-display text-[34px] leading-[1.02] font-bold tracking-[-0.035em] text-pretty outline-none md:text-[38px] lg:text-[clamp(34px,3vw,46px)] lg:leading-none hyphens-auto lg:wrap-break-word"
      >
        {title}
      </motion.h1>
      <motion.p variants={item} className="text-[15px] leading-normal text-paper/65 text-pretty lg:text-base">
        {summary}
      </motion.p>
    </div>
  );

  return (
    <div className={clsx('flex flex-1 flex-col lg:grid', DESK_COLUMNS)}>
      {wide && (
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col">
          {summaryPanel}
        </motion.div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {expands && expanded ? (
          <motion.div
            key="plan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative flex flex-1 flex-col"
          >
            <LanguageCorner tone="paper" />
            {!wide && (
              <p className="pt-[max(calc(env(safe-area-inset-top)+16px),28px)] pr-[96px] pb-3.5 pl-[22px] font-display text-2xl leading-[1.1] font-bold tracking-[-0.03em] text-pretty text-faint md:px-[30px] md:pt-9">
                {title}
              </p>
            )}
            <section
              id="result-plan"
              aria-labelledby="result-plan-title"
              className="mx-3 flex flex-1 flex-col md:mx-[26px] lg:mx-10 lg:mt-9"
            >
              <PlanPanel plan={planFor(result.result, t.genericPlan)} titleRef={focusIfToggled} onCollapse={collapse} />
            </section>
            <div className="flex flex-col px-[18px] pt-3.5 pb-[max(env(safe-area-inset-bottom),24px)] md:px-[26px] md:pb-7 lg:px-10 lg:pt-3 lg:pb-6">
              {startOver}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="full"
            variants={container}
            initial={revealed ? { opacity: 0 } : 'hidden'}
            animate={revealed ? { opacity: 1, transition: { duration: 0.2 } } : 'show'}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="flex flex-1 flex-col"
          >
            {!wide && summaryPanel}

            {recommendations.length > 0 && (
              <motion.section
                variants={container}
                className="flex flex-col px-[18px] pt-5 md:px-[26px] lg:px-10 lg:pt-11"
                aria-labelledby="result-recs"
              >
                <motion.h2
                  id="result-recs"
                  variants={item}
                  className="px-1 pb-2 font-mono text-[11px] font-medium tracking-[0.14em] text-muted uppercase lg:pb-3"
                >
                  {t.recommendations}
                </motion.h2>
                <ol className="flex flex-col gap-1.5 lg:gap-2">
                  {recommendations.map((rec, i) => (
                    <motion.li
                      key={i}
                      variants={item}
                      className="flex items-center gap-3.5 rounded-2xl bg-card px-3 py-3.5 lg:gap-5 lg:px-5 lg:py-4"
                    >
                      <span
                        aria-hidden
                        className="w-[34px] shrink-0 font-display text-[26px] leading-none font-bold tracking-[-0.03em] text-ink lg:w-11 lg:text-[34px]"
                      >
                        {pad2(i + 1)}
                      </span>
                      <span className="text-[15px] leading-[1.35] text-ink lg:text-base">{rec}</span>
                    </motion.li>
                  ))}
                </ol>
              </motion.section>
            )}

            <motion.div
              variants={item}
              className="mt-auto flex flex-col gap-3.5 px-[18px] pt-5 pb-[max(env(safe-area-inset-bottom),24px)] md:px-[26px] md:pb-7 lg:px-10 lg:pt-8 lg:pb-8"
            >
              <ActionButton
                ref={focusIfToggled}
                onClick={handleCta}
                className="w-full"
                aria-expanded={expands ? false : undefined}
                icon={
                  expands ? (
                    <ArrowDown className="size-5" strokeWidth={2.25} />
                  ) : (
                    <ArrowRight className="size-5" strokeWidth={2.25} />
                  )
                }
              >
                {cta.label}
              </ActionButton>
              {startOver}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Dark "30 days" panel: a vertical timeline, one line per week (week 1 highlighted in lime). */
function PlanPanel({
  plan,
  titleRef,
  onCollapse,
}: {
  plan: readonly string[];
  titleRef: (el: HTMLHeadingElement | null) => void;
  onCollapse: () => void;
}) {
  const t = useStrings();
  return (
    // ≥1024px the plan sits next to the dark summary panel, so it takes the light card surface.
    <div className="flex flex-1 flex-col rounded-[28px] bg-ink text-paper lg:bg-card lg:text-ink">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2.5">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] font-medium tracking-[0.14em] text-signal uppercase lg:text-muted">
            {t.planEyebrow}
          </span>
          <h2
            ref={titleRef}
            id="result-plan-title"
            tabIndex={-1}
            className="font-display text-2xl font-bold tracking-[-0.02em] outline-none"
          >
            {t.planTitle}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t.collapsePlan}
          aria-controls="result-plan"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#1a2129] text-paper transition-colors hover:bg-[#232c36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:bg-paper lg:text-ink lg:hover:bg-ink/[0.06] lg:focus-visible:outline-ink"
        >
          <ChevronUp className="size-4" aria-hidden />
        </button>
      </div>
      <ol className="relative flex flex-col px-5 pt-1.5 pb-5">
        <span
          aria-hidden
          className="absolute top-5 bottom-10 left-[33px] w-0.5 bg-linear-to-b from-signal via-[#2a333f] via-40% to-[#2a333f] lg:from-ink lg:via-ink/15 lg:to-ink/15"
        />
        {plan.map((line, i) => {
          const first = i === 0;
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: 0.08 + i * 0.06 }}
              className="relative flex gap-4 py-3 lg:py-2.5"
            >
              <span
                aria-hidden
                className={clsx(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2 font-mono text-[11px] font-bold',
                  first
                    ? 'border-signal bg-signal text-ink lg:border-ink lg:bg-ink lg:text-signal'
                    : 'border-[#3a444f] bg-ink text-paper lg:border-ink/20 lg:bg-card lg:text-ink',
                )}
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <span
                  className={clsx(
                    'font-mono text-[11px] font-medium tracking-[0.12em] uppercase',
                    first ? 'text-signal lg:text-ink' : 'text-[#7a848f] lg:text-muted',
                  )}
                >
                  {t.week(i + 1)}
                </span>
                <span className="text-[15px] leading-snug text-[#e6e9ed] lg:text-ink-2">{line}</span>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
