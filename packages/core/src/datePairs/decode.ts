import type { DatePairsResponse } from '../api-contract/datePairs.js';
import { addDays } from '../dates/epochDay.js';
import type { IsoDate } from '../types/ids.js';
import type { DatePair, DatePairFigure, DecodedDatePairs } from './encode.js';
import { stayCount } from './space.js';

/**
 * Entry `i` of a column. Throws `RangeError` past its end: a body that passed `datePairsResponseSchema` never does, so
 * this is the decoder refusing a body that did not.
 */
export function columnAt<T>(column: readonly T[], i: number): T {
  const x = column[i];
  if (x === undefined) throw new RangeError(`no entry ${i} in a column of ${column.length}`);
  return x;
}

/** A value the contract makes non-null beside a non-null cheaper-cached price. */
function present<T>(x: T | null, what: string): T {
  if (x === null) throw new RangeError(`decodeDatePairs: ${what} is null beside a cheaper cached price`);
  return x;
}

/** The figure in column position `j`, with its full provenance and its airport pair. */
function figureAt(r: DatePairsResponse, j: number): DatePairFigure {
  const f = r.figures;
  const { origins, destinations } = r.scope;
  const o = columnAt(f.origin, j);
  const d = columnAt(f.destination, j);
  const notSeen = columnAt(f.notSeenInLatestAgeHours, j);
  const cheaper = columnAt(f.cheaperCachedPence, j);
  return {
    price: {
      pricePence: columnAt(f.pricePence, j),
      provenance: columnAt(r.provenances, columnAt(f.provenance, j)),
      stale: columnAt(f.stale, j),
      ageHours: columnAt(f.ageHours, j),
      truncated: columnAt(f.truncated, j),
    },
    basis: columnAt(f.basis, j),
    origin: columnAt(origins, o),
    destination: columnAt(destinations, d),
    // why: the index in sortedAirportPairs(origins, destinations), whose origins and destinations are already sorted
    airportPair: o * destinations.length + d,
    superseded: columnAt(f.superseded, j),
    notSeenInLatest: notSeen === null ? null : { ageHours: notSeen },
    journeyMinutes: columnAt(f.journeyMinutes, j),
    departOut: columnAt(f.departOut, j),
    arriveOut: columnAt(f.arriveOut, j),
    departBack: columnAt(f.departBack, j),
    arriveBack: columnAt(f.arriveBack, j),
    fromEarlierSearch: columnAt(f.fromEarlierSearch, j),
    cheaperCached:
      cheaper === null
        ? null
        : {
            pricePence: cheaper,
            provenance: columnAt(
              r.provenances,
              present(columnAt(f.cheaperCachedProvenance, j), 'its provenance'),
            ),
            stale: present(columnAt(f.cheaperCachedStale, j), 'its staleness'),
            truncated: present(columnAt(f.cheaperCachedTruncated, j), 'its truncation'),
            origin: columnAt(origins, present(columnAt(f.cheaperCachedOrigin, j), 'its origin')),
            destination: columnAt(
              destinations,
              present(columnAt(f.cheaperCachedDestination, j), 'its destination'),
            ),
          },
  };
}

/**
 * One record per date pair from the route's columns (spec §10): `pairs` walked once, `figures` once, every figure and
 * cheaper-cached price given its full provenance from the table. Pure; no clock. Dates come from the index, each
 * distinct date computed once.
 */
export function decodeDatePairs(r: DatePairsResponse): DecodedDatePairs {
  const { space } = r;
  const c = r.pairs;
  const stays = stayCount(space);
  const dates: IsoDate[] = [];
  const dateAt = (offset: number): IsoDate => (dates[offset] ??= addDays(space.departureFrom, offset));
  const pairs: DatePair[] = [];
  for (let i = 0; i < c.priced.length; i += 1) {
    const dayIndex = Math.floor(i / stays);
    const nights = space.minNights + (i % stays);
    pairs.push({
      index: i,
      departureDate: dateAt(dayIndex),
      returnDate: dateAt(dayIndex + nights),
      nights,
      buckets: {
        priced: columnAt(c.priced, i),
        empty: columnAt(c.empty, i),
        no_data: columnAt(c.noData, i),
        error: columnAt(c.error, i),
        skipped: columnAt(c.skipped, i),
        not_run: columnAt(c.notRun, i),
        reused: columnAt(c.reused, i),
      },
      selected: columnAt(c.selected, i),
      itinerarySearched: columnAt(c.itinerarySearched, i),
      notReached: columnAt(c.notReached, i),
      onDemand: columnAt(c.onDemand, i),
      unconfirmed: columnAt(c.unconfirmed, i),
      partiallyVerified: columnAt(c.partiallyVerified, i),
      journeyLeftOut: columnAt(c.journeyLeftOut, i),
      figure: null,
    });
  }
  for (let j = 0; j < r.figures.pair.length; j += 1)
    columnAt(pairs, columnAt(r.figures.pair, j)).figure = figureAt(r, j);
  return {
    executionId: r.executionId,
    executions: r.executions,
    discoveryProviders: r.discoveryProviders,
    verificationProviderConfigured: r.verificationProviderConfigured,
    staleAfterHours: r.staleAfterHours,
    calendarStaleAfterHours: r.calendarStaleAfterHours,
    space: {
      departureFrom: space.departureFrom,
      departureTo: space.departureTo,
      minNights: space.minNights,
      maxNights: space.maxNights,
    },
    scope: r.scope,
    summary: r.summary,
    pairs,
  };
}
