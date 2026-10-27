// WP19 Task 19.2: the date-pairs route's test helpers: the read decoded through core's decoder, a worked-example world
// over the four airport pairs, and the scope's 422 table both the date-pairs and the `/results` scope tests run.
import {
  apiContract,
  type CellKey,
  type DecodedDatePairs,
  decodeDatePairs,
  type SearchDefinition,
  TRUNCATED_NOTE,
} from '@gmt/core';
import { expectContract } from './contract.js';
import type { Harness } from './harness.js';
import { at, cell, type Seeder, seeder } from './seed.js';

export const DATE_PAIRS = '/api/definitions/:id/date-pairs';
export const RESULTS = '/api/definitions/:id/results';

/** The date-pairs route's body for `defId`, checked against the contract and decoded (the only form the web reads). */
export async function datesOf(x: Harness, defId: string, query = ''): Promise<DecodedDatePairs> {
  const res = await x.request(`/api/definitions/${defId}/date-pairs${query}`);
  return decodeDatePairs(await expectContract(res, 'GET', DATE_PAIRS, apiContract.datePairsResponseSchema));
}

/** `/results` for `defId`, checked against the contract. */
export async function resultsOf(x: Harness, defId: string, query = '') {
  const res = await x.request(`/api/definitions/${defId}/results${query}`);
  return expectContract(res, 'GET', RESULTS, apiContract.resultsResponseSchema);
}

/** The date pair of `d` departing `dep` and returning `ret`; throws when the space has none. */
export function pairOf(d: DecodedDatePairs, dep: string, ret: string) {
  const p = d.pairs.find((x) => x.departureDate === dep && x.returnDate === ret);
  if (p === undefined) throw new Error(`no date pair ${dep}–${ret}`);
  return p;
}

/** The worked example's cells of the world below, by date pair (all in SMALL_WINDOW, 10–21 nights). */
export const W = {
  // 2 Nov, 10 nights: a fresh verified LHR→JFK figure hiding a cheaper LGW→EWR calendar price
  J1: cell('LHR', 'JFK', '2026-11-02', '2026-11-12'),
  W1: cell('LGW', 'EWR', '2026-11-02', '2026-11-12'),
  K1: cell('LHR', 'EWR', '2026-11-02', '2026-11-12'),
  G1: cell('LGW', 'JFK', '2026-11-02', '2026-11-12'),
  // 2 Nov, 11 nights: priced only on LGW→EWR (the §16 test)
  W2: cell('LGW', 'EWR', '2026-11-02', '2026-11-13'),
  // 3 Nov, 10 nights: LHR→JFK superseded by the latest run's "no fares"; LHR→EWR from the earlier run only
  J3: cell('LHR', 'JFK', '2026-11-03', '2026-11-13'),
  K3: cell('LHR', 'EWR', '2026-11-03', '2026-11-13'),
  // 3 Nov, 11 nights: a verified price the latest itinerary search did not return
  J4: cell('LHR', 'JFK', '2026-11-03', '2026-11-14'),
  // 4 Nov, 10 nights: a truncated tile's calendar price
  J5: cell('LHR', 'JFK', '2026-11-04', '2026-11-14'),
  // 4 Nov, 11 nights: an overnight return of 600 minutes, and a cheaper one of 601 on another airport pair
  J7: cell('LHR', 'JFK', '2026-11-04', '2026-11-15'),
  G7: cell('LGW', 'JFK', '2026-11-04', '2026-11-15'),
  // 5 Nov, 10 nights: an on-demand search after the latest run
  J6: cell('LHR', 'JFK', '2026-11-05', '2026-11-15'),
  // 5 Nov, 11 nights: a verified price of 1000 minutes only
  J8: cell('LHR', 'JFK', '2026-11-05', '2026-11-16'),
} as const;

/**
 * The world, seeded into `def` through the repositories, keeping only the cells `keep` admits (so a definition holding
 * fewer airports gets exactly the same cells: decision 53's honesty test). Runs: E1 (30 h ago), E2 (the latest, 3 h
 * ago), then the on-demand child C1. Returns the seeder.
 */
