import clsx from 'clsx';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useEffectEvent, useState } from 'react';
import { useShake } from '../hooks';
import { DESK_ASIDE, DESK_MAIN } from './desk';
import { OptionCard } from './OptionCard';
import { optionKey } from './options';
import { FieldError, StepHeading } from './primitives';
import type { StepRendererProps } from './types';

/**
 * Option cards with radio semantics and letter badges. Selecting auto-advances (handled by the
 * parent via onChange). Letter keys pick an option (desktop shortcut; Enter continues globally).
 * ≥768px: a two-column option grid when there are four or more options. ≥1024px: heading on the
 * left, options + error on the right (./desk).
 */
export function SingleSelectStep({ step, value, error, shakeToken, onChange }: StepRendererProps) {
  const shakeRef = useShake(shakeToken);
  const titleId = `${step.id}-title`;
  const errorId = `${step.id}-error`;
  const options = step.input?.options ?? [];

  // Roving tabindex: the group is one Tab stop (the checked option, else the last focused or the
  // first); arrow keys move focus between options. Selecting stays on click / Space / Enter / letter
  // keys, because a selection auto-advances to the next step.
  const checkedIndex = options.findIndex((o) => o.value === value);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const tabStop = focusIndex ?? (checkedIndex >= 0 ? checkedIndex : 0);
  const onGroupKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : null;
    if (delta === 0 && edge === null) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    if (radios.length === 0) return;
    e.preventDefault();
    const current = radios.findIndex((r) => r === document.activeElement);
    const next = edge ?? ((current < 0 ? tabStop : current) + delta + radios.length) % radios.length;
    radios[next]?.focus();
  };

  // Keyboard letter shortcuts (A–Z), reading the latest options/onChange.
  const onLetterKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key.length !== 1) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    const index = e.key.toUpperCase().charCodeAt(0) - 65;
    const option = options[index];
    if (index < 0 || index >= 26 || !option) return;
    e.preventDefault();
    onChange(option.value);
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onLetterKey(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-1 flex-col lg:contents">
      <StepHeading
        id={titleId}
        eyebrow={step.content.eyebrow}
        title={step.content.title}
        helperText={step.content.helperText}
        className={clsx('px-[22px] pt-[34px] pb-[22px] md:px-[30px]', DESK_ASIDE)}
      />
      <div className={clsx('max-lg:contents', DESK_MAIN)}>
        <div
          ref={shakeRef}
          role="radiogroup"
          aria-labelledby={titleId}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          onKeyDown={onGroupKeyDown}
          className={clsx('grid gap-2 px-[18px] md:px-[26px] lg:px-0', options.length >= 4 && 'md:grid-cols-2')}
        >
          {options.map((option, i) => (
            <OptionCard
              key={option.value}
              option={option}
              kind="radio"
              keyLabel={optionKey(i)}
              checked={value === option.value}
              invalid={!!error}
              tabIndex={i === tabStop ? 0 : -1}
              onFocus={() => setFocusIndex(i)}
              onToggle={() => onChange(option.value)}
            />
          ))}
        </div>
        <FieldError id={errorId} message={error} className="px-[22px] pt-3.5 md:px-[30px] lg:px-0" />
      </div>
    </div>
  );
}
