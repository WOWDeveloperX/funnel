import type { ReactNode } from 'react';
import { StringsContext } from './context';
import { stringsFor } from './strings';

/** Provides the chrome strings for the selected UI language to every step renderer. */
export function StringsProvider({ language, children }: { language: string; children: ReactNode }) {
  return <StringsContext.Provider value={stringsFor(language)}>{children}</StringsContext.Provider>;
}
