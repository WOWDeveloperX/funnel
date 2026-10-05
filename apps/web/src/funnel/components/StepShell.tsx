import clsx from 'clsx';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { DESK_COLUMNS } from './desk';

/** Default desktop floor: short steps do not shrink to a strip. */
const DESK_FLOOR = 'lg:min-h-[min(480px,calc(100dvh-152px))]';

/**
 * The funnel surface. Phones: the screen itself (paper, full height, no chrome around it).
 * 768–1023px: a centred card up to 720px wide (radius 32, soft shadow) on the dotted desk
 * (FunnelApp). ≥1024px: a wide card; its max width and desktop composition come from `className`
 * (see StepShell / ./desk). Height is content-driven with a floor, so short steps do not shrink to
 * a strip. Overflow is clipped (not scrolled) so the sticky footer keeps working on phones.
 */
export function Frame({
  children,
  className,
  deskFloor = DESK_FLOOR,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** ≥1024px minimum height (a `lg:min-h-*` class). */
  deskFloor?: string;
  role?: string;
  'aria-live'?: 'polite';
}) {
  return (
    <div
      className={clsx(
        'relative flex min-h-dvh w-full flex-col overflow-x-clip bg-paper text-ink',
        'md:min-h-[min(560px,calc(100dvh-8rem))] md:max-w-[720px] md:overflow-clip md:rounded-[32px]',
        'md:shadow-[inset_0_1px_0_#fff,0_40px_100px_rgb(11_15_20/0.15)]',
        deskFloor,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Desktop composition of the step card (./desk has the diagram):
 * - `question`: progress + heading on the left, answers + Continue on the right;
 * - `split`: intro — dark hero on the left, body + CTA centred on the right;
 * - `wide`: one wide card; the step lays itself out (result).
 */
export type DeskLayout = 'question' | 'split' | 'wide';

const LAYOUT: Record<DeskLayout, { frame: string; floor: string; header: string; section: string; footer: string }> = {
  question: {
    frame: clsx(
      'lg:grid lg:max-w-[1080px] lg:grid-rows-[auto_auto_minmax(0,1fr)_auto] 2xl:max-w-[1200px]',
      DESK_COLUMNS,
    ),
    // Lower than the default: a three-option list would otherwise leave a gap above Continue.
    floor: 'lg:min-h-[min(420px,calc(100dvh-152px))]',
    header: 'lg:relative lg:z-10 lg:col-start-1 lg:row-start-2',
    section: 'lg:col-span-full lg:row-[2/5] lg:grid lg:grid-cols-subgrid lg:grid-rows-subgrid',
    footer: 'lg:relative lg:z-10 lg:col-start-2 lg:row-start-4 lg:px-10 lg:pt-6 lg:pb-9',
  },
  split: {
    frame:
      'lg:grid lg:max-w-[1160px] lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:grid-rows-[auto_1fr_auto_auto_1fr] 2xl:max-w-[1280px]',
    floor: DESK_FLOOR,
    header: '',
    section: 'lg:col-span-full lg:row-[2/6] lg:grid lg:grid-cols-subgrid lg:grid-rows-subgrid',
    footer: 'lg:relative lg:z-10 lg:col-start-2 lg:row-start-4 lg:px-10 lg:pt-8 lg:pb-0 xl:px-12',
  },
  wide: {
    // The result grows when its plan opens. Instead of re-centring (the whole card would jump
    // up), the card is pinned where a ~620px card would sit centred and grows downwards: the auto
    // bottom margin overrides the page's vertical centring.
    frame: 'lg:mt-[max(0px,calc((100dvh-744px)/2))] lg:mb-auto lg:max-w-[1080px] 2xl:max-w-[1200px]',
    floor: DESK_FLOOR,
    header: '',
    section: '',
    footer: 'lg:px-10 lg:pb-9',
  },
};

interface StepShellProps {
  /** Changes on every step change; drives the slide transition. */
  stepKey: string;
  /** 1 = forward (enter from the right), -1 = back (enter from the left). */
  direction: 1 | -1;
  /** Desktop (≥1024px) composition; phones and tablets always get the single column. */
  layout: DeskLayout;
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
 * inline at the bottom of the card on larger screens. Header and footer live outside the sliding
 * body so the progress animates between steps instead of sliding with them; on desktop they are
 * pinned into the grid cells of the layout above the body's subgrid (z-10 keeps them clickable).
 */
export function StepShell({ stepKey, direction, layout, header, banner, footer, children }: StepShellProps) {
  const desk = LAYOUT[layout];
  return (
    <Frame className={desk.frame} deskFloor={desk.floor}>
      {banner && <div className="max-lg:contents lg:col-span-full lg:row-start-1">{banner}</div>}

      {layout === 'question' && (
        // Soft left column behind progress + heading (desktop only, decorative).
        <span
          aria-hidden
          className="hidden lg:col-start-1 lg:row-[2/5] lg:block lg:border-r lg:border-ink/[0.06] lg:bg-ink/[0.025]"
        />
      )}

      <AnimatePresence initial={false}>
        {header && (
          <motion.div
            key="header"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={desk.header}
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
          className={clsx('flex flex-1 flex-col', desk.section)}
        >
          {children}
        </motion.section>
      </AnimatePresence>

      {footer && (
        <div
          className={clsx(
            'sticky bottom-0 z-20 bg-linear-to-b from-paper/0 via-paper via-30% to-paper px-[18px] pt-3.5 pb-[max(env(safe-area-inset-bottom),26px)] md:static md:bg-none md:px-[26px] md:pt-[26px] md:pb-7',
            desk.footer,
          )}
        >
          {footer}
        </div>
      )}
    </Frame>
  );
}
