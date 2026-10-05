/**
 * "RU | EN" language switch shared by the funnel and the admin. Two toggle buttons (aria-pressed)
 * in a labelled group; the visible code is the accessible name, the full language name is the
 * tooltip. Switching re-renders in place: no reload, no new session, no analytics event.
 */
import { type Language, SUPPORTED_LANGUAGES } from '@funnel/shared';
import clsx from 'clsx';
import { useLanguage } from '../lib/language';

/** Native names (each language names itself) and the group label in the current language. */
const NATIVE_NAME: Record<Language, string> = { ru: 'Русский', en: 'English' };
const GROUP_LABEL: Record<Language, string> = { ru: 'Язык', en: 'Language' };

/**
 * `paper`: ink on the light funnel surfaces · `ink`: paper on the dark hero / loader ·
 * `admin`: the dark instrument rail.
 */
export type LanguageSwitcherTone = 'paper' | 'ink' | 'admin';

const TONES: Record<LanguageSwitcherTone, { track: string; on: string; off: string; focus: string }> = {
  paper: {
    track: 'border-ink/[0.08] bg-card/80',
    on: 'bg-ink text-paper',
    off: 'text-muted hover:text-ink',
    focus: 'focus-visible:outline-ink',
  },
  ink: {
    track: 'border-paper/15 bg-paper/[0.06]',
    on: 'bg-paper text-ink',
    off: 'text-paper/60 hover:text-paper',
    focus: 'focus-visible:outline-signal',
  },
  admin: {
    track: 'border-ad-line bg-ad-bg',
    on: 'bg-ad-text text-ad-bg',
    off: 'text-ad-faint hover:text-ad-text-2',
    focus: 'focus-visible:outline-signal',
  },
};

export function LanguageSwitcher({
  tone = 'paper',
  size = 'md',
  className,
}: {
  tone?: LanguageSwitcherTone;
  /** `sm`: compact pill for phone headers and overlays. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { language, setLanguage } = useLanguage();
  const t = TONES[tone];
  return (
    <div
      role="group"
      aria-label={GROUP_LABEL[language]}
      className={clsx(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full border p-[3px] font-mono font-semibold',
        size === 'sm' ? 'text-[11px]' : 'text-xs',
        t.track,
        className,
      )}
    >
      {SUPPORTED_LANGUAGES.map((code) => {
        const on = code === language;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            title={NATIVE_NAME[code]}
            aria-pressed={on}
            onClick={() => {
              if (!on) setLanguage(code);
            }}
            className={clsx(
              'rounded-full leading-none tracking-[0.06em] transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              size === 'sm' ? 'px-2 py-[5px]' : 'px-2.5 py-1.5',
              on ? t.on : t.off,
              t.focus,
            )}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
