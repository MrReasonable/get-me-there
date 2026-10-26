import type { z } from 'zod';
import type { CoverageSummary, ExecutionSummary, priceCellSchema } from '../api-contract/common.js';
import type { DatePairsResponse } from '../api-contract/datePairs.js';
import type { Buckets } from '../types/execution.js';
import type { Iata, IsoDate } from '../types/ids.js';
import type { Provenance, ProviderId } from '../types/provenance.js';
import type { DatePairSpace } from './space.js';

/**
 * A date pair's figure as the web reads it (spec §10, §11): a full price cell with its complete provenance, its airport
 * pair, its basis and decision 54's marks. `airportPair` is the index in `sortedAirportPairs(scope.origins,
 * scope.destinations)`.
 */
export interface DatePairFigure {
  /** pricePence, provenance, stale, ageHours, truncated */
  price: z.output<typeof priceCellSchema>;
  basis: 'verified' | 'calendar';
  origin: Iata;
  destination: Iata;
  airportPair: number;
  /** decision 54, calendar figures only */
  superseded: boolean;
  /** decision 54, verified figures only */
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  journeyMinutes: number | null;
  departOut: string | null;
  arriveOut: string | null;
  departBack: string | null;
  arriveBack: string | null;
  /** revision 50: fetched by an execution created before the latest parent run */
  fromEarlierSearch: boolean;
  /** decision 38: a cheaper current calendar price a verified figure hides, with its own airport pair */
  cheaperCached: {
    pricePence: number;
    provenance: Provenance;
    stale: boolean;
    truncated: boolean;
    origin: Iata;
    destination: Iata;
  } | null;
}

/** One date pair of the space: its dates, its six buckets and counts over the airport pairs in scope, its figure. */
export interface DatePair {
  index: number;
  departureDate: IsoDate;
  returnDate: IsoDate;
  nights: number;
  /** the six over the airport pairs in scope, `reused` inside them (never a seventh) */
  buckets: Buckets;
  selected: number;
  itinerarySearched: number;
  notReached: number;
  onDemand: number;
  unconfirmed: number;
  partiallyVerified: number;
  journeyLeftOut: number;
  figure: DatePairFigure | null;
}

/** The date-pairs response as one record per date pair; the only form the web reads (spec §10). */
export interface DecodedDatePairs {
  executionId: string | null;
  executions: ExecutionSummary[];
  discoveryProviders: ProviderId[];
  verificationProviderConfigured: boolean;
  staleAfterHours: number;
  calendarStaleAfterHours: Partial<Record<ProviderId, number>>;
  space: DatePairSpace;
  scope: DatePairsResponse['scope'];
  summary: CoverageSummary;
  /** every date pair, index order */
  pairs: DatePair[];
}

/** A canonical string of a JSON-like value: every key at every depth, sorted. */
function canonical(v: unknown): string {
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  let out = '{';
  for (const k of Object.keys(v).sort()) out += `${JSON.stringify(k)}:${canonical(Reflect.get(v, k))},`;
  return `${out}}`;
}

/**
 * The provenance table's key (spec §10: each distinct provenance once): every field, nested `fx` included, keys
 * sorted, so two provenances differing in any one field are two entries and two equal ones (whatever their key
 * order) are one.
 */
export function provenanceKey(p: Provenance): string {
  return canonical(p);
}

/** A code's index in the scope's list; a figure on an airport outside the scope is a caller's bug. */
function indexOf(at: ReadonlyMap<string, number>, code: Iata): number {
  const i = at.get(code);
  if (i === undefined) throw new RangeError(`encodeDatePairs: ${code} is not in the scope`);
  return i;
}

/**
 * The route's body from the decoded form, in one pass over the date pairs: every column written as it goes, each
 * distinct provenance entered once in the table (keyed by `provenanceKey`). `decodeDatePairs` is its inverse.
 */
