import { createContext, useContext } from 'react';
import { type FunnelStrings, stringsFor } from './strings';

export const StringsContext = createContext<FunnelStrings>(stringsFor(null));

/** Chrome strings for the selected UI language (see StringsProvider). */
export function useStrings(): FunnelStrings {
  return useContext(StringsContext);
}
