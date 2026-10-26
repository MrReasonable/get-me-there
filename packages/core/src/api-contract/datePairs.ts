import { z } from 'zod';
import { columnAt } from '../datePairs/decode.js';
import { stayCount } from '../datePairs/space.js';
import { windowDays } from '../space/generate.js';
import { DEFAULT_MAX_CELLS, MAX_DATE_PAIRS } from '../space/limits.js';
import { iataSchema, isoDateSchema } from '../types/ids.js';
import { provenanceSchema } from '../types/provenance.js';
import {
  ageHoursSchema,
  coverageSummarySchema,
  executionSummarySchema,
  moneyPenceSchema,
  priceCellSchema,
  providerIdSchema,
  resultBasisSchema,
} from './common.js';

// why: the one home of the space's limits is space/limits.ts; the contract re-exports the two its bounds use.
export { DEFAULT_MAX_CELLS, MAX_DATE_PAIRS } from '../space/limits.js';

/** Spec §10: the journey limit the date-pairs route and `/results` accept, in whole minutes (else 422). */
export const MIN_JOURNEY_LIMIT_MINUTES = 60;
export const MAX_JOURNEY_LIMIT_MINUTES = 6000;

/**
 * Spec §10 `GET /definitions/:id/date-pairs`: the wire form of the query, every value a string as Hono's
 * `c.req.query()` gives it. The api parses each and answers 422 itself (`unknown_airport`, `invalid_journey_limit`);
 * the route wrapper's own schema failure is a 400, so only the length bounds live here (revision 50).
 */
export const datePairsQuerySchema = z.strictObject({
  /** comma list of the definition's origins */
  origins: z.string().max(200).optional(),
  /** comma list of the definition's destinations */
  destinations: z.string().max(200).optional(),
  /** an integer from 60 to 6000 */
  maxJourneyMinutes: z.string().max(10).optional(),
});

const count = z.number().int().min(0);
const counts = z.array(count);

/** One entry per date pair, in index order: the six buckets over the airport pairs in scope and the cell counts. */
const pairsSchema = z.strictObject({
  priced: counts,
  empty: counts,
  noData: counts,
  error: counts,
  skipped: counts,
  notRun: counts,
  reused: counts,
  selected: counts,
  itinerarySearched: counts,
  onDemand: counts,
  unconfirmed: counts,
  partiallyVerified: counts,
  notReached: counts,
  journeyLeftOut: counts,
});
/** The pair columns, the six buckets first (the refinement sums those). */
const PAIR_COLUMNS = [
  'priced',
  'empty',
  'noData',
  'error',
  'skipped',
  'notRun',
  'reused',
  'selected',
  'itinerarySearched',
  'onDemand',
  'unconfirmed',
  'partiallyVerified',
  'notReached',
  'journeyLeftOut',
] as const;
const SIX_BUCKETS = 6;

/** One entry per date pair with a figure, `pair` ascending; each index points into `provenances` or the scope. */
const figuresSchema = z.strictObject({
  pair: counts,
  pricePence: z.array(moneyPenceSchema),
  provenance: counts,
  stale: z.array(z.boolean()),
  ageHours: z.array(ageHoursSchema),
  /** "cheapest of the rows read" (decisions 30, 36); calendar figures only */
  truncated: z.array(z.boolean()),
  basis: z.array(resultBasisSchema),
  origin: counts,
  destination: counts,
  /** decision 54, calendar figures only */
  superseded: z.array(z.boolean()),
  /** decision 54, verified figures only */
  notSeenInLatestAgeHours: z.array(ageHoursSchema.nullable()),
  journeyMinutes: z.array(count.nullable()),
  /** a cheaper current calendar price a verified figure hides (decision 38), with its own airport pair */
  cheaperCachedPence: z.array(moneyPenceSchema.nullable()),
  cheaperCachedProvenance: z.array(count.nullable()),
  cheaperCachedOrigin: z.array(count.nullable()),
  cheaperCachedDestination: z.array(count.nullable()),
  cheaperCachedTruncated: z.array(z.boolean().nullable()),
  cheaperCachedStale: z.array(z.boolean().nullable()),
  /** the first segment's departLocal and the last segment's arriveLocal of each direction, as the source states them */
  departOut: z.array(z.string().nullable()),
  arriveOut: z.array(z.string().nullable()),
  departBack: z.array(z.string().nullable()),
  arriveBack: z.array(z.string().nullable()),
  /** fetched by an execution created before the latest parent run (revision 50) */
  fromEarlierSearch: z.array(z.boolean()),
});
const FIGURE_COLUMNS = [
  'pair',
  'pricePence',
  'provenance',
  'stale',
  'ageHours',
  'truncated',
  'basis',
  'origin',
  'destination',
  'superseded',
  'notSeenInLatestAgeHours',
  'journeyMinutes',
  'cheaperCachedPence',
  'cheaperCachedProvenance',
  'cheaperCachedOrigin',
  'cheaperCachedDestination',
  'cheaperCachedTruncated',
  'cheaperCachedStale',
  'departOut',
  'arriveOut',
  'departBack',
  'arriveBack',
  'fromEarlierSearch',
] as const satisfies ReadonlyArray<keyof typeof figuresSchema.shape>;
const CHEAPER_COMPANIONS = [
  'cheaperCachedProvenance',
  'cheaperCachedOrigin',
  'cheaperCachedDestination',
  'cheaperCachedTruncated',
  'cheaperCachedStale',
] as const;