export function seedDatesWorld(x: Harness, def: SearchDefinition, keep: (c: CellKey) => boolean): Seeder {
  const s = seeder(x.ports);
  const only = (cs: CellKey[]) => cs.filter(keep);
  const top = (cs: CellKey[]) => only(cs).map((c) => ({ cell: c, reason: 'top_n' as const }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
  s.cells('E1', only([W.J3, W.K3, W.J4]), { selected: top([W.J4]) });
  if (keep(W.J3))
    s.tile('E1', W.J3, { status: 'priced', pricePence: 28_000, fetchedAt: at(-29), tileIndex: 0 });
  if (keep(W.K3))
    s.tile('E1', W.K3, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
  if (keep(W.J4)) s.verified('E1', W.J4, [{ hash: 'hOld', pricePence: 55_000, fetchedAt: at(-29) }]);

  s.execution('E2', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
  const e2 = [W.J1, W.W1, W.K1, W.G1, W.W2, W.J3, W.J4, W.J5, W.J7, W.G7, W.J8];
  s.cells('E2', only(e2), { selected: top([W.J1, W.J4, W.J7, W.G7, W.J8]) });
  const tile = (c: CellKey, t: Parameters<Seeder['tile']>[2]) => {
    if (keep(c)) s.tile('E2', c, t);
  };
  tile(W.J1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-2), tileIndex: 0 });
  tile(W.W1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-2), tileIndex: 1 });
  tile(W.K1, { status: 'no_data', fetchedAt: at(-2), tileIndex: 2 });
  if (keep(W.G1)) s.tileError('E2', [W.G1], 'upstream', 'HTTP 503');
  tile(W.W2, { status: 'priced', pricePence: 31_000, fetchedAt: at(-2), tileIndex: 3 });
  tile(W.J3, { status: 'empty', fetchedAt: at(-2), tileIndex: 4 });
  tile(W.J5, {
    status: 'priced',
    pricePence: 40_000,
    fetchedAt: at(-2),
    tileIndex: 5,
    lastError: TRUNCATED_NOTE,
  });
  if (keep(W.J1)) s.verified('E2', W.J1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-2) }]);
  // why: the latest itinerary search of J4 found no fares, so E1's hOld is "not seen in latest search"
  if (keep(W.J4)) emptyVerification(x, s.id('E2'), W.J4);
  if (keep(W.J7))
    s.verified('E2', W.J7, [
      {
        hash: 'hNight',
        pricePence: 52_000,
        fetchedAt: at(-2),
        minutes: { outbound: 300, inbound: 300 },
        inboundTimes: { departLocal: '2026-11-15T22:10', arriveLocal: '2026-11-16T06:40' },
      },
    ]);
  if (keep(W.G7))
    s.verified('E2', W.G7, [
      { hash: 'hLong', pricePence: 48_000, fetchedAt: at(-2), minutes: { outbound: 301, inbound: 300 } },
    ]);
  if (keep(W.J8))
    s.verified('E2', W.J8, [
      { hash: 'hSlow', pricePence: 47_000, fetchedAt: at(-2), minutes: { outbound: 500, inbound: 500 } },
    ]);

  if (keep(W.J6)) {
    s.execution('C1', { def, status: 'completed', startedAt: at(-1), finishedAt: at(-1), child: W.J6 });
    s.cells('C1', [W.J6], { selected: [{ cell: W.J6, reason: 'always_include' }] });
    s.verified('C1', W.J6, [{ hash: 'hChild', pricePence: 70_000, fetchedAt: at(-1) }]);
  }
  return s;
}

/** A verification outcome that found no fares for `c` in `executionId` (spec §7 atomic unit, no itineraries). */
export function emptyVerification(x: Harness, executionId: string, c: CellKey): void {
  x.ports.repos.cells.writeVerifiedCell(executionId, 'fixture', {
    cell: c,
    itineraries: [],
    outcome: {
      ...c,
      status: 'empty',
      reason: null,
      lastError: null,
      fetchedAt: at(-2),
      minPence: null,
      cabin: 'economy',
      pointOfSale: 'GB',
      sourceKind: 'synthetic',
    },
  });
}

/**
 * The scope parameters' refusals, shared by the date-pairs and `/results` scope tests (spec §10): each a query and the
 * 422 code it answers, for a definition of LHR → JFK, EWR over SMALL_WINDOW.
 */
export const SCOPE_422: ReadonlyArray<{ name: string; query: string; code: string }> = [
  { name: 'an origin outside the definition', query: 'origins=LGW', code: 'unknown_airport' },
  { name: 'a destination outside the definition', query: 'destinations=JFK,ZZZ', code: 'unknown_airport' },
  {
    name: 'a journey limit that is not a number',
    query: 'maxJourneyMinutes=abc',
    code: 'invalid_journey_limit',
  },
  { name: 'a journey limit below 60', query: 'maxJourneyMinutes=59', code: 'invalid_journey_limit' },
  { name: 'a journey limit above 6000', query: 'maxJourneyMinutes=6001', code: 'invalid_journey_limit' },
  {
    name: 'a journey limit that is not an integer',
    query: 'maxJourneyMinutes=600.5',
    code: 'invalid_journey_limit',
  },
];
