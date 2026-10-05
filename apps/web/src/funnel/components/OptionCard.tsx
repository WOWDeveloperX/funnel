import type { SelectOption } from '@funnel/shared';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useShake } from '../hooks';
import { CheckPath } from './primitives';

interface OptionCardProps {
  option: SelectOption;
  kind: 'radio' | 'checkbox';
  checked: boolean;
  /** Letter badge for radio cards (A, B, C…), also the keyboard shortcut on desktop. */
  keyLabel?: string;
  /** Muted (multi-select at max) but still focusable/clickable so a click can explain why. */
  muted?: boolean;
  /** Small tag shown on muted cards ("limit"). */
  mutedTag?: string;
  /** Red outline: the group has a revealed validation error / this card was the rejected pick. */
  invalid?: boolean;
  /** Increments to shake just this card (e.g. a pick over maxSelections). */
  shakeToken?: number;
  /** Roving tabindex inside a radiogroup (only one option is a Tab stop). */
  tabIndex?: number;
  onFocus?: () => void;
  onToggle: () => void;
}

const MUTED_TAG = 'font-mono text-[11px] font-medium text-faint';

/**
 * Option card with radio/checkbox semantics. Selected = inverted ink card with lime key and a
 * lime check that draws itself; tap feedback scales 0.98 → 1.
 */
export function OptionCard({
  option,
  kind,
  checked,
  keyLabel,
  muted = false,
  mutedTag,
  invalid = false,
  shakeToken = 0,
  tabIndex,
  onFocus,
  onToggle,
}: OptionCardProps) {
  const shakeRef = useShake(shakeToken);
  const radio = kind === 'radio';
  const dim = muted && !checked;

  return (
    <div ref={shakeRef}>
      <motion.button
        type="button"
        role={kind}
        aria-checked={checked}
        aria-disabled={dim || undefined}
        onClick={onToggle}
        tabIndex={tabIndex}
        onFocus={onFocus}
        initial={false}
        whileTap={{ scale: 0.98 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 30 }}
        className={clsx(
          'group flex w-full items-center gap-3.5 rounded-[18px] border-[1.5px] py-2 text-left font-sans text-base leading-snug font-medium md:h-full md:gap-3 md:text-[15px]',
          radio ? 'min-h-[62px] pr-2.5 pl-3 md:px-3' : 'min-h-[58px] px-3.5',
          'transition-[background-color,border-color,color,box-shadow,opacity] duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          checked
            ? 'border-ink bg-ink text-paper shadow-[0_10px_24px_rgb(11_15_20/0.19)]'
            : invalid
              ? clsx('bg-card text-ink', radio ? 'border-error-line' : 'border-error')
              : dim
                ? 'border-ink/[0.08] bg-transparent text-ink opacity-40'
                : 'border-card bg-card text-ink shadow-[0_1px_0_rgb(11_15_20/0.05)] hover:border-ink/15',
        )}
      >
        {radio && keyLabel && (
          <span
            aria-hidden
            className={clsx(
              'grid size-[34px] shrink-0 place-items-center rounded-[10px] font-mono text-[13px] font-semibold transition-colors duration-150 md:size-8 md:text-xs',
              checked ? 'bg-signal text-ink' : 'bg-paper text-muted',
            )}
          >
            {keyLabel}
          </span>
        )}
        {!radio && <Indicator kind="checkbox" checked={checked} invalid={invalid} />}

        <span className="min-w-0 flex-1">
          <span className="block md:wrap-break-word">{option.label}</span>
          {option.description && (
            <span className={clsx('mt-0.5 block text-sm font-normal', checked ? 'text-paper/65' : 'text-muted')}>
              {option.description}
            </span>
          )}
          {/* ≥768px (two-column grid): the tag goes under the label so the label keeps its width. */}
          {dim && mutedTag && <span className={clsx('mt-0.5 hidden md:block', MUTED_TAG)}>{mutedTag}</span>}
        </span>

        {dim && mutedTag && <span className={clsx('shrink-0 md:hidden', MUTED_TAG)}>{mutedTag}</span>}
        {radio && <Indicator kind="radio" checked={checked} invalid={false} />}
      </motion.button>
    </div>
  );
}

function Indicator({ kind, checked, invalid }: { kind: 'radio' | 'checkbox'; checked: boolean; invalid: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid shrink-0 place-items-center border-[1.5px] text-ink transition-colors duration-150',
        kind === 'radio' ? 'size-[26px] rounded-full md:size-6' : 'size-6 rounded-lg',
        checked
          ? 'border-signal bg-signal'
          : invalid
            ? 'border-error bg-transparent'
            : kind === 'radio'
              ? 'border-[#d5d7da] bg-transparent'
              : 'border-[#c9ccd0] bg-transparent',
      )}
    >
      <CheckPath checked={checked} className="size-3.5" />
    </span>
  );
}
