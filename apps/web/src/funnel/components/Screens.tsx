/**
 * Full-screen states outside the step flow: booting, expired session, boot error.
 * Copy here is runtime chrome (localized), not funnel content.
 */
import { motion } from 'framer-motion';
import { RotateCw } from 'lucide-react';
import { useFocusOnMount } from '../hooks';
import { useStrings } from '../i18n';
import type { BootErrorKind } from '../session/errors';
import { LanguageCorner } from './LanguageCorner';
import { ActionButton } from './primitives';
import { Frame } from './StepShell';

export function LoadingScreen() {
  const t = useStrings();
  return (
    <Frame role="status" aria-live="polite">
      <span className="sr-only">{t.loading}</span>
      <div
        aria-hidden
        className="flex items-center gap-3.5 px-[18px] pt-[max(env(safe-area-inset-top),14px)] md:px-[30px] md:pt-[26px]"
      >
        <span className="size-[42px] animate-pulse rounded-[14px] bg-card" />
        <span className="flex flex-1 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-1.5 flex-1 animate-pulse rounded-[3px] bg-ink/10" />
          ))}
        </span>
        <span className="h-3.5 w-10 animate-pulse rounded bg-ink/10" />
      </div>
      <div aria-hidden className="flex flex-col gap-3 px-[22px] pt-[34px] md:px-[30px]">
        <span className="h-8 w-4/5 animate-pulse rounded-xl bg-ink/[0.08]" />
        <span className="h-8 w-3/5 animate-pulse rounded-xl bg-ink/[0.08]" />
        <span className="mt-1 h-4 w-2/3 animate-pulse rounded-lg bg-ink/[0.06]" />
      </div>
      <div aria-hidden className="flex flex-col gap-2 px-[18px] pt-[22px] md:px-[26px]">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="h-[62px] animate-pulse rounded-[18px] bg-card" />
        ))}
      </div>
    </Frame>
  );
}

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
    <Frame>
      <LanguageCorner tone="paper" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex flex-1 flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),26px)] md:px-[30px] md:pt-10 md:pb-7"
      >
        <div className="flex flex-1 flex-col justify-center gap-1.5 py-10">
          {!notFound && ttlHours !== null && (
            <span
              aria-hidden
              className="font-display text-[92px] leading-[0.9] font-bold tracking-[-0.05em] text-ink/10 md:text-[112px]"
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
        <div className="flex flex-col gap-3.5 pb-[22px]">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-[34px] leading-[1.02] font-bold tracking-[-0.035em] text-pretty outline-none"
          >
            {notFound ? t.notFoundTitle : t.expiredTitle}
          </h1>
          <p className="text-base leading-normal text-ink-2">{notFound ? t.notFoundText : t.expiredText}</p>
        </div>
        <ActionButton className="w-full" onClick={onRestart}>
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
    <Frame>
      <LanguageCorner tone="paper" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex flex-1 flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),26px)] md:px-[30px] md:pt-10 md:pb-7"
      >
        <div className="flex flex-1 flex-col justify-center gap-[22px] py-10">
          <div aria-hidden className="relative size-24">
            <span className="absolute inset-0 rounded-[30px] border-2 border-dashed border-error-ink/40" />
            <span className="absolute inset-3.5 grid place-items-center rounded-[20px] bg-error-ink font-display text-[30px] font-bold text-white">
              !
            </span>
          </div>
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.03em] text-pretty outline-none"
          >
            {t.bootErrorTitle}
          </h1>
          <p className="text-base leading-normal text-ink-2" role="alert">
            {t.errors[kind ?? 'unknown']}
          </p>
        </div>
        <ActionButton className="w-full" onClick={onRetry} icon={<RotateCw className="size-5" strokeWidth={2.25} />}>
          {t.retry}
        </ActionButton>
      </motion.div>
    </Frame>
  );
}
