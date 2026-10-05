/**
 * Small presentational building blocks shared by the step renderers ("paper" design: ink + lime).
 * Styling lives in Tailwind classes here so the funnel can be restyled in one place.
 */
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, type Ref, useState } from 'react';
import { useFocusOnMount } from '../hooks';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  /** Looks disabled but stays clickable (so a click can explain *why* it is not ready). */
  softDisabled?: boolean;
  /** Icon inside the lime square on the right (default: arrow →). */
  icon?: ReactNode;
  /** `adaptive`: 60px on phones, the compact 56px desktop size from 768px. */
  size?: 'lg' | 'adaptive';
}

/**
 * The primary action: ink pill with a lime square holding the arrow. Soft-disabled = ink/7 with
 * faint text (still focusable and clickable).
 */
export function ActionButton({
  softDisabled = false,
  icon,
  size = 'lg',
  className,
  children,
  type = 'button',
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type}
      aria-disabled={softDisabled || undefined}
      className={clsx(
        'group inline-flex items-center justify-between gap-5 font-sans font-semibold',
        'transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.99]',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ink',
        'h-[60px] rounded-[20px] pr-2 pl-6 text-[17px]',
        size === 'adaptive' && 'md:h-14 md:rounded-[18px] md:pl-[22px] md:text-base',
        softDisabled
          ? 'bg-ink/[0.07] text-faint'
          : 'bg-ink text-paper shadow-[0_12px_28px_-14px_rgb(11_15_20/0.55)] hover:bg-ink/90',
        className,
      )}
      {...rest}
    >
      <span className="min-w-0 truncate text-left">{children}</span>
      <span
        aria-hidden
        className={clsx(
          'grid shrink-0 place-items-center transition-colors duration-150',
          'size-11 rounded-[14px]',
          size === 'adaptive' && 'md:size-10 md:rounded-xl',
          softDisabled ? 'bg-ink/5 text-[#b5bac0]' : 'bg-signal text-ink',
        )}
      >
        {icon ?? <ArrowRight className="size-5" strokeWidth={2.25} />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Headings & errors
// ---------------------------------------------------------------------------

interface StepHeadingProps {
  eyebrow?: string;
  title?: string;
  helperText?: ReactNode;
  id?: string;
  className?: string;
}

/** Eyebrow (mono caps) + Geologica title + muted helper. The title receives focus on mount. */
export function StepHeading({ eyebrow, title, helperText, id, className }: StepHeadingProps) {
  const ref = useFocusOnMount<HTMLHeadingElement>();
  return (
    <header className={clsx('flex flex-col gap-2.5', className)}>
      {eyebrow && (
        <span className="font-mono text-xs font-medium tracking-[0.12em] text-muted uppercase">{eyebrow}</span>
      )}
      {title && (
        <h1
          ref={ref}
          id={id}
          tabIndex={-1}
          className="font-display text-[30px] leading-[1.08] font-bold tracking-[-0.03em] text-pretty text-ink outline-none md:text-[34px] md:leading-[1.05]"
        >
          {title}
        </h1>
      )}
      {helperText &&
        (typeof helperText === 'string' ? (
          <p className="text-[15px] leading-normal text-muted text-pretty">{helperText}</p>
        ) : (
          helperText
        ))}
    </header>
  );
}

/** Validation message box: error-soft background, error-ink text, red "!" circle. */
export function FieldError({ id, message, className }: { id?: string; message: string | null; className?: string }) {
  return (
    <div className={className} aria-live="polite">
      <AnimatePresence initial={false}>
        {message && (
          <motion.p
            id={id}
            key={message}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-start gap-2.5 rounded-[14px] bg-error-soft px-3.5 py-3 text-sm font-medium text-error-ink"
          >
            <span
              aria-hidden
              className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-error-ink text-xs font-bold text-white"
            >
              !
            </span>
            <span className="min-w-0">{message}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motion helpers
// ---------------------------------------------------------------------------

/** Check mark whose stroke "draws" itself in when `checked` becomes true. */
export function CheckPath({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <motion.path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      />
    </svg>
  );
}

/**
 * Number that rolls vertically when it changes: up when increasing, down when decreasing.
 * Used for the progress counter and the multi-select counter.
 */
export function RollingNumber({ value, className }: { value: number | string; className?: string }) {
  const numeric = typeof value === 'number' ? value : Number(value);
  // Remember the previous value to pick the roll direction ("adjust state during render" pattern).
  const [track, setTrack] = useState({ value: numeric, direction: 1 });
  if (!Object.is(track.value, numeric)) {
    setTrack({ value: numeric, direction: numeric < track.value ? -1 : 1 });
  }
  const direction = track.direction;

  return (
    <span className={clsx('relative inline-flex overflow-hidden tabular-nums', className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span
          key={String(value)}
          custom={direction}
          variants={{
            enter: (d: number) => ({ y: d > 0 ? '70%' : '-70%', opacity: 0 }),
            center: { y: '0%', opacity: 1 },
            exit: (d: number) => ({ y: d > 0 ? '-70%' : '70%', opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
