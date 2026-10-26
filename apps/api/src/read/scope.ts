/**
 * The scope of a read (spec §10 date-pairs and `/results` scope parameters; WP19 Task 19.2) and the one per-cell
 * classification behind every coverage summary the api sends (spec §6.6, revision 50).
 */
import {
  apiContract,
  type Cell,
  type CellOutcomeStatus,
  cellKeyString,
  datePairIndex,
  daysBetween,
  type Execution,
  generateCells,
  type Iata,
  type IsoDate,
  isoDateSchema,
  type ResolvedSpace,
  type RollUp,
  type SearchDefinition,
} from '@gmt/core';
import type { CellsRepo } from '@gmt/db';
import { ApiError, fieldsDetail } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { type CoverageSummary, SEARCHED, zeroBuckets } from './coverage.js';

/** The scope parameters as they arrive (Hono's `c.req.query()`: strings, absent when not sent). */
export interface ScopeQuery {
  origins?: string | undefined;
  destinations?: string | undefined;
  maxJourneyMinutes?: string | undefined;
  departureDate?: string | undefined;
  returnDate?: string | undefined;
}

/** What a read applies: the space narrowed to the scope's airports (and date pair), and the journey limit. */
export interface ParsedScope {
  /** airports narrowed, sorted, unique; a date-pair read's space is that one departure and that one stay */
  space: ResolvedSpace;
  maxJourneyMinutes: number | null;
  datePair: { departureDate: IsoDate; returnDate: IsoDate } | null;
}

const fail = (code: string, field: string, message: string): never => {
  throw new ApiError(422, code, message, fieldsDetail([{ field, message }]));
};

/** Ascending order by UTF-16 code units, as `generateCells` sorts airports. */
const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A comma list of airports narrowed to the definition's (plan decision 53): each code must be one of the definition's
 * (else 422 `unknown_airport`), the result sorted and unique; empty or absent is every airport of the space.
 */
