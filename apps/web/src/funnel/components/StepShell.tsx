import clsx from 'clsx';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The funnel surface. Phones: the screen itself (paper, full height, no chrome around it).
 * ≥768px: a 560px card (radius 32, soft shadow) centred on the dotted desk (FunnelApp).
 * Overflow is clipped (not scrolled) so the sticky footer keeps working on phones.
 */
export function Frame({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  role?: string;
  'aria-live'?: 'polite';
}) {
  return (
    <div
      className={clsx(
        'relative flex min-h-dvh w-full flex-col overflow-x-clip bg-paper text-ink',
        'md:min-h-[min(680px,calc(100dvh-13rem))] md:w-[560px] md:max-w-full md:overflow-clip md:rounded-[32px]',
        'md:shadow-[inset_0_1px_0_#fff,0_40px_100px_rgb(11_15_20/0.15)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface StepShellProps {
  /** Changes on every step change; drives the slide transition. */
  stepKey: string;
  /** 1 = forward (enter from the right), -1 = back (enter from the left). */
  direction: 1 | -1;
  header?: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

// Motion spec: forward x +24 → 0, back −24 → 0, ≤300ms. Reduced motion (MotionConfig "user")
// drops the transform and keeps only the opacity fade.
const slide: Variants = {
  enter: (dir: number) => ({ x: dir * 24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -24, opacity: 0 }),
};

/**
 * Common frame for every step: optional banner, header (back + segmented progress), the animated
 * step body and a footer. The footer is sticky at the bottom on phones (paper gradient fade) and
 * inline at the bottom of the card on desktop. Header and footer live outside the sliding body so
 * the progress animates between steps instead of sliding with them.
 */
export function StepShell({ stepKey, direction, header, banner, footer, children }: StepShellProps) {
  return (
    <Frame>
      {banner}

      <AnimatePresence initial={false}>
        {header && (
          <motion.div
            key="header"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {header}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.section
          key={stepKey}
          custom={direction}
          variants={slide}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="flex flex-1 flex-col"
        >
          {children}
        </motion.section>
      </AnimatePresence>

      {footer && (
        <div className="sticky bottom-0 z-20 bg-linear-to-b from-paper/0 via-paper via-30% to-paper px-[18px] pt-3.5 pb-[max(env(safe-area-inset-bottom),26px)] md:static md:bg-none md:px-[26px] md:pt-[26px] md:pb-7">
          {footer}
        </div>
      )}
    </Frame>
  );
}
