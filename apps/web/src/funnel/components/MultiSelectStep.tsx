import { validateAnswer } from '@funnel/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { useShake } from '../hooks';
import { useStrings } from '../i18n';
import { OptionCard } from './OptionCard';
import { FieldError, StepHeading } from './primitives';
import type { StepRendererProps } from './types';

/**
 * Checkbox cards with a "Selected k of max" counter pill (pips fill one by one, the pill inverts
 * to ink/lime at max). At maxSelections the remaining options are dimmed with a "limit" tag;
 * picking one more shakes that card and the counter and shows the config's maxSelections message.
 */
export function MultiSelectStep({ step, value, error, shakeToken, onChange }: StepRendererProps) {
  const t = useStrings();
  const options = step.input?.options ?? [];
  const selected: string[] = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const max = step.validation?.maxSelections;
  const atMax = max !== undefined && selected.length >= max;

  const [overflow, setOverflow] = useState<{ value: string; message: string } | null>(null);
  const [overflowCount, setOverflowCount] = useState(0);
  const groupShakeRef = useShake(shakeToken);
  const counterShakeRef = useShake<HTMLSpanElement>(0, overflowCount);

  const titleId = `${step.id}-title`;
  const errorId = `${step.id}-error`;
  const message = overflow?.message ?? error;

  const toggle = (optionValue: string) => {
    if (selected.includes(optionValue)) {
      setOverflow(null);
      onChange(selected.filter((v) => v !== optionValue));
      return;
    }
    const nextSelection = [...selected, optionValue];
    if (atMax) {
      // validateAnswer yields the config's maxSelections message (or a sensible default).
      setOverflow({
        value: optionValue,
        message: validateAnswer(step, nextSelection) ?? t.maxSelections(max ?? selected.length),
      });
      setOverflowCount((n) => n + 1);
      return;
    }
    setOverflow(null);
    // Keep the config's option order regardless of click order.
    onChange(options.map((o) => o.value).filter((v) => nextSelection.includes(v)));
  };

  const counterTone = overflow ? 'error' : atMax ? 'max' : selected.length > 0 ? 'some' : 'none';

  return (
    <div className="flex flex-1 flex-col">
      <StepHeading
        id={titleId}
        eyebrow={step.content.eyebrow}
        title={step.content.title}
        className="px-[22px] pt-[34px] pb-[18px] md:px-[30px]"
        helperText={
          <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
            {step.content.helperText && (
              <p className="min-w-0 flex-1 basis-40 text-[15px] leading-normal text-muted text-pretty">
                {step.content.helperText}
              </p>
            )}
            <span
              ref={counterShakeRef}
              aria-live="polite"
              className={clsx(
                'ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-[5px] font-mono text-xs font-semibold transition-colors duration-200',
                counterTone === 'error' && 'bg-error text-white',
                counterTone === 'max' && 'bg-ink text-signal',
                counterTone === 'some' && 'bg-ink/5 text-ink',
                counterTone === 'none' && 'bg-ink/5 text-muted',
              )}
            >
              {max !== undefined && (
                <span className="flex gap-[3px]" aria-hidden>
                  {Array.from({ length: max }, (_, i) => (
                    <span
                      key={i}
                      className={clsx(
                        'size-1.5 rounded-[2px] transition-colors duration-200',
                        i >= selected.length
                          ? counterTone === 'error' || counterTone === 'max'
                            ? 'bg-white/25'
                            : 'bg-ink/15'
                          : counterTone === 'error'
                            ? 'bg-white'
                            : counterTone === 'max'
                              ? 'bg-signal'
                              : 'bg-ink',
                      )}
                    />
                  ))}
                </span>
              )}
              {t.selected(selected.length, max)}
            </span>
          </div>
        }
      />

      <div
        ref={groupShakeRef}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={message ? errorId : undefined}
        className="flex flex-col gap-2 px-[18px] md:px-[26px]"
      >
        {options.map((option) => {
          const checked = selected.includes(option.value);
          const rejected = overflow?.value === option.value;
          return (
            <OptionCard
              key={option.value}
              option={option}
              kind="checkbox"
              checked={checked}
              muted={atMax && !checked && !rejected}
              mutedTag={t.limit}
              invalid={rejected}
              shakeToken={rejected ? overflowCount : 0}
              onToggle={() => toggle(option.value)}
            />
          );
        })}
      </div>
      <FieldError id={errorId} message={message} className="px-[22px] pt-3.5 md:px-[30px]" />
    </div>
  );
}
