// The worked example (London → New York; brief README), sized for route tests; the fixture provider in both stages.
import { asIata, asIsoDate, type DefinitionInput } from '@gmt/core';

export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');

/** A small window near the harness clock: 2026-11-02 … 2026-11-05 departures, 10–21 nights. */
export const SMALL_WINDOW = {
  kind: 'absolute',
  from: asIsoDate('2026-11-02'),
  to: asIsoDate('2026-11-05'),
} as const;

export function exampleDefinitionInput(overrides: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York',
    origins: [LHR],
    destinations: [JFK],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 1000, maxFreeCalls: 2000, maxCostMicroGbp: 10_000_000 },
    providers: { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 168 } },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: true,
    ...overrides,
  };
}
