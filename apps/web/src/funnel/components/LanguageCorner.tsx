import { LanguageSwitcher } from '../../components/LanguageSwitcher';

/**
 * Phone-only language switch in the top-right corner of a full-screen state (intro hero, result,
 * result loader, expired / error screens). The parent must be positioned; on ≥768px the switch
 * lives on the desk instead (FunnelApp), and question steps carry it in their header row.
 */
export function LanguageCorner({ tone }: { tone: 'paper' | 'ink' }) {
  return (
    <LanguageSwitcher
      tone={tone}
      size="sm"
      className="absolute top-[max(env(safe-area-inset-top),10px)] right-[18px] z-10 md:hidden"
    />
  );
}
