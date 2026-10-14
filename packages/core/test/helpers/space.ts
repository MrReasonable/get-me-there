// Test builders shared by the WP1 suites. Worked-example airports only (LHR, LGW → JFK, EWR)
// plus clearly synthetic codes (AAA, BBB).
import type { Cell, CellKey, ResolvedSpace } from '../../src/types/definition.js';
import type { CellOutcome, CellOutcomeStatus } from '../../src/types/execution.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

export const iatas = (...codes: string[]) => codes.map(asIata);

export function space(p: {
  o: string[];
  d: string[];
  from: string;
  to: string;
  min: number;
  max: number;
}): ResolvedSpace {
  return {
    origins: iatas(...p.o),
    destinations: iatas(...p.d),
    departureFrom: asIsoDate(p.from),
    departureTo: asIsoDate(p.to),
    minNights: p.min,
    maxNights: p.max,
  };
}

export function key(o: string, d: string, dep: string, ret: string): CellKey {
  return {
    origin: asIata(o),
    destination: asIata(d),
    departureDate: asIsoDate(dep),
    returnDate: asIsoDate(ret),
  };
}

export function spaceCell(o: string, d: string, dep: string, ret: string, nights: number): Cell {
  return { ...key(o, d, dep, ret), nights };
}

export function outcome(
  k: CellKey,
  status: CellOutcomeStatus,
  over: Partial<Omit<CellOutcome, keyof CellKey | 'status'>> = {},
): CellOutcome {
  return {
    ...k,
    executionId: 'exec-1',
    stage: 'discovery',
    providerId: 'travelpayouts',
    status,
    reason: null,
    attempts: 0,
    lastError: null,
    fetchedAt: null,
    minPence: null,
    cabin: null,
    pointOfSale: null,
    sourceKind: null,
    reusedFromExecutionId: null,
    ...over,
  };
}
