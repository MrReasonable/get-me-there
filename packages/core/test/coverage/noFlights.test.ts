// Revision 74: the day pairs a "no flights" page did not show, grouped per route × provider; no outcome is reclassified.
import { describe, expect, it } from 'vitest';
import {
  isNoFlightsNoData,
  isNoFlightsUnseen,
  NO_FLIGHTS_ASKED,
  NO_FLIGHTS_UNSEEN,
  NO_FLIGHTS_WORDS,
  noFlightsDetail,
  noFlightsRoutes,
  SALE_WINDOW_END,
} from '../../src/coverage/noFlights.js';
import type { CellOutcome } from '../../src/types/execution.js';
import { key, outcome } from '../helpers/space.js';

const unseen = `${NO_FLIGHTS_UNSEEN} the page answered no flights for the pair it asked`;
const cf = { providerId: 'camoufox' } as const;
const at = (o: string, d: string, day: number) =>
  key(o, d, `2027-03-${String(day).padStart(2, '0')}`, '2027-03-20');
const err = (o: string, d: string, day: number, lastError: string | null, over: Partial<CellOutcome> = {}) =>
  outcome(at(o, d, day), 'error', { ...cf, reason: 'parse', lastError, ...over });
const asked = (o: string, d: string, day: number) =>
  outcome(at(o, d, day), 'no_data', { ...cf, lastError: noFlightsDetail(NO_FLIGHTS_ASKED) });

describe('the no-flights marks', () => {
  it('are code then words', () => {
    expect([NO_FLIGHTS_UNSEEN, NO_FLIGHTS_ASKED, SALE_WINDOW_END]).toEqual([
      'no-flights-unseen',
      'no-flights-asked',
      'sale-window-end',
    ]);
    expect(noFlightsDetail(NO_FLIGHTS_ASKED)).toBe(`no-flights-asked ${NO_FLIGHTS_WORDS[NO_FLIGHTS_ASKED]}`);
  });
  it('a no_data outcome carries the asked or the sale-window-end mark, and nothing else counts', () => {
    expect(isNoFlightsNoData({ status: 'no_data', lastError: noFlightsDetail(NO_FLIGHTS_ASKED) })).toBe(true);
    expect(isNoFlightsNoData({ status: 'no_data', lastError: SALE_WINDOW_END })).toBe(true);
    expect(isNoFlightsNoData({ status: 'no_data', lastError: null })).toBe(false);
    expect(isNoFlightsNoData({ status: 'no_data', lastError: noFlightsDetail(NO_FLIGHTS_UNSEEN) })).toBe(
      false,
    );
    expect(isNoFlightsNoData({ status: 'error', lastError: NO_FLIGHTS_ASKED })).toBe(false);
  });
});

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

  it('marks a route every page of which said no flights, its query pairs marked no_data', () => {
    const out = [
      err('LGW', 'JFK', 1, unseen),
      err('LGW', 'JFK', 2, unseen),
      asked('LGW', 'JFK', 3),
      outcome(at('LGW', 'JFK', 6), 'no_data', { ...cf, lastError: noFlightsDetail(SALE_WINDOW_END) }),
      outcome(at('LGW', 'JFK', 4), 'skipped', { ...cf, reason: 'budget' }),
      outcome(at('LGW', 'JFK', 5), 'not_run', cf),
    ];
    expect(noFlightsRoutes(out)).toEqual([
      { origin: 'LGW', destination: 'JFK', providerId: 'camoufox', cells: 2, everyPage: true },
    ]);
  });

  it('is not every page when the route priced, said no fares, failed another way or has an unmarked no_data', () => {
    for (const other of [
      outcome(at('LHR', 'JFK', 9), 'priced', { ...cf, minPence: 30_000 }),
      outcome(at('LHR', 'JFK', 9), 'empty', cf),
      err('LHR', 'JFK', 9, 'view-unparsed the view failed its check'),
      err('LHR', 'JFK', 9, null),
      // why: a page that showed flights with unknown prices writes no_data with no mark (and a row stored before the
      // marks existed carries none either)
      outcome(at('LHR', 'JFK', 9), 'no_data', cf),
    ]) {
      expect(noFlightsRoutes([err('LHR', 'JFK', 1, unseen), other])).toEqual([
        { origin: 'LHR', destination: 'JFK', providerId: 'camoufox', cells: 1, everyPage: false },
      ]);
    }
  });

  it('a page that showed flights with unknown prices is not "no flights", whatever another page left unseen', () => {
    const out = [
      outcome(at('LHR', 'JFK', 1), 'no_data', cf),
      outcome(at('LHR', 'JFK', 2), 'no_data', cf),
      asked('LHR', 'JFK', 3),
      err('LHR', 'JFK', 4, unseen),
    ];
    expect(noFlightsRoutes(out)[0]?.everyPage).toBe(false);
  });

  it('another provider pricing the route, or saying no fares, or a verification price, is evidence of flights', () => {
    for (const other of [
      outcome(at('LHR', 'JFK', 9), 'priced', { providerId: 'travelpayouts', minPence: 30_000 }),
      outcome(at('LHR', 'JFK', 9), 'empty', { providerId: 'travelpayouts' }),
      outcome(at('LHR', 'JFK', 9), 'priced', { providerId: 'searchapi', minPence: 1, stage: 'verification' }),
    ]) {
      expect(noFlightsRoutes([err('LHR', 'JFK', 1, unseen), asked('LHR', 'JFK', 2), other])).toEqual([
        { origin: 'LHR', destination: 'JFK', providerId: 'camoufox', cells: 1, everyPage: false },
      ]);
    }
    // another origin's prices say nothing of this one
    expect(
      noFlightsRoutes([
        err('LGW', 'JFK', 1, unseen),
        outcome(at('LHR', 'JFK', 1), 'priced', { ...cf, minPence: 1 }),
      ]),
    ).toEqual([{ origin: 'LGW', destination: 'JFK', providerId: 'camoufox', cells: 1, everyPage: true }]);
  });

  it('keeps routes and providers apart, sorted by origin, destination and provider, and ignores verification', () => {
    const out = [
      err('LHR', 'JFK', 1, unseen),
      err('LGW', 'JFK', 1, unseen, { providerId: 'travelpayouts' }),
      err('LGW', 'JFK', 2, unseen),
      err('LGW', 'EWR', 1, unseen),
      outcome(at('LGW', 'EWR', 2), 'priced', { ...cf, minPence: 1 }),
      err('LHR', 'EWR', 1, unseen, { stage: 'verification' }),
      outcome(at('LHR', 'JFK', 2), 'not_run', { ...cf, stage: 'verification' }),
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
    const codes = ['LGW', 'LHR', 'QQA'];
    const route = (o: string) => [err(o, 'JFK', 1, unseen)];
    expect(noFlightsRoutes(codes.flatMap(route)).map((r) => r.origin)).toEqual(codes);
    expect(noFlightsRoutes([...codes].reverse().flatMap(route)).map((r) => r.origin)).toEqual(codes);
  });
});
