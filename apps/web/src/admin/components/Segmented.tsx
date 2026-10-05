import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Text colour of the option while NOT selected (e.g. variant colours "A" / "B"). */
  className?: string;
}

/** Compact segmented control (radio group semantics), mono labels on a sunken track. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[11px] border border-ad-line bg-ad-bg p-[3px]',
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={clsx(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-[11px] font-mono text-xs font-semibold whitespace-nowrap transition-colors duration-150',
              selected ? 'bg-ad-text text-ad-bg' : clsx('hover:text-ad-text', o.className ?? 'text-ad-muted'),
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
