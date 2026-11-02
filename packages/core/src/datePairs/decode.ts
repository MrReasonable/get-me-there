import type { DatePairsResponse } from '../api-contract/datePairs.js';
import { addDays } from '../dates/epochDay.js';
import type { IsoDate } from '../types/ids.js';
import type { DatePair, DatePairFigure, DecodedDatePairs } from './encode.js';
import { PAIRING_READ } from './pairing.js';
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

/**
 * The figure in column position `j`, with its full provenance and its airport pair, read `not-read` until the
 * `pairingRead` group says otherwise; no cheaper price, times, grid price or pairing yet.
 */
function figureAt(r: DatePairsResponse, j: number): DatePairFigure {
  const f = r.figures;
  const { origins, destinations } = r.scope;
  const o = columnAt(f.origin, j);
  const d = columnAt(f.destination, j);
  const notSeen = columnAt(f.notSeenInLatestAgeHours, j);
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
    departOut: null,
    arriveOut: null,
    departBack: null,
    arriveBack: null,
    fromEarlierSearch: columnAt(f.fromEarlierSearch, j),
    cheaperCached: null,
    gridPrice: null,
    pairing: null,
    pairingRead: 'not-read',
    listReason: null,
  };
}

/**
 * One record per date pair from the route's columns (spec §10): `pairs` walked once, `figures` once and each sparse
 * group once, every figure, cheaper-cached price, grid price and pairing given its full provenance from the table. Pure; no clock. Dates come from the index, each
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
  const figures: DatePairFigure[] = [];
  for (let j = 0; j < r.figures.pair.length; j += 1) {
    const figure = figureAt(r, j);
    figures.push(figure);
    columnAt(pairs, columnAt(r.figures.pair, j)).figure = figure;
  }
  // why: the sparse groups name a figure by its position in the figures columns (revision 50)
  const cheaper = r.cheaperCached;
  for (let k = 0; k < cheaper.figure.length; k += 1)
    columnAt(figures, columnAt(cheaper.figure, k)).cheaperCached = {
      pricePence: columnAt(cheaper.pricePence, k),
      provenance: columnAt(r.provenances, columnAt(cheaper.provenance, k)),
      stale: columnAt(cheaper.stale, k),
      truncated: columnAt(cheaper.truncated, k),
      origin: columnAt(r.scope.origins, columnAt(cheaper.origin, k)),
      destination: columnAt(r.scope.destinations, columnAt(cheaper.destination, k)),
    };
  const t = r.times;
  for (let k = 0; k < t.figure.length; k += 1) {
    const figure = columnAt(figures, columnAt(t.figure, k));
    figure.departOut = columnAt(t.departOut, k);
    figure.arriveOut = columnAt(t.arriveOut, k);
    figure.departBack = columnAt(t.departBack, k);
    figure.arriveBack = columnAt(t.arriveBack, k);
  }
  // why: spec rev 56 §10: a body without the two groups (an api before them) decodes with no grid price and no pairing
  const g = r.gridPrice;
  if (g !== undefined)
    for (let k = 0; k < g.figure.length; k += 1)
      columnAt(figures, columnAt(g.figure, k)).gridPrice = {
        pricePence: columnAt(g.pricePence, k),
        provenance: columnAt(r.provenances, columnAt(g.provenance, k)),
        stale: columnAt(g.stale, k),
        truncated: columnAt(g.truncated, k),
      };
  // why: R-sparse: a figure with no entry reads not-read (as in a body without the group)
  const reads = r.pairingRead;
  if (reads !== undefined)
    for (let k = 0; k < reads.figure.length; k += 1)
      columnAt(figures, columnAt(reads.figure, k)).pairingRead = columnAt(
        PAIRING_READ,
        columnAt(reads.code, k),
      );
  // why: the 21.6 ruling: a failed list's cause, beside its `list-failed` read
  const why = r.listReason;
  if (why !== undefined)
    for (let k = 0; k < why.figure.length; k += 1)
      columnAt(figures, columnAt(why.figure, k)).listReason = columnAt(why.reason, k);
  const q = r.pairing;
  if (q !== undefined)
    for (let k = 0; k < q.figure.length; k += 1)
      columnAt(figures, columnAt(q.figure, k)).pairing = {
        pricePence: columnAt(q.pricePence, k),
        fromPence: columnAt(q.fromPence, k),
        isFrom: columnAt(q.isFrom, k),
        seller: columnAt(q.seller, k),
        fare: columnAt(q.fare, k),
        offersRead: columnAt(q.offersRead, k),
        complete: columnAt(q.complete, k),
        which: columnAt(q.which, k),
        departOut: columnAt(q.departOut, k),
        arriveOut: columnAt(q.arriveOut, k),
        departBack: columnAt(q.departBack, k),
        arriveBack: columnAt(q.arriveBack, k),
        mismatch: columnAt(q.mismatch, k),
        provenance: columnAt(r.provenances, columnAt(q.provenance, k)),
        stale: columnAt(q.stale, k),
        ageHours: columnAt(q.ageHours, k),
      };
  return {
    executionId: r.executionId,
    executions: r.executions,
    discoveryProviders: r.discoveryProviders,
    verificationProviderConfigured: r.verificationProviderConfigured,
    staleAfterHours: r.staleAfterHours,
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
