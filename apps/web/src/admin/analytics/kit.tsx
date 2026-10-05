/**
 * Small dark "instrument" kit shared by the analytics and events pages: panels, segmented control,
 * switch, notices and skeletons. Formatters are `t.fmt` (../i18n), hooks live in ./hooks.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Focus ring that is visible on the dark admin surfaces. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal focus-visible:outline-solid';

export const colHead = 'font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ad-faint';

export function Panel({
  title,
  aside,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding (the panel draws its own rows edge to edge). */
  flush?: boolean;
}) {
  return (
    <section
      className={clsx(
        'flex min-w-0 flex-col rounded-[18px] border border-ad-line-2 bg-ad-panel',
        flush ? 'overflow-hidden' : 'gap-3 p-5',
        className,
      )}
    >
      {(title || aside) && (
        <div
          className={clsx(
            'flex flex-wrap items-center justify-between gap-x-3 gap-y-1',
            flush && 'px-5 pt-[18px] pb-3.5',
          )}
        >
          {title && <h2 className="font-display text-base font-semibold text-ad-text">{title}</h2>}
          {aside && (
            <div className="flex items-center gap-3 font-mono text-[11px] font-medium text-ad-faint">{aside}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function MainBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={clsx(
        'rounded-[5px] bg-signal px-[7px] py-0.5 font-mono text-[10px] font-bold leading-none text-ad-bg',
        className,
      )}
    >
      {t.analytics.mainBadge}
    </span>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-ad-sunken)_0,var(--color-ad-line)_50%,var(--color-ad-sunken)_100%)] bg-[length:400px_100%]',
        className,
      )}
    />
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Text colour when not selected (e.g. variant colour). */
  tint?: string;
}

/** Segmented control with radio-group semantics. */
export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  bold,
}: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  bold?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'inline-flex shrink-0 gap-0.5 rounded-[11px] border border-ad-line bg-ad-bg p-[3px] font-mono text-xs',
        bold ? 'font-bold' : 'font-semibold',
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={!on && o.tint ? { color: o.tint } : undefined}
            className={clsx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-[11px] py-1.5 transition-colors duration-150',
              on ? 'bg-ad-text text-ad-bg' : 'text-ad-muted hover:bg-ad-chip hover:text-ad-text',
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Labelled on/off switch. */
export function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx('inline-flex shrink-0 items-center gap-2 rounded-lg text-[13px] text-ad-text-2', focusRing)}
    >
      <span
        aria-hidden
        className={clsx(
          'relative h-5 w-[34px] rounded-full border transition-colors duration-150',
          checked ? 'border-signal/60 bg-signal/20' : 'border-ad-line-3 bg-ad-chip',
        )}
      >
        <span
          className={clsx(
            'absolute top-[2px] left-[2px] size-3.5 rounded-full transition-transform duration-150 motion-reduce:transition-none',
            checked ? 'translate-x-3.5 bg-signal' : 'bg-ad-faint',
          )}
        />
      </span>
      {children}
    </button>
  );
}

/** Centered empty / error message inside a panel. */
export function Notice({
  title,
  children,
  tone = 'neutral',
  className,
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={clsx('flex flex-col items-center justify-center gap-2 px-4 py-10 text-center', className)}
    >
      <p className={clsx('font-display text-lg font-semibold', tone === 'error' ? 'text-bad-ink' : 'text-ad-text')}>
        {title}
      </p>
      {children && <div className="max-w-md text-sm leading-relaxed text-ad-muted">{children}</div>}
    </div>
  );
}

export function GhostButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex h-9 items-center gap-2 rounded-[10px] border border-ad-line-3 px-3.5 text-[13px] font-medium text-ad-text-2 transition-colors hover:border-ad-muted hover:text-ad-text',
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  );
}