export function encodeDatePairs(d: DecodedDatePairs): DatePairsResponse {
  const originAt = new Map(d.scope.origins.map((c, i) => [c, i]));
  const destinationAt = new Map(d.scope.destinations.map((c, i) => [c, i]));
  const provenances: Provenance[] = [];
  const table = new Map<string, number>();
  const entry = (p: Provenance): number => {
    const key = provenanceKey(p);
    const known = table.get(key);
    if (known !== undefined) return known;
    table.set(key, provenances.length);
    return provenances.push(p) - 1;
  };
  const pairs: DatePairsResponse['pairs'] = {
    priced: [],
    empty: [],
    noData: [],
    error: [],
    skipped: [],
    notRun: [],
    reused: [],
    selected: [],
    itinerarySearched: [],
    onDemand: [],
    unconfirmed: [],
    partiallyVerified: [],
    notReached: [],
    journeyLeftOut: [],
  };
  const f: DatePairsResponse['figures'] = {
    pair: [],
    pricePence: [],
    provenance: [],
    stale: [],
    ageHours: [],
    truncated: [],
    basis: [],
    origin: [],
    destination: [],
    superseded: [],
    notSeenInLatestAgeHours: [],
    journeyMinutes: [],
    cheaperCachedPence: [],
    cheaperCachedProvenance: [],
    cheaperCachedOrigin: [],
    cheaperCachedDestination: [],
    cheaperCachedTruncated: [],
    cheaperCachedStale: [],
    departOut: [],
    arriveOut: [],
    departBack: [],
    arriveBack: [],
    fromEarlierSearch: [],
  };
  for (const p of d.pairs) {
    const b = p.buckets;
    pairs.priced.push(b.priced);
    pairs.empty.push(b.empty);
    pairs.noData.push(b.no_data);
    pairs.error.push(b.error);
    pairs.skipped.push(b.skipped);
    pairs.notRun.push(b.not_run);
    pairs.reused.push(b.reused);
    pairs.selected.push(p.selected);
    pairs.itinerarySearched.push(p.itinerarySearched);
    pairs.onDemand.push(p.onDemand);
    pairs.unconfirmed.push(p.unconfirmed);
    pairs.partiallyVerified.push(p.partiallyVerified);
    pairs.notReached.push(p.notReached);
    pairs.journeyLeftOut.push(p.journeyLeftOut);
    const x = p.figure;
    if (x === null) continue;
    f.pair.push(p.index);
    f.pricePence.push(x.price.pricePence);
    f.provenance.push(entry(x.price.provenance));
    f.stale.push(x.price.stale);
    f.ageHours.push(x.price.ageHours);
    f.truncated.push(x.price.truncated);
    f.basis.push(x.basis);
    f.origin.push(indexOf(originAt, x.origin));
    f.destination.push(indexOf(destinationAt, x.destination));
    f.superseded.push(x.superseded);
    f.notSeenInLatestAgeHours.push(x.notSeenInLatest === null ? null : x.notSeenInLatest.ageHours);
    f.journeyMinutes.push(x.journeyMinutes);
    f.departOut.push(x.departOut);
    f.arriveOut.push(x.arriveOut);
    f.departBack.push(x.departBack);
    f.arriveBack.push(x.arriveBack);
    f.fromEarlierSearch.push(x.fromEarlierSearch);
    const c = x.cheaperCached;
    if (c === null) {
      f.cheaperCachedPence.push(null);
      f.cheaperCachedProvenance.push(null);
      f.cheaperCachedOrigin.push(null);
      f.cheaperCachedDestination.push(null);
      f.cheaperCachedTruncated.push(null);
      f.cheaperCachedStale.push(null);
    } else {
      f.cheaperCachedPence.push(c.pricePence);
      f.cheaperCachedProvenance.push(entry(c.provenance));
      f.cheaperCachedOrigin.push(indexOf(originAt, c.origin));
      f.cheaperCachedDestination.push(indexOf(destinationAt, c.destination));
      f.cheaperCachedTruncated.push(c.truncated);
      f.cheaperCachedStale.push(c.stale);
    }
  }
  const { space, scope } = d;
  return {
    executionId: d.executionId,
    executions: d.executions,
    discoveryProviders: d.discoveryProviders,
    verificationProviderConfigured: d.verificationProviderConfigured,
    staleAfterHours: d.staleAfterHours,
    calendarStaleAfterHours: d.calendarStaleAfterHours,
    // why: copied field by field, so a caller passing a whole ResolvedSpace never puts its airports on the wire
    space: {
      departureFrom: space.departureFrom,
      departureTo: space.departureTo,
      minNights: space.minNights,
      maxNights: space.maxNights,
    },
    scope: {
      origins: scope.origins,
      destinations: scope.destinations,
      airportPairs: scope.airportPairs,
      cells: scope.cells,
      maxJourneyMinutes: scope.maxJourneyMinutes,
    },
    summary: d.summary,
    provenances,
    pairs,
    figures: f,
  };
}
