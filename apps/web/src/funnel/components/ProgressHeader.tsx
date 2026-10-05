import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, GitFork } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { pad2 } from '../format';
import { useStrings } from '../i18n';
import type { ProgressSegment } from '../progress';
import { RollingNumber } from './primitives';

interface ProgressHeaderProps {
  stepId: string;
  index: number;
  total: number;
  segments: ProgressSegment[];
  canGoBack: boolean;
  onBack: () => void;
}

/**
 * 42px back button (kept in layout but hidden on the first visible step), a segmented progress
 * bar (done = ink, current = lime with ink border, future = ink/10, undecided branch = dashed) and
 * a mono "03/06" counter. When N changes on the same step (a branch opened or closed) the total
 * rolls and a lime "⑂ +1 / ⑂ −1" badge flashes. Phones end the row with a compact language
 * switch (≥768px it sits on the desk instead).
 */
export function ProgressHeader({ stepId, index, total, segments, canGoBack, onBack }: ProgressHeaderProps) {
  const t = useStrings();
  const delta = useBranchDelta(stepId, total);

  return (
    <div className="flex items-center gap-3.5 px-[18px] pt-[max(env(safe-area-inset-top),14px)] md:px-[30px] md:pt-[26px] lg:px-10 lg:pt-9">
      <button
        type="button"
        onClick={onBack}
        aria-label={t.back}
        disabled={!canGoBack}
        aria-hidden={!canGoBack || undefined}
        tabIndex={canGoBack ? undefined : -1}
        className={clsx(
          'grid size-[42px] shrink-0 place-items-center rounded-[14px] border border-ink/[0.08] bg-card text-ink transition-[background-color,transform] duration-150 hover:bg-white/70 active:scale-95',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          !canGoBack && 'invisible',
        )}
      >
        <ArrowLeft className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </button>

      <div
        className="flex min-w-0 flex-1 gap-1"
        role="progressbar"
        aria-label={t.progress}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-valuetext={t.stepOf(index, total)}
      >
        <AnimatePresence initial={false}>
          {segments.map((s) => (
            <motion.span
              key={s.stepId}
              initial={{ flexGrow: 0, opacity: 0 }}
              animate={{ flexGrow: 1, opacity: 1 }}
              exit={{ flexGrow: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className={clsx(
                'h-1.5 min-w-0 basis-0 rounded-[3px] transition-colors duration-200',
                s.state === 'done' && 'bg-ink',
                s.state === 'current' && 'border-[1.5px] border-ink bg-signal',
                s.state === 'todo' && 'bg-ink/10',
                s.state === 'maybe' && 'border-[1.5px] border-dashed border-ink/35 bg-transparent',
              )}
            />
          ))}
        </AnimatePresence>
      </div>

      <p className="flex shrink-0 items-center gap-2 font-mono text-[13px] font-semibold text-ink">
        <span className="sr-only" aria-live="polite">
          {t.stepOf(index, total)}
        </span>
        <span aria-hidden className="inline-flex items-center">
          <RollingNumber value={pad2(index)} />
          <span className="text-faint">/</span>
          <RollingNumber value={pad2(total)} className={delta === 0 ? 'text-faint' : 'text-ink'} />
        </span>
        <AnimatePresence>
          {delta !== 0 && (
            <motion.span
              key={`${stepId}:${total}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="inline-flex items-center gap-1 rounded-md bg-signal px-[7px] py-[3px] text-[11px] text-ink"
              aria-hidden
            >
              <GitFork className="size-3" strokeWidth={2.5} />
              {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
            </motion.span>
          )}
        </AnimatePresence>
      </p>

      <LanguageSwitcher size="sm" className="md:hidden" />
    </div>
  );
}

/** Change of `total` while staying on the same step; resets after a short moment. */
function useBranchDelta(stepId: string, total: number): number {
  const [seen, setSeen] = useState({ stepId, total });
  const [delta, setDelta] = useState(0);

  if (seen.stepId !== stepId || seen.total !== total) {
    setSeen({ stepId, total });
    setDelta(seen.stepId === stepId ? total - seen.total : 0);
  }

  useEffect(() => {
    if (delta === 0) return;
    const timer = setTimeout(() => setDelta(0), 1600);
    return () => clearTimeout(timer);
  }, [delta, total]);

  return delta;
}
