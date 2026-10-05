/**
 * Full-screen states outside the step flow: booting, expired session, boot error.
 * Copy here is runtime chrome (localized), not funnel content.
 * ≥1024px they use the same two-column card as the steps: the skeleton mirrors a question step,
 * the expired / error screens put their visual on a dark panel left and copy + action right.
 */
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { RotateCw } from 'lucide-react';
import { useFocusOnMount } from '../hooks';
import { useStrings } from '../i18n';
import type { BootErrorKind } from '../session/errors';
import { DESK_COLUMNS, DESK_STATUS, DESK_STATUS_ACTION, DESK_STATUS_COPY, DESK_STATUS_VISUAL } from './desk';
import { LanguageCorner } from './LanguageCorner';
import { ActionButton, ErrorMark } from './primitives';
import { Frame } from './StepShell';

export function LoadingScreen() {
  const t = useStrings();
  return (
    <Frame
      role="status"
      aria-live="polite"
      className={clsx('lg:grid lg:max-w-[1080px] lg:grid-rows-[auto_minmax(0,1fr)] 2xl:max-w-[1200px]', DESK_COLUMNS)}
    >
      <span className="sr-only">{t.loading}</span>
      <div
        aria-hidden
        className="flex items-center gap-3.5 px-[18px] pt-[max(env(safe-area-inset-top),14px)] md:px-[30px] md:pt-[26px] lg:col-start-1 lg:row-start-1 lg:px-10 lg:pt-9"
      >
        <span className="size-[42px] animate-pulse rounded-[14px] bg-card" />
        <span className="flex flex-1 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-1.5 flex-1 animate-pulse rounded-[3px] bg-ink/10" />
          ))}
        </span>
        <span className="h-3.5 w-10 animate-pulse rounded bg-ink/10" />
      </div>
      <div
        aria-hidden
        className="flex flex-col gap-3 px-[22px] pt-[34px] md:px-[30px] lg:col-start-1 lg:row-start-2 lg:px-10 lg:pt-8"
      >
        <span className="h-8 w-4/5 animate-pulse rounded-xl bg-ink/[0.08]" />
        <span className="h-8 w-3/5 animate-pulse rounded-xl bg-ink/[0.08]" />
        <span className="mt-1 h-4 w-2/3 animate-pulse rounded-lg bg-ink/[0.06]" />
      </div>
      <div
        aria-hidden
        className="flex flex-col gap-2 px-[18px] pt-[22px] md:px-[26px] lg:col-start-2 lg:row-[1/3] lg:grid lg:grid-cols-2 lg:content-start lg:px-10 lg:pt-9 lg:pb-9"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="h-[62px] animate-pulse rounded-[18px] bg-card" />
        ))}
      </div>
    </Frame>
  );
}

/** Expired / boot error card: a little narrower than a step card. */
const STATUS_FRAME = 'lg:max-w-[1000px]';

const ttlLabel = (hours: number): string => `${String(Math.max(0, Math.round(hours))).padStart(2, '0')}:00`;

export function ExpiredScreen({
  reason,
  ttlHours,
  onRestart,
}: {
  reason: 'expired' | 'not_found' | null;
  /** The pinned config's session TTL, when known (from the session or its cached snapshot). */
  ttlHours: number | null;
  onRestart: () => void;
}) {
  const t = useStrings();
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  const notFound = reason === 'not_found';
  return (
    <Frame className={STATUS_FRAME}>
      <LanguageCorner tone="paper" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={clsx(
          'flex flex-1 flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),26px)] md:px-[30px] md:pt-10 md:pb-7',
          DESK_STATUS,
          DESK_COLUMNS,
        )}
      >
        <div className={clsx('flex flex-1 flex-col justify-center gap-1.5 py-10 lg:items-start', DESK_STATUS_VISUAL)}>
          {!notFound && ttlHours !== null && (
            <span
              aria-hidden
              className="font-display text-[92px] leading-[0.9] font-bold tracking-[-0.05em] text-ink/10 md:text-[112px] lg:text-[120px] lg:text-paper/15"
            >
              {ttlLabel(ttlHours)}
            </span>
          )}
          <span
            className={
              !notFound && ttlHours !== null
                ? '-mt-[34px] ml-2 self-start rounded-full bg-signal px-3 py-1.5 font-mono text-xs font-semibold text-ink'
                : 'self-start rounded-full bg-signal px-3 py-1.5 font-mono text-xs font-semibold text-ink'
            }
          >
            {notFound ? t.notFoundBadge : t.expiredBadge}
          </span>
        </div>
        <div className={clsx('flex flex-col gap-3.5 pb-[22px]', DESK_STATUS_COPY)}>
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-[34px] leading-[1.02] font-bold tracking-[-0.035em] text-pretty outline-none lg:text-[40px]"
          >
            {notFound ? t.notFoundTitle : t.expiredTitle}
          </h1>
          <p className="text-base leading-normal text-ink-2">{notFound ? t.notFoundText : t.expiredText}</p>
        </div>
        <ActionButton className={clsx('w-full', DESK_STATUS_ACTION)} onClick={onRestart}>
          {t.startAgain}
        </ActionButton>
      </motion.div>
    </Frame>
  );
}

export function BootErrorScreen({ kind, onRetry }: { kind: BootErrorKind | null; onRetry: () => void }) {
  const t = useStrings();
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <Frame className={STATUS_FRAME}>
      <LanguageCorner tone="paper" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={clsx(
          'flex flex-1 flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),26px)] md:px-[30px] md:pt-10 md:pb-7',
          DESK_STATUS,
          DESK_COLUMNS,
        )}
      >
        <div className="flex flex-1 flex-col justify-center gap-[22px] py-10 lg:contents">
          <div className={clsx('max-lg:contents lg:items-center', DESK_STATUS_VISUAL)}>
            <ErrorMark />
          </div>
          <div className={clsx('flex flex-col gap-[22px]', DESK_STATUS_COPY)}>
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.03em] text-pretty outline-none lg:text-[40px]"
            >
              {t.bootErrorTitle}
            </h1>
            <p className="text-base leading-normal text-ink-2" role="alert">
              {t.errors[kind ?? 'unknown']}
            </p>
          </div>
        </div>
        <ActionButton
          className={clsx('w-full', DESK_STATUS_ACTION)}
          onClick={onRetry}
          icon={<RotateCw className="size-5" strokeWidth={2.25} />}
        >
          {t.retry}
        </ActionButton>
      </motion.div>
    </Frame>
  );
}
