import { unitFor } from '@funnel/shared';
import clsx from 'clsx';
import { useAnimate, useReducedMotionConfig } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { useLanguage } from '../../lib/language';
import { useShake } from '../hooks';
import { useStrings } from '../i18n';
import { FieldError, StepHeading } from './primitives';
import type { StepRendererProps } from './types';

interface NumberStepProps extends StepRendererProps {
  /** Called on blur with a non-empty value, so the error can be revealed then (not on every keystroke). */
  onBlur: () => void;
}

const toDraft = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Draft text → stored answer: a finite number, or undefined when empty/incomplete ("-", "."). */
function parseDraft(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Display size of the big value: shrinks for long numbers so it never overflows a phone. */
function valueSizeClass(chars: number): string {
  if (chars <= 3) return 'text-[104px]';
  if (chars <= 4) return 'text-[84px]';
  if (chars <= 6) return 'text-[60px]';
  return 'text-[44px]';
}

/**
 * Huge Geologica value with the unit, a 220px underline, 64px −/+ steppers and a min…max scale.
 * The text draft is local; the stored answer is a real number (or cleared when the field is
 * empty/unparseable). Digits roll when the steppers change the value. The unit agrees with the
 * shown number in the UI language (catalog plural forms: 1 человек, 2 человека, 5 человек).
 */
export function NumberStep({ step, value, error, shakeToken, onChange, onBlur }: NumberStepProps) {
  const t = useStrings();
  const input = step.input;
  const min = input?.min;
  const max = input?.max;
  const increment = input?.step ?? 1;
  const integerOnly = Number.isInteger(increment);
  const allowNegative = min === undefined || min < 0;

  // Local text draft, re-synced when the stored number changes from outside (steppers, restore).
  const [draft, setDraft] = useState(() => toDraft(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (!Object.is(syncedValue, value)) {
    setSyncedValue(value);
    if (parseDraft(draft) !== value) setDraft(toDraft(value));
  }

  const shakeRef = useShake(shakeToken);
  const [rollScope, animateRoll] = useAnimate<HTMLInputElement>();
  const reduceMotion = useReducedMotionConfig();

  const titleId = `${step.id}-title`;
  const errorId = `${step.id}-error`;
  const unitId = `${step.id}-unit`;
  const current = typeof value === 'number' && Number.isFinite(value) ? value : null;

  const commit = (text: string) => {
    setDraft(text);
    onChange(parseDraft(text));
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    let text = e.target.value.replace(',', '.');
    const allowed = integerOnly ? (allowNegative ? /[^0-9-]/g : /[^0-9]/g) : allowNegative ? /[^0-9.-]/g : /[^0-9.]/g;
    text = text.replace(allowed, '');
    // A minus sign only at the start.
    text = text.replace(/(?!^)-/g, '');
    commit(text.slice(0, 12));
  };

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  const bump = (dir: 1 | -1) => {
    const base = current ?? null;
    const next = base === null ? clamp(min ?? 0) : clamp(Math.round((base + dir * increment) * 1e6) / 1e6);
    if (next === base) return;
    commit(String(next));
    if (!reduceMotion && rollScope.current) {
      void animateRoll(
        rollScope.current,
        { y: [dir * 18, 0], opacity: [0.25, 1] },
        { duration: 0.18, ease: 'easeOut' },
      );
    }
  };

  const decDisabled = current !== null && min !== undefined && current <= min;
  const incDisabled = current !== null && max !== undefined && current >= max;
  const belowMin = !!error && current !== null && min !== undefined && current < min;
  const aboveMax = !!error && current !== null && max !== undefined && current > max;

  const placeholder = input?.placeholder ?? String(min ?? 0);
  const shown = draft || placeholder;
  const { language } = useLanguage();
  // While empty, the unit agrees with the placeholder number the field shows.
  const unit = input?.unit ? unitFor(input, current ?? (Number(placeholder) || 0), language) : '';

  return (
    <div className="flex flex-1 flex-col">
      <StepHeading
        id={titleId}
        eyebrow={step.content.eyebrow}
        title={step.content.title}
        helperText={step.content.helperText}
        className="px-[22px] pt-[34px] md:px-[30px]"
      />

      <div className="flex flex-1 flex-col items-center justify-center gap-[22px] px-[22px] py-8 md:px-[30px] md:py-10">
        <div ref={shakeRef} className="flex flex-col items-center gap-1">
          <label className="flex max-w-full items-baseline justify-center gap-2.5">
            <span className="sr-only">{step.content.title}</span>
            {/* Auto-width: an invisible copy of the text sizes the grid cell the input fills. */}
            <span className={clsx('inline-grid min-w-0', valueSizeClass(shown.length))}>
              <span
                aria-hidden
                className="invisible col-start-1 row-start-1 font-display leading-none font-bold tracking-[-0.05em] whitespace-pre tabular-nums"
              >
                {shown}
              </span>
              <input
                ref={rollScope}
                type="text"
                size={1}
                inputMode={integerOnly && !allowNegative ? 'numeric' : 'decimal'}
                pattern={integerOnly && !allowNegative ? '[0-9]*' : undefined}
                autoComplete="off"
                enterKeyHint="next"
                placeholder={placeholder}
                value={draft}
                onChange={handleInput}
                onBlur={() => {
                  if (draft.trim() !== '') onBlur();
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={clsx(unit && unitId, error && errorId) || undefined}
                className={clsx(
                  'col-start-1 row-start-1 w-full min-w-[0.6em] bg-transparent p-0 text-center font-display leading-none font-bold tracking-[-0.05em] tabular-nums outline-none',
                  'placeholder:text-ink/15 focus-visible:outline-none',
                  error ? 'text-error' : 'text-ink',
                )}
              />
            </span>
            {unit && (
              <span id={unitId} className="shrink-0 text-lg font-medium text-muted">
                {unit}
              </span>
            )}
          </label>
          <span
            aria-hidden
            className={clsx(
              'h-[3px] w-[220px] max-w-full rounded-full transition-colors duration-150',
              error ? 'bg-error' : current !== null ? 'bg-ink' : 'bg-ink/10',
            )}
          />
        </div>

        <div className="flex items-center gap-3">
          <StepperButton label={t.decrease} disabled={decDisabled} tone="light" onClick={() => bump(-1)}>
            <Minus className="size-7" strokeWidth={1.75} aria-hidden />
          </StepperButton>
          <span aria-hidden className="rounded-[10px] bg-ink/[0.04] px-3 py-2 font-mono text-xs font-medium text-muted">
            ±{increment}
          </span>
          <StepperButton label={t.increase} disabled={incDisabled} tone="dark" onClick={() => bump(1)}>
            <Plus className="size-7" strokeWidth={1.75} aria-hidden />
          </StepperButton>
        </div>

        {min !== undefined && max !== undefined && (
          <div
            aria-hidden
            className="flex w-[260px] max-w-full items-center gap-2.5 font-mono text-[11px] font-medium text-faint"
          >
            <span className={clsx(belowMin && 'text-error')}>{min}</span>
            <span className="h-0.5 flex-1 bg-[repeating-linear-gradient(90deg,rgb(11_15_20/0.2)_0_4px,transparent_4px_8px)]" />
            <span className={clsx(aboveMax && 'text-error')}>{max}</span>
          </div>
        )}

        <FieldError id={errorId} message={error} className="w-full" />
      </div>
    </div>
  );
}

function StepperButton({
  label,
  disabled,
  tone,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  tone: 'light' | 'dark';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'grid size-16 shrink-0 place-items-center rounded-[22px] transition-[background-color,transform,opacity] duration-150 active:scale-95 disabled:opacity-35 disabled:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        tone === 'light'
          ? 'border border-ink/[0.08] bg-card text-ink hover:bg-white/70'
          : 'bg-ink text-signal hover:bg-ink/90',
      )}
    >
      {children}
    </button>
  );
}
