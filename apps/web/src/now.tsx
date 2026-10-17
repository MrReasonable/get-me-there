import { type IsoDateTime, isoDateTimeOfEpochMs } from '@gmt/core';
import { createContext, useContext } from 'react';

/** The clock components read; tests pin it. Spec §3 ages are computed against it. */
export const NowContext = createContext<() => IsoDateTime>(() => isoDateTimeOfEpochMs(Date.now()));

/** Current instant in toISOString form (spec §6.3). */
export function useNow(): IsoDateTime {
  return useContext(NowContext)();
}
