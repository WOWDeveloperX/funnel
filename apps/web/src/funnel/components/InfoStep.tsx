import type { Step } from '@funnel/shared';
import { motion } from 'framer-motion';
import { useFocusOnMount } from '../hooks';
import { LanguageCorner } from './LanguageCorner';

/**
 * Info / intro screen: dark ink hero (~60% of the phone screen, rounded bottom) with decorative
 * lime rings, a lime eyebrow pill and a large white title; the body sits below. The action and the
 * question count live in the footer. Phones get the language switch in the hero's top-right corner.
 */
export function InfoStep({ step }: { step: Step }) {
  const { eyebrow, title, body, helperText } = step.content;
  const titleRef = useFocusOnMount<HTMLHeadingElement>();

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative isolate flex min-h-[60dvh] flex-col justify-end overflow-hidden rounded-b-[36px] bg-ink px-6 pt-[calc(env(safe-area-inset-top)+56px)] pb-[30px] text-paper md:min-h-[380px] md:px-[30px] md:pb-[34px]">
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
              className="font-display text-[40px] leading-none font-bold tracking-[-0.035em] text-pretty outline-none md:text-[44px]"
            >
              {title}
            </h1>
          )}
        </div>
      </div>

      {(body || helperText) && (
        <div className="mt-auto flex flex-col gap-2 px-6 pt-7 md:px-[30px]">
          {body && <p className="text-base leading-normal text-ink-2 text-pretty">{body}</p>}
          {helperText && <p className="text-[15px] leading-normal text-muted text-pretty">{helperText}</p>}
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
        className="absolute top-[60px] -right-[90px] size-[300px] rounded-full border border-signal/20"
      />
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
        className="absolute top-[120px] -right-[30px] size-[180px] rounded-full border border-signal/35"
      />
      <span className="absolute top-[200px] right-[50px] size-5 animate-glow rounded-full bg-signal shadow-[0_0_40px_var(--color-signal)]" />
    </div>
  );
}
