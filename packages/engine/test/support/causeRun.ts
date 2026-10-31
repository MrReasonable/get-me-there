// The run state `finalStatus` and `stopCauseOf` read (revision 55 §8.1), with nothing disabled, nothing searched and no
// flight-list step, for the tests that call them directly; `over` replaces any part.
import type { CauseRun } from '../../src/execute.js';

export function causeRun(over: Partial<CauseRun> = {}): CauseRun {
  return {
    disabledDetail: new Map(),
    disabled: new Set(),
    disabledReason: new Map(),
    searchedDatePairs: () => 0,
    flightLists: null,
    snapshot: { providers: { discovery: [], verification: [], discoveryRefreshHours: {} } },
    ...over,
  };
}