function airports(
  raw: string | undefined,
  own: readonly Iata[],
  all: readonly Iata[],
  field: string,
): Iata[] {
  const wanted = (raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  if (wanted.length === 0) return [...new Set(all)].sort(ascending);
  const out = new Set<Iata>();
  for (const code of wanted) {
    const match = own.find((c) => c === code);
    if (match === undefined) return fail('unknown_airport', field, API_TEXT.unknownScopeAirport(code));
    out.add(match);
  }
  return [...out].sort(ascending);
}

/**
 * Spec §10: one parser for both routes' scope parameters, so a filter means the same on the board and in the date pair
 * detail. Airports narrow the space (decision 53); the journey limit is an integer of minutes from 60 to 6000 (422
 * `invalid_journey_limit`); the date pair is both dates or neither (422 `date_pair_incomplete`), each a calendar date
 * (422 `invalid_date_pair`), inside the current space (422 `date_pair_outside_space`), and narrows the space to that one
 * departure and stay. Absent parameters leave the space whole.
 */
export function parseScope(def: SearchDefinition, q: ScopeQuery, space: ResolvedSpace): ParsedScope {
  const origins = airports(q.origins, def.origins, space.origins, 'origins');
  const destinations = airports(q.destinations, def.destinations, space.destinations, 'destinations');
  let maxJourneyMinutes: number | null = null;
  if (q.maxJourneyMinutes !== undefined) {
    const { MIN_JOURNEY_LIMIT_MINUTES: min, MAX_JOURNEY_LIMIT_MINUTES: max } = apiContract;
    const n = /^\d+$/.test(q.maxJourneyMinutes) ? Number(q.maxJourneyMinutes) : Number.NaN;
    if (!(n >= min && n <= max))
      fail('invalid_journey_limit', 'maxJourneyMinutes', API_TEXT.invalidJourneyLimit(min, max));
    maxJourneyMinutes = n;
  }
  const narrowed: ResolvedSpace = { ...space, origins, destinations };
  if (q.departureDate === undefined && q.returnDate === undefined)
    return { space: narrowed, maxJourneyMinutes, datePair: null };
  if (q.departureDate === undefined || q.returnDate === undefined)
    return fail(
      'date_pair_incomplete',
      q.departureDate === undefined ? 'departureDate' : 'returnDate',
      API_TEXT.datePairIncomplete,
    );
  const dep = isoDateSchema.safeParse(q.departureDate);
  const ret = isoDateSchema.safeParse(q.returnDate);
  if (!dep.success) return fail('invalid_date_pair', 'departureDate', API_TEXT.invalidDatePair);
  if (!ret.success) return fail('invalid_date_pair', 'returnDate', API_TEXT.invalidDatePair);
  if (datePairIndex(space, dep.data, ret.data) === null)
    return fail('date_pair_outside_space', 'departureDate', API_TEXT.datePairOutsideSpace);
  const nights = daysBetween(dep.data, ret.data);
  return {
    space: {
      ...narrowed,
      departureFrom: dep.data,
      departureTo: dep.data,
      minNights: nights,
      maxNights: nights,
    },
    maxJourneyMinutes,
    datePair: { departureDate: dep.data, returnDate: ret.data },
  };
}

/** One cell of the scope as every coverage count sees it (spec §6.6, §10). */
export interface CellClass {
  cell: Cell;
  bucket: 'priced' | 'empty' | 'no_data' | 'error' | 'skipped' | 'not_run';
  reused: boolean;
  selected: boolean;
  itinerarySearched: boolean;
  notReached: boolean;
  onDemand: boolean;
  unconfirmed: boolean;
  partiallyVerified: boolean;
}

/** What the classification needs of the parent run, each read once per request in one statement. */
export interface ParentFacts {
  rollUps: Map<string, { discovery: RollUp; verification: RollUp }>;
  /** the parent's reused discovery outcomes, by cell key */
  reusedCells: ReadonlySet<string>;
  /** the parent's selected cells, by cell key */
  selected: ReadonlySet<string>;
}

/** The parent run's facts in three statements (its roll-ups, its reused cells, its selection); null before any run. */
export function parentFacts(ports: Ports, parent: Execution | null): ParentFacts | null {
  if (parent === null) return null;
  const cells = ports.repos.cells;
  return {
    rollUps: cells.rollUps(parent.id),
    reusedCells: cells.reusedCells(parent.id),
    selected: new Set(cells.selected(parent.id).map(({ cell }) => cellKeyString(cell))),
  };
}

const searched = (s: CellOutcomeStatus | null): boolean => s !== null && SEARCHED.has(s);

/**
 * Spec §6.6 (revision 50): one class per cell of `space` (already narrowed to the scope), in generation order. A cell's
 * bucket is the parent run's discovery roll-up status when it has one, else `not_run`: a day a relative window rolled
 * in, a widened nights range, an added airport, a roll-up with verification outcomes only, a search with no discovery
 * source or no parent run at all is not searched, so a date pair's six buckets always sum to its airport pairs.
 * Selected, itinerary-searched (selected and its verification roll-up priced, empty or no_data), not reached (selected
 * and its verification roll-up `not_run` or `skipped:budget`) and unconfirmed (itinerary-searched, priced, with no
 * confirmed price: decisions 45, 48, 51) come from the parent; on demand from the completed children whose own roll-up
 * searched the cell (ssr-002); partially verified from the rows read. No read happens here.
 */
export function classifyCells(
  space: ResolvedSpace,
  parent: ParentFacts | null,
  children: ReturnType<CellsRepo['childVerificationRollUps']>,
  offers: { partiallyVerified: ReadonlySet<string> },
): CellClass[] {
  const onDemand = new Set(children.filter((c) => searched(c.status)).map((c) => cellKeyString(c.cell)));
  return generateCells(space).map((cell) => {
    const key = cellKeyString(cell);
    const r = parent?.rollUps.get(key);
    const selected = parent?.selected.has(key) ?? false;
    const v = r?.verification;
    const itinerarySearched = selected && searched(v?.status ?? null);
    return {
      cell,
      bucket: r?.discovery.status ?? 'not_run',
      reused: parent?.reusedCells.has(key) ?? false,
      selected,
      itinerarySearched,
      notReached: selected && (v?.status === 'not_run' || (v?.status === 'skipped' && v.reason === 'budget')),
      onDemand: onDemand.has(key),
      unconfirmed: itinerarySearched && v?.status === 'priced' && v.minPence === null,
      partiallyVerified: offers.partiallyVerified.has(key),
    };
  });
}

/**
 * The only way the api builds a CoverageSummary (spec §6.6, §10): the six buckets with `reused` inside them, the total
 * (every cell classified), and the selection, itinerary-search and on-demand counts, each of distinct cells.
 */
export function summariseCells(classes: readonly CellClass[]): CoverageSummary {
  const buckets = zeroBuckets();
  let selected = 0;
  let itinerarySearched = 0;
  let onDemand = 0;
  for (const c of classes) {
    buckets[c.bucket] += 1;
    if (c.reused) buckets.reused += 1;
    if (c.selected) selected += 1;
    if (c.itinerarySearched) itinerarySearched += 1;
    if (c.onDemand) onDemand += 1;
  }
  return { buckets, total: classes.length, selected, itinerarySearched, onDemand, reused: buckets.reused };
}