const datePairsBodySchema = z.strictObject({
  /** the latest parent run; null before the first */
  executionId: z.string().nullable(),
  /** the runs read, newest first, children included (as /results) */
  executions: z.array(executionSummarySchema),
  /** the definition's; [] means no discovery stage */
  discoveryProviders: z.array(providerIdSchema),
  verificationProviderConfigured: z.boolean(),
  staleAfterHours: count,
  calendarStaleAfterHours: z.partialRecord(providerIdSchema, count),
  /** the current resolved space's dates and stays */
  space: z.strictObject({
    departureFrom: isoDateSchema,
    departureTo: isoDateSchema,
    minNights: count,
    maxNights: count,
  }),
  /** what the server applied */
  scope: z.strictObject({
    origins: z.array(iataSchema),
    destinations: z.array(iataSchema),
    airportPairs: count,
    cells: count,
    maxJourneyMinutes: z
      .number()
      .int()
      .min(MIN_JOURNEY_LIMIT_MINUTES)
      .max(MAX_JOURNEY_LIMIT_MINUTES)
      .nullable(),
  }),
  /** as /results' coverage, over the cells in scope */
  summary: coverageSummarySchema,
  /** each distinct provenance once; figures index it */
  provenances: z.array(provenanceSchema),
  pairs: pairsSchema,
  figures: figuresSchema,
});
type DatePairsBody = z.output<typeof datePairsBodySchema>;

/** Strictly ascending by UTF-16 code units: sorted and unique. */
function sortedUnique(xs: readonly string[]): boolean {
  let previous: string | null = null;
  for (const x of xs) {
    if (previous !== null && !(previous < x)) return false;
    previous = x;
  }
  return true;
}

/**
 * The column rules of spec §10 and the brief's §5, in one linear pass over the pairs and one over the figures,
 * reporting each broken rule once, at its first offending index. Nothing is allocated per date pair or per figure: an
 * issue's path is built only when a rule breaks.
 */
function refineDatePairs(v: DatePairsBody, ctx: z.RefinementCtx): void {
  const reported = new Set<string>();
  const fail = (rule: string, path: Array<string | number>, message: string) => {
    if (reported.has(rule)) return;
    reported.add(rule);
    ctx.addIssue({ code: 'custom', path, message });
  };
  const { scope, summary } = v;
  if (!sortedUnique(scope.origins))
    fail('origins', ['scope', 'origins'], 'scope origins must be sorted and unique');
  if (!sortedUnique(scope.destinations))
    fail('destinations', ['scope', 'destinations'], 'scope destinations must be sorted and unique');
  const airportPairs = scope.airportPairs;
  if (airportPairs !== scope.origins.length * scope.destinations.length)
    fail('airportPairs', ['scope', 'airportPairs'], 'airportPairs must be origins × destinations');
  const datePairs = windowDays(v.space) * stayCount(v.space);
  if (datePairs > MAX_DATE_PAIRS)
    fail('datePairs', ['space'], `the space has ${datePairs} date pairs; at most ${MAX_DATE_PAIRS}`);
  if (scope.cells !== datePairs * airportPairs)
    fail('cells', ['scope', 'cells'], 'cells must be date pairs × airportPairs');
  if (scope.cells > DEFAULT_MAX_CELLS)
    fail('cellBound', ['scope', 'cells'], `the scope has ${scope.cells} cells; at most ${DEFAULT_MAX_CELLS}`);
  if (summary.total !== scope.cells)
    fail('total', ['summary', 'total'], 'summary.total must equal scope.cells');
  refinePairs(v, datePairs, fail);
  refineFigures(v, datePairs, fail);
}

