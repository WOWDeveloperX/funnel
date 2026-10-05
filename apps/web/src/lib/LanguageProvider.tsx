import type { Language } from '@funnel/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { LanguageContext, resolveLanguage, storeLanguage, syncLanguageParam } from './language';

/**
 * Holds the app-wide UI language (resolved once from ?lang= / localStorage / default) and mirrors
 * it into <html lang> so screen readers and hyphenation follow the visible language.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(() => resolveLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    storeLanguage(next);
    syncLanguageParam(next);
    setState(next);
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
