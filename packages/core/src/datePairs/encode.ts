import type { z } from 'zod';
import type { CoverageSummary, ExecutionSummary, priceCellSchema } from '../api-contract/common.js';
import type { DatePairsResponse } from '../api-contract/datePairs.js';
import type { StaleMark } from '../labels/age.js';
import type { Buckets } from '../types/execution.js';
import type { Iata, IsoDate } from '../types/ids.js';
import type { Provenance, ProviderId } from '../types/provenance.js';
import type { GridPrice } from './figure.js';
import { type FigureBasis, PAIRING_READ, type PairingRead } from './pairing.js';
import type { DatePairSpace } from './space.js';

/**
 * A pairing as the board shows it (spec rev 56 §10's `pairing` group, its provenance in full): the cheapest offer's
 * stated price, or the return's "from" price when `isFrom` (then no seller and no fare); the offers read and whether
 * they are complete; which outbound the pairing used; the two legs' local times (`HH:MM`); whether the cheapest offer
 * differs from the "from" price; and the flight list's provenance, stale mark and age. A pairing figure's own words, and
 * the pairing shown beneath a calendar figure (within-older, within-other-limits, over-limit, sellers-not-read,
 * offers-incomplete).
 */
export interface DatePairPairing {
  pricePence: number;
  isFrom: boolean;
  seller: string | null;
  fare: string | null;
  offersRead: number;
  complete: boolean;
  which: 'cheapest' | 'next-cheapest' | 'over-limit';
  departOut: string;
  arriveOut: string;
  departBack: string;
  arriveBack: string;
  mismatch: boolean;
  provenance: Provenance;
  stale: StaleMark;
  ageHours: number | 'unknown';
}

/**
 * A date pair's figure as the web reads it (spec §10, §11): a full price cell with its complete provenance, its airport
 * pair, its basis and decision 54's marks. `airportPair` is the index in `sortedAirportPairs(scope.origins,
 * scope.destinations)`.
 */
export interface DatePairFigure {
  /** pricePence, provenance, stale, ageHours, truncated */
  price: z.output<typeof priceCellSchema>;
  /** spec rev 56 §6.9: a pairing figure's price is its cheapest offer's, its provenance the flight list's */
  basis: FigureBasis;
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
    stale: StaleMark;
    truncated: boolean;
    origin: Iata;
    destination: Iata;
  } | null;
  /**
   * Spec rev 56 §6.9: the calendar price a pairing figure replaced, shown beneath it; null on every other basis. Optional
   * until Task 21.7 (R-order); the decoder always fills it.
   */
  gridPrice?: GridPrice | null;
  /** Spec rev 56 §6.9: a pairing figure's own words, or the pairing beneath a calendar figure; else null (decoder fills). */
  pairing?: DatePairPairing | null;
  /** Spec rev 56 §6.9: the cell's flight read; `within` exactly on a pairing figure; absent reads as `not-read`. */
  pairingRead?: PairingRead;
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
 * distinct provenance entered once in the table (keyed by `provenanceKey`), and a figure's cheaper-cached price, local
 * times, grid price, pairing and `pairingRead` in their sparse groups, keyed by the figure's position (spec rev
 * 56 §10; ruling R-sparse: an entry only for a read other than `not-read`, an absent one written `not-read`).
 * `decodeDatePairs` is its inverse.
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
    fromEarlierSearch: [],
  };
  const pairingRead: NonNullable<DatePairsResponse['pairingRead']> = { figure: [], code: [] };
  const grid: NonNullable<DatePairsResponse['gridPrice']> = {
    figure: [],
    pricePence: [],
    provenance: [],
    stale: [],
    truncated: [],
  };
  const pairing: NonNullable<DatePairsResponse['pairing']> = {
    figure: [],
    pricePence: [],
    isFrom: [],
    seller: [],
    fare: [],
    offersRead: [],
    complete: [],
    which: [],
    departOut: [],
    arriveOut: [],
    departBack: [],
    arriveBack: [],
    mismatch: [],
    provenance: [],
    stale: [],
    ageHours: [],
  };
  const cheaper: DatePairsResponse['cheaperCached'] = {
    figure: [],
    pricePence: [],
    provenance: [],
    origin: [],
    destination: [],
    truncated: [],
    stale: [],
  };
  const times: DatePairsResponse['times'] = {
    figure: [],
    departOut: [],
    arriveOut: [],
    departBack: [],
    arriveBack: [],
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
    // why: the sparse groups name a figure by its position in the figures columns (revision 50)
    const figure = f.pair.push(p.index) - 1;
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
    f.fromEarlierSearch.push(x.fromEarlierSearch);
    // why: R-sparse: an entry only for a read other than not-read, its code the read's index in PAIRING_READ
    const read: PairingRead = x.pairingRead ?? 'not-read';
    if (read !== 'not-read') {
      pairingRead.figure.push(figure);
      pairingRead.code.push(PAIRING_READ.indexOf(read));
    }
    const c = x.cheaperCached;
    if (c !== null) {
      cheaper.figure.push(figure);
      cheaper.pricePence.push(c.pricePence);
      cheaper.provenance.push(entry(c.provenance));
      cheaper.origin.push(indexOf(originAt, c.origin));
      cheaper.destination.push(indexOf(destinationAt, c.destination));
      cheaper.truncated.push(c.truncated);
      cheaper.stale.push(c.stale);
    }
    if (x.departOut !== null || x.arriveOut !== null || x.departBack !== null || x.arriveBack !== null) {
      times.figure.push(figure);
      times.departOut.push(x.departOut);
      times.arriveOut.push(x.arriveOut);
      times.departBack.push(x.departBack);
      times.arriveBack.push(x.arriveBack);
    }
    const g = x.gridPrice ?? null;
    if (g !== null) {
      grid.figure.push(figure);
      grid.pricePence.push(g.pricePence);
      grid.provenance.push(entry(g.provenance));
      grid.stale.push(g.stale);
      grid.truncated.push(g.truncated);
    }
    const q = x.pairing ?? null;
    if (q !== null) {
      pairing.figure.push(figure);
      pairing.pricePence.push(q.pricePence);
      pairing.isFrom.push(q.isFrom);
      pairing.seller.push(q.seller);
      pairing.fare.push(q.fare);
      pairing.offersRead.push(q.offersRead);
      pairing.complete.push(q.complete);
      pairing.which.push(q.which);
      pairing.departOut.push(q.departOut);
      pairing.arriveOut.push(q.arriveOut);
      pairing.departBack.push(q.departBack);
      pairing.arriveBack.push(q.arriveBack);
      pairing.mismatch.push(q.mismatch);
      pairing.provenance.push(entry(q.provenance));
      pairing.stale.push(q.stale);
      pairing.ageHours.push(q.ageHours);
    }
  }
  const { space, scope } = d;
  return {
    executionId: d.executionId,
    executions: d.executions,
    discoveryProviders: d.discoveryProviders,
    verificationProviderConfigured: d.verificationProviderConfigured,
    staleAfterHours: d.staleAfterHours,
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
    cheaperCached: cheaper,
    times,
    gridPrice: grid,
    pairing,
    pairingRead,
  };
}
