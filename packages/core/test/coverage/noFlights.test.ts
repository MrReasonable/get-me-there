// Revision 74: the day pairs a "no flights" page did not show, grouped per route × provider; no outcome is reclassified.
import { describe, expect, it } from 'vitest';
import { isNoFlightsUnseen, NO_FLIGHTS_UNSEEN, noFlightsRoutes } from '../../src/coverage/noFlights.js';
import type { CellOutcome } from '../../src/types/execution.js';
import { key, outcome } from '../helpers/space.js';

const unseen = `${NO_FLIGHTS_UNSEEN} the page answered no flights for the pair it asked`;
const cf = { providerId: 'camoufox' } as const;
const at = (o: string, d: string, day: number) =>
  key(o, d, `2027-03-${String(day).padStart(2, '0')}`, '2027-03-20');
const err = (o: string, d: string, day: number, lastError: string | null, over: Partial<CellOutcome> = {}) =>
  outcome(at(o, d, day), 'error', { ...cf, reason: 'parse', lastError, ...over });

describe('isNoFlightsUnseen', () => {
  it('is the code alone or the code then its words, on an error outcome only', () => {
    expect(NO_FLIGHTS_UNSEEN).toBe('no-flights-unseen');
    expect(isNoFlightsUnseen({ status: 'error', lastError: NO_FLIGHTS_UNSEEN })).toBe(true);
    expect(isNoFlightsUnseen({ status: 'error', lastError: unseen })).toBe(true);
    expect(isNoFlightsUnseen({ status: 'no_data', lastError: unseen })).toBe(false);
    expect(isNoFlightsUnseen({ status: 'error', lastError: null })).toBe(false);
    expect(isNoFlightsUnseen({ status: 'error', lastError: 'no-flights-unseenish words' })).toBe(false);
    expect(isNoFlightsUnseen({ status: 'error', lastError: 'cell-unparsed no-flights-unseen' })).toBe(false);
  });
});

describe('noFlightsRoutes', () => {
  it('is empty when no outcome is no-flights-unseen', () => {
    expect(noFlightsRoutes([])).toEqual([]);
    expect(noFlightsRoutes([err('LHR', 'JFK', 1, 'cell-unparsed the cell could not be read')])).toEqual([]);
  });

  it('marks a route every page of which said no flights, its query pairs no_data', () => {
    const out = [
      err('LGW', 'JFK', 1, unseen),
      err('LGW', 'JFK', 2, unseen),
      outcome(at('LGW', 'JFK', 3), 'no_data', cf),
      outcome(at('LGW', 'JFK', 4), 'skipped', { ...cf, reason: 'budget' }),
      outcome(at('LGW', 'JFK', 5), 'not_run', cf),
    ];
    expect(noFlightsRoutes(out)).toEqual([
      { origin: 'LGW', destination: 'JFK', providerId: 'camoufox', cells: 2, everyPage: true },
    ]);
  });

  it('is not every page when the route priced, said no fares, or failed another way', () => {
    for (const other of [
      outcome(at('LHR', 'JFK', 9), 'priced', { ...cf, minPence: 30_000 }),
      outcome(at('LHR', 'JFK', 9), 'empty', cf),
      err('LHR', 'JFK', 9, 'view-unparsed the view failed its check'),
      err('LHR', 'JFK', 9, null),
    ]) {
      expect(noFlightsRoutes([err('LHR', 'JFK', 1, unseen), other])).toEqual([
        { origin: 'LHR', destination: 'JFK', providerId: 'camoufox', cells: 1, everyPage: false },
      ]);
    }
  });

  it('keeps routes and providers apart, sorted by origin, destination and provider, and ignores verification', () => {
    const out = [
      err('LHR', 'JFK', 1, unseen),
      err('LGW', 'JFK', 1, unseen, { providerId: 'travelpayouts' }),
      err('LGW', 'JFK', 2, unseen),
      err('LGW', 'EWR', 1, unseen),
      outcome(at('LGW', 'EWR', 2), 'priced', { ...cf, minPence: 1 }),
      err('LCY', 'JFK', 1, unseen, { stage: 'verification' }),
      outcome(at('LHR', 'JFK', 2), 'priced', { ...cf, minPence: 1, stage: 'verification' }),
    ];
    expect(
      noFlightsRoutes(out).map((r) => [r.origin, r.destination, r.providerId, r.cells, r.everyPage]),
    ).toEqual([
      ['LGW', 'EWR', 'camoufox', 1, false],
      ['LGW', 'JFK', 'camoufox', 1, true],
      ['LGW', 'JFK', 'travelpayouts', 1, true],
      ['LHR', 'JFK', 'camoufox', 1, true],
    ]);
  });

  it('sorts whatever order the outcomes come in', () => {
    const codes = ['LCY', 'LGW', 'LHR'];
    const route = (o: string) => [err(o, 'JFK', 1, unseen)];
    expect(noFlightsRoutes(codes.flatMap(route)).map((r) => r.origin)).toEqual(codes);
    expect(noFlightsRoutes([...codes].reverse().flatMap(route)).map((r) => r.origin)).toEqual(codes);
  });
});