type Fail = (rule: string, path: Array<string | number>, message: string) => void;

function refinePairs(v: DatePairsBody, datePairs: number, fail: Fail): void {
  const { pairs, scope, summary } = v;
  let lengthsOk = true;
  for (const c of PAIR_COLUMNS) {
    if (pairs[c].length === datePairs) continue;
    lengthsOk = false;
    fail(
      `length.${c}`,
      ['pairs', c],
      `pairs.${c} has ${pairs[c].length} entries; the space has ${datePairs}`,
    );
  }
  if (!lengthsOk) return;
  const columns = PAIR_COLUMNS.map((c) => pairs[c]);
  const sums = PAIR_COLUMNS.map(() => 0);
  const a = scope.airportPairs;
  const { notReached, selected, journeyLeftOut } = pairs;
  const noLimit = scope.maxJourneyMinutes === null;
  for (let i = 0; i < datePairs; i += 1) {
    let six = 0;
    for (let k = 0; k < columns.length; k += 1) {
      const x = columnAt(columnAt(columns, k), i);
      sums[k] = columnAt(sums, k) + x;
      if (k < SIX_BUCKETS) six += x;
      if (x > a)
        fail(`above.${k}`, ['pairs', columnAt(PAIR_COLUMNS, k), i], `a count above airportPairs (${a})`);
    }
    // why: revision 50: a cell without a discovery result is not searched, so the six always cover every airport pair
    if (six !== a)
      fail('six', ['pairs', 'notRun', i], `the six buckets sum to ${six}, not airportPairs (${a})`);
    if (columnAt(notReached, i) > columnAt(selected, i))
      fail('notReached', ['pairs', 'notReached', i], 'notReached above selected');
    if (noLimit && columnAt(journeyLeftOut, i) !== 0)
      fail('journeyLeftOut', ['pairs', 'journeyLeftOut', i], 'journeyLeftOut without a journey limit');
  }
  const [priced, empty, noData, error, skipped, notRun, reused, sel, itinerarySearched, onDemand] = sums;
  const expect: Array<[number | undefined, number, Array<string>]> = [
    [priced, summary.buckets.priced, ['buckets', 'priced']],
    [empty, summary.buckets.empty, ['buckets', 'empty']],
    [noData, summary.buckets.no_data, ['buckets', 'no_data']],
    [error, summary.buckets.error, ['buckets', 'error']],
    [skipped, summary.buckets.skipped, ['buckets', 'skipped']],
    [notRun, summary.buckets.not_run, ['buckets', 'not_run']],
    [reused, summary.buckets.reused, ['buckets', 'reused']],
    [reused, summary.reused, ['reused']],
    [sel, summary.selected, ['selected']],
    [itinerarySearched, summary.itinerarySearched, ['itinerarySearched']],
    [onDemand, summary.onDemand, ['onDemand']],
  ];
  for (const [sum, stated, path] of expect)
    if (sum !== stated)
      fail(
        `summary.${path.join('.')}`,
        ['summary', ...path],
        `summary.${path.join('.')} must be the column sum (${sum})`,
      );
}

