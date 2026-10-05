import type { Step } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useFocusOnMount } from '../hooks';
import { DESK_BODY, DESK_HERO } from './desk';
import { LanguageCorner } from './LanguageCorner';

/**
 * Info / intro screen: dark ink hero (~60% of the phone screen, rounded bottom) with decorative
 * lime rings, a lime eyebrow pill and a large white title; the body sits below. The action and the
 * question count live in the footer. Phones get the language switch in the hero's top-right corner.
 * ≥1024px: a split card — the hero fills the left ~55% top to bottom (title at its foot), the body
 * and the footer's CTA sit vertically centred in the right column.
 */
export function InfoStep({ step }: { step: Step }) {
  const { eyebrow, title, body, helperText } = step.content;
  const titleRef = useFocusOnMount<HTMLHeadingElement>();

  return (
    <div className="flex flex-1 flex-col lg:contents">
      <div
        className={clsx(
          'relative isolate flex min-h-[60dvh] flex-col justify-end overflow-hidden rounded-b-[36px] bg-ink px-6 pt-[calc(env(safe-area-inset-top)+56px)] pb-[30px] text-paper md:min-h-[380px] md:px-[30px] md:pb-[34px]',
          'lg:min-h-[min(560px,calc(100dvh-152px))] 2xl:min-h-[min(640px,calc(100dvh-152px))] lg:rounded-bl-none lg:rounded-tr-[36px] lg:px-12 lg:pt-12 lg:pb-12',
          DESK_HERO,
        )}
      >
        <Decor />
        <LanguageCorner tone="ink" />
        <div className="relative flex flex-col items-start gap-[18px]">
          {eyebrow && (
            <span className="rounded-full bg-signal px-3 py-[7px] font-mono text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              {eyebrow}
            </span>
          )}
          {title && (
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="font-display text-[40px] leading-none font-bold tracking-[-0.035em] text-pretty outline-none md:text-[44px] lg:text-[clamp(48px,4.2vw,60px)] lg:leading-[0.98] lg:wrap-break-word"
            >
              {title}
            </h1>
          )}
        </div>
      </div>

      {(body || helperText) && (
        <div
          className={clsx(
            'mt-auto flex flex-col gap-2 px-6 pt-7 md:px-[30px] lg:mt-0 lg:gap-3 lg:px-10 lg:pt-0 xl:px-12',
            DESK_BODY,
          )}
        >
          {body && <p className="text-base leading-normal text-ink-2 text-pretty lg:text-lg">{body}</p>}
          {helperText && <p className="text-[15px] leading-normal text-muted text-pretty lg:text-base">{helperText}</p>}
        </div>
      )}
    </div>
  );
}

/** Concentric lime outline rings with a glowing dot (purely decorative). */
function Decor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <motion.span
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="absolute top-[60px] -right-[90px] size-[300px] rounded-full border border-signal/20 lg:top-[40px] lg:-right-[120px] lg:size-[440px]"
      />
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
        className="absolute top-[120px] -right-[30px] size-[180px] rounded-full border border-signal/35 lg:top-[130px] lg:-right-[30px] lg:size-[260px]"
      />
      <span className="absolute top-[200px] right-[50px] size-5 animate-glow rounded-full bg-signal shadow-[0_0_40px_var(--color-signal)] lg:top-[250px] lg:right-[88px] lg:size-6" />
    </div>
  );
}