function refineFigures(v: DatePairsBody, datePairs: number, fail: Fail): void {
  const f = v.figures;
  const n = f.pair.length;
  let lengthsOk = true;
  for (const c of FIGURE_COLUMNS) {
    if (f[c].length === n) continue;
    lengthsOk = false;
    fail(`length.${c}`, ['figures', c], `figures.${c} has ${f[c].length} entries; figures.pair has ${n}`);
  }
  if (!lengthsOk) return;
  const provenances = v.provenances.length;
  const origins = v.scope.origins.length;
  const destinations = v.scope.destinations.length;
  const within = (x: number | null, size: number) => x === null || x < size;
  for (let j = 0; j < n; j += 1) {
    const pair = columnAt(f.pair, j);
    if (j > 0 && pair <= columnAt(f.pair, j - 1))
      fail('pairOrder', ['figures', 'pair', j], 'pair must be strictly ascending');
    else if (pair >= datePairs) fail('pairRange', ['figures', 'pair', j], `pair must be below ${datePairs}`);
    if (!within(columnAt(f.provenance, j), provenances))
      fail('provenance', ['figures', 'provenance', j], 'no such provenance');
    if (!within(columnAt(f.origin, j), origins))
      fail('origin', ['figures', 'origin', j], 'no such origin in scope');
    if (!within(columnAt(f.destination, j), destinations))
      fail('destination', ['figures', 'destination', j], 'no such destination in scope');
    const cheaper = columnAt(f.cheaperCachedPence, j);
    if (columnAt(f.basis, j) === 'verified') {
      if (columnAt(f.superseded, j))
        fail('superseded', ['figures', 'superseded', j], 'superseded is for calendar figures');
      if (columnAt(f.truncated, j))
        fail('truncated', ['figures', 'truncated', j], 'truncated is for calendar figures');
    } else {
      if (columnAt(f.notSeenInLatestAgeHours, j) !== null)
        fail(
          'notSeen',
          ['figures', 'notSeenInLatestAgeHours', j],
          'not seen in latest is for verified figures',
        );
      if (cheaper !== null)
        fail(
          'cheaperBasis',
          ['figures', 'cheaperCachedPence', j],
          'a cheaper cached price is for verified figures',
        );
    }
    if (cheaper !== null && cheaper >= columnAt(f.pricePence, j))
      fail(
        'cheaperBelow',
        ['figures', 'cheaperCachedPence', j],
        "a cheaper cached price must be below the figure's",
      );
    for (const c of CHEAPER_COMPANIONS)
      if ((columnAt<unknown>(f[c], j) === null) !== (cheaper === null))
        fail(`together.${c}`, ['figures', c, j], `${c} must be null exactly when cheaperCachedPence is`);
    if (!within(columnAt(f.cheaperCachedProvenance, j), provenances))
      fail('cheaperProvenance', ['figures', 'cheaperCachedProvenance', j], 'no such provenance');
    if (!within(columnAt(f.cheaperCachedOrigin, j), origins))
      fail('cheaperOrigin', ['figures', 'cheaperCachedOrigin', j], 'no such origin in scope');
    if (!within(columnAt(f.cheaperCachedDestination, j), destinations))
      fail('cheaperDestination', ['figures', 'cheaperCachedDestination', j], 'no such destination in scope');
  }
}

/**
 * Spec §10's date-pair route shape with revision 50's columns (brief §5): a strict object with one refinement, one
 * linear pass, no per-pair allocation. `core`'s `decodeDatePairs` is the only reader of the columns.
 */
export const datePairsResponseSchema = datePairsBodySchema.superRefine(refineDatePairs);
export type DatePairsResponse = z.output<typeof datePairsResponseSchema>;

/** A cheaper current calendar price a verified figure hides (decision 38), named with its own airport pair. */
const cheaperCachedSchema = z.strictObject({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  truncated: z.boolean(),
  origin: iataSchema,
  destination: iataSchema,
});

/**
 * The figure the Dates board shows for one date pair, as the scoped `/results` read sends it (`datePairFigure`): the
 * decoder's `DatePairFigure` less its airport-pair index, each provenance inline, with the board's per-figure rules.
 */
export const datePairFigureSchema = z
  .strictObject({
    price: priceCellSchema,
    basis: resultBasisSchema,
    origin: iataSchema,
    destination: iataSchema,
    superseded: z.boolean(),
    notSeenInLatest: z.strictObject({ ageHours: ageHoursSchema }).nullable(),
    journeyMinutes: count.nullable(),
    departOut: z.string().nullable(),
    arriveOut: z.string().nullable(),
    departBack: z.string().nullable(),
    arriveBack: z.string().nullable(),
    fromEarlierSearch: z.boolean(),
    cheaperCached: cheaperCachedSchema.nullable(),
  })
  .superRefine((f, ctx) => {
    const fail = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (f.basis === 'verified') {
      if (f.superseded) fail(['superseded'], 'superseded is for calendar figures');
      if (f.price.truncated) fail(['price', 'truncated'], 'truncated is for calendar figures');
    } else {
      if (f.notSeenInLatest !== null) fail(['notSeenInLatest'], 'not seen in latest is for verified figures');
      if (f.cheaperCached !== null) fail(['cheaperCached'], 'a cheaper cached price is for verified figures');
    }
    if (f.cheaperCached !== null && f.cheaperCached.pricePence >= f.price.pricePence)
      fail(['cheaperCached', 'pricePence'], "a cheaper cached price must be below the figure's");
  });
