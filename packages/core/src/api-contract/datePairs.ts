import { z } from 'zod';
import { columnAt } from '../datePairs/decode.js';
import { provenanceKey } from '../datePairs/encode.js';
import { FIGURE_BASES, PAIRING_READ, type PairingRead } from '../datePairs/pairing.js';
import { stayCount } from '../datePairs/space.js';
import { flightTextSchema } from '../flights/types.js';
import { windowDays } from '../space/generate.js';
import { DEFAULT_MAX_CELLS, MAX_DATE_PAIRS } from '../space/limits.js';
import { iataSchema, isoDateSchema } from '../types/ids.js';
import { type Provenance, provenanceSchema } from '../types/provenance.js';
import { HHMM } from '../types/window.js';
import {
  ageHoursSchema,
  coverageSummarySchema,
  executionSummarySchema,
  moneyPenceSchema,
  priceCellSchema,
  providerIdSchema,
  staleMarkSchema,
} from './common.js';
import { STOP_DETAILS } from './stopCause.js';

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

/**
 * Spec rev 56 §6.5, §10: a date pair figure's basis: class verified, a calendar price (class unchecked), or the cheapest
 * offer read for a pairing (§6.9). The board, the scoped `/results` read's `datePairFigure` and a card's cheapest take it.
 */
export const figureBasisSchema = z.enum(FIGURE_BASES);
/** Spec rev 56 §6.9: a calendar figure's flight read, `within` exactly on a pairing figure. */
export const pairingReadSchema = z.enum(PAIRING_READ);
/** The `pairingRead` values a calendar figure shows a pairing beneath (spec rev 56 §10's `pairing` group). */
const BENEATH: ReadonlySet<PairingRead> = new Set<PairingRead>([
  'over-limit',
  'within-other-limits',
  'within-older',
  'sellers-not-read',
  'offers-incomplete',
]);
/** A local time on the 24-hour clock as a list page states it (a pairing's legs). */
const hhmm = z.string().regex(HHMM);
/** Page text (a seller's, a fare's) held to the flight list's rule (spec rev 56 §5.1), rendered as text only. */
const pageText = flightTextSchema;
const WHICH = ['cheapest', 'next-cheapest', 'over-limit'] as const;

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
  stale: z.array(staleMarkSchema),
  ageHours: z.array(ageHoursSchema),
  /** "cheapest of the rows read" (decisions 30, 36); calendar figures only */
  truncated: z.array(z.boolean()),
  basis: z.array(figureBasisSchema),
  origin: counts,
  destination: counts,
  /** decision 54, calendar figures only */
  superseded: z.array(z.boolean()),
  /** decision 54, verified figures only */
  notSeenInLatestAgeHours: z.array(ageHoursSchema.nullable()),
  journeyMinutes: z.array(count.nullable()),
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
  'fromEarlierSearch',
] as const satisfies ReadonlyArray<keyof typeof figuresSchema.shape>;

/**
 * One entry per verified figure that hides a cheaper current calendar price (decision 38), `figure` (an index into
 * the figures columns) strictly ascending; the price is named with its own airport pair.
 *
 * why: revision 50: a sparse group keyed by figure, not six columns beside every figure; as dense columns they put
 * 36,400 date pairs at about 5 MiB, above §10's 4 MiB bound.
 */
const cheaperCachedSchema = z.strictObject({
  figure: counts,
  pricePence: z.array(moneyPenceSchema),
  provenance: counts,
  origin: counts,
  destination: counts,
  truncated: z.array(z.boolean()),
  /** the figure's own staleness rule */
  stale: z.array(staleMarkSchema),
});
const CHEAPER_COLUMNS = [
  'figure',
  'pricePence',
  'provenance',
  'origin',
  'destination',
  'truncated',
  'stale',
] as const satisfies ReadonlyArray<keyof typeof cheaperCachedSchema.shape>;

/**
 * One entry per verified figure with at least one local time: the first segment's departLocal and the last segment's
 * arriveLocal of each direction, as the source states them (null where it does not); `figure` strictly ascending.
 * Sparse for the reason above: a calendar figure has no segments.
 */
const timesSchema = z.strictObject({
  figure: counts,
  departOut: z.array(z.string().nullable()),
  arriveOut: z.array(z.string().nullable()),
  departBack: z.array(z.string().nullable()),
  arriveBack: z.array(z.string().nullable()),
});
/** The four local times of a verified figure, as both the `times` group and the inline `datePairFigure` name them. */
const TIME_KEYS = ['departOut', 'arriveOut', 'departBack', 'arriveBack'] as const satisfies ReadonlyArray<
  keyof typeof timesSchema.shape
>;
const TIME_COLUMNS = ['figure', ...TIME_KEYS] as const satisfies ReadonlyArray<
  keyof typeof timesSchema.shape
>;

/**
 * Spec rev 56 §10: one entry per pairing figure, the calendar price it replaced (shown beneath it with its own source,
 * age, "not checked" and stale mark); `figure` strictly ascending. Sparse, as `cheaperCached` is (§10's 4 MiB bound).
 */
const gridPriceSchema = z.strictObject({
  figure: counts,
  pricePence: z.array(moneyPenceSchema),
  provenance: counts,
  stale: z.array(staleMarkSchema),
  truncated: z.array(z.boolean()),
});
const GRID_COLUMNS = [
  'figure',
  'pricePence',
  'provenance',
  'stale',
  'truncated',
] as const satisfies ReadonlyArray<keyof typeof gridPriceSchema.shape>;

/**
 * Spec rev 56 §10: one entry per pairing figure (its own words: seller, fare, times, `which`, mismatch; R-board) and per
 * calendar figure shown with a pairing beneath (within-older, within-other-limits, over-limit, sellers-not-read,
 * offers-incomplete); `figure` strictly ascending. `pricePence` is the cheapest offer's stated price, or the return's
 * "from" price when `isFrom` (then no seller and no fare); `fromPence` is always the return's "from" price (Task 21.7:
 * the board's mismatch mark names it, "Google listed from £1,180"); the provenance, stale mark and age are the flight
 * list's.
 */
const pairingGroupSchema = z.strictObject({
  figure: counts,
  pricePence: z.array(moneyPenceSchema),
  fromPence: z.array(moneyPenceSchema),
  isFrom: z.array(z.boolean()),
  seller: z.array(pageText.nullable()),
  fare: z.array(pageText.nullable()),
  offersRead: counts,
  complete: z.array(z.boolean()),
  which: z.array(z.enum(WHICH)),
  departOut: z.array(hhmm),
  arriveOut: z.array(hhmm),
  departBack: z.array(hhmm),
  arriveBack: z.array(hhmm),
  mismatch: z.array(z.boolean()),
  provenance: counts,
  stale: z.array(staleMarkSchema),
  ageHours: z.array(ageHoursSchema),
});
const PAIRING_COLUMNS = [
  'figure',
  'pricePence',
  'fromPence',
  'isFrom',
  'seller',
  'fare',
  'offersRead',
  'complete',
  'which',
  'departOut',
  'arriveOut',
  'departBack',
  'arriveBack',
  'mismatch',
  'provenance',
  'stale',
  'ageHours',
] as const satisfies ReadonlyArray<keyof typeof pairingGroupSchema.shape>;

/**
 * Spec rev 56 §10 (ruling R-sparse): one entry per figure whose read is not `not-read`, `figure` strictly ascending,
 * `code` the read's index in `PAIRING_READ` (pinned in its order; 0, `not-read`, is never sent); a figure with no entry
 * reads `not-read`. Sparse because a dense column of 36,400 reads (about 400 KB) took §10's worst case past 4 MiB.
 */
const pairingReadGroupSchema = z.strictObject({
  figure: counts,
  code: z.array(
    z
      .number()
      .int()
      .min(1)
      .max(PAIRING_READ.length - 1),
  ),
});
const PAIRING_READ_COLUMNS = ['figure', 'code'] as const satisfies ReadonlyArray<
  keyof typeof pairingReadGroupSchema.shape
>;
/**
 * The 21.6 ruling: one entry per figure whose cell's newest flight list failed (`pairingRead` `list-failed`), with the
 * list's reason (one STOP_DETAILS word, never free text), so the board words it "flights couldn't be read: <cause>";
 * `figure` strictly ascending. Sparse: most cells have no failed list.
 */
const listReasonGroupSchema = z.strictObject({
  figure: counts,
  reason: z.array(z.enum(STOP_DETAILS)),
});
const LIST_REASON_COLUMNS = ['figure', 'reason'] as const satisfies ReadonlyArray<
  keyof typeof listReasonGroupSchema.shape
>;
/** `within`'s code: exactly a pairing figure's. */
const WITHIN_CODE = PAIRING_READ.indexOf('within');

const datePairsBodySchema = z.strictObject({
  /** the latest parent run; null before the first */
  executionId: z.string().nullable(),
  /** the runs read, newest first, children included (as /results) */
  executions: z.array(executionSummarySchema),
  /** the definition's; [] means no discovery stage */
  discoveryProviders: z.array(providerIdSchema),
  verificationProviderConfigured: z.boolean(),
  staleAfterHours: count,
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
  cheaperCached: cheaperCachedSchema,
  times: timesSchema,
  /** spec rev 56: optional until Task 21.6 fills it (R-order); a body without it decodes with no grid price */
  gridPrice: gridPriceSchema.exactOptional(),
  /** spec rev 56: optional until Task 21.6 fills it (R-order); a body without it decodes with no pairing */
  pairing: pairingGroupSchema.exactOptional(),
  /** spec rev 56 (R-sparse): optional until Task 21.6 fills it; a body without it reads every figure `not-read` */
  pairingRead: pairingReadGroupSchema.exactOptional(),
  /** the 21.6 ruling: a failed list's reason; a body without it (an older api) has no `list-failed` read */
  listReason: listReasonGroupSchema.exactOptional(),
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
  if (refineFigures(v, datePairs, fail)) refineGroups(v, fail);
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

/** Whether every column of a group is as long as its first; reports each one that is not. */
function sameLengths<C extends string>(
  group: Record<C, readonly unknown[]>,
  columns: readonly [C, ...C[]],
  name: string,
  fail: Fail,
): boolean {
  const n = group[columns[0]].length;
  let ok = true;
  for (const c of columns) {
    if (group[c].length === n) continue;
    ok = false;
    fail(
      `length.${name}.${c}`,
      [name, c],
      `${name}.${c} has ${group[c].length} entries; ${name}.${columns[0]} has ${n}`,
    );
  }
  return ok;
}

/** The figures' rules; false when their columns differ in length, so nothing can be read across them. */
function refineFigures(v: DatePairsBody, datePairs: number, fail: Fail): boolean {
  const f = v.figures;
  if (!sameLengths(f, FIGURE_COLUMNS, 'figures', fail)) return false;
  const provenances = v.provenances.length;
  const origins = v.scope.origins.length;
  const destinations = v.scope.destinations.length;
  for (let j = 0; j < f.pair.length; j += 1) {
    const pair = columnAt(f.pair, j);
    if (j > 0 && pair <= columnAt(f.pair, j - 1))
      fail('pairOrder', ['figures', 'pair', j], 'pair must be strictly ascending');
    else if (pair >= datePairs) fail('pairRange', ['figures', 'pair', j], `pair must be below ${datePairs}`);
    if (columnAt(f.provenance, j) >= provenances)
      fail('provenance', ['figures', 'provenance', j], 'no such provenance');
    if (columnAt(f.origin, j) >= origins) fail('origin', ['figures', 'origin', j], 'no such origin in scope');
    if (columnAt(f.destination, j) >= destinations)
      fail('destination', ['figures', 'destination', j], 'no such destination in scope');
    const basis = columnAt(f.basis, j);
    if (basis === 'verified') {
      if (columnAt(f.superseded, j))
        fail('superseded', ['figures', 'superseded', j], 'superseded is for calendar figures');
      if (columnAt(f.truncated, j))
        fail('truncated', ['figures', 'truncated', j], 'truncated is for calendar figures');
    } else if (columnAt(f.notSeenInLatestAgeHours, j) !== null)
      fail(
        'notSeen',
        ['figures', 'notSeenInLatestAgeHours', j],
        'not seen in latest is for verified figures',
      );
  }
  return true;
}

/**
 * The figure a sparse group's entry `k` names: reports an index that is not strictly ascending or not a figure, and
 * returns it only when it names a verified figure (both groups belong to verified figures alone), else null.
 */
function verifiedFigureOf(
  v: DatePairsBody,
  name: 'cheaperCached' | 'times',
  k: number,
  fail: Fail,
): number | null {
  const figure = v[name].figure;
  const at = columnAt(figure, k);
  if (k > 0 && at <= columnAt(figure, k - 1)) {
    fail(`${name}.order`, [name, 'figure', k], `${name}.figure must be strictly ascending`);
    return null;
  }
  if (at >= v.figures.pair.length) {
    fail(`${name}.range`, [name, 'figure', k], `${name}.figure must name one of the figures`);
    return null;
  }
  if (columnAt(v.figures.basis, at) === 'verified') return at;
  fail(`${name}.basis`, [name, 'figure', k], `${name} entries are for verified figures only`);
  return null;
}

/**
 * The figure a revision 56 group's entry `k` names (`gridPrice`, `pairing`): reports an index that is not strictly
 * ascending or not a figure, and returns it when it is one (the caller checks the basis), else null.
 */
function groupFigureOf(
  figure: readonly number[],
  name: string,
  figures: number,
  k: number,
  fail: Fail,
): number | null {
  const at = columnAt(figure, k);
  if (k > 0 && at <= columnAt(figure, k - 1)) {
    fail(`${name}.order`, [name, 'figure', k], `${name}.figure must be strictly ascending`);
    return null;
  }
  if (at >= figures) {
    fail(`${name}.range`, [name, 'figure', k], `${name}.figure must name one of the figures`);
    return null;
  }
  return at;
}

/**
 * Spec rev 56 §10 (R-sparse): the `pairingRead` group's rules: lengths; figure order and range; `within` exactly on a
 * pairing figure, every pairing figure with an entry. Returns each entry's read by figure (an absent figure reads
 * `not-read`), for the pairing group's rule; null when its columns differ in length.
 */
function refinePairingRead(
  v: DatePairsBody,
  pairingFigures: readonly number[],
  fail: Fail,
): Map<number, PairingRead> | null {
  const reads = new Map<number, PairingRead>();
  const g = v.pairingRead;
  if (g === undefined) {
    if (pairingFigures.length > 0) fail('readMissing', ['pairingRead'], 'a pairing figure reads within');
    return reads;
  }
  // why: columns of different lengths cannot be read across, so the pairing group is not judged by them either
  if (!sameLengths(g, PAIRING_READ_COLUMNS, 'pairingRead', fail)) return null;
  let inOrder = true;
  let valid = true;
  for (let k = 0; k < g.figure.length; k += 1) {
    const at = groupFigureOf(g.figure, 'pairingRead', v.figures.pair.length, k, fail);
    if (at === null) {
      inOrder = false;
      continue;
    }
    const code = columnAt(g.code, k);
    // why: zod runs this refinement even when a code failed the column's own check (which reports it), so such a code
    // is read as nothing here, and the pairing group is then not judged by the reads
    const read = Number.isInteger(code) && code > 0 ? PAIRING_READ[code] : undefined;
    if (read === undefined) {
      valid = false;
      continue;
    }
    reads.set(at, read);
    if ((columnAt(v.figures.basis, at) === 'pairing') !== (code === WITHIN_CODE))
      fail('readWithin', ['pairingRead', 'code', k], 'pairingRead is within exactly on a pairing figure');
  }
  if (inOrder && pairingFigures.some((j) => !reads.has(j)))
    fail('readMissing', ['pairingRead', 'figure'], 'a pairing figure reads within');
  return valid ? reads : null;
}

/**
 * The 21.6 ruling: the `listReason` group's rules: lengths; figure order and range; an entry exactly for each figure
 * whose read is `list-failed` (`reads`, by figure).
 */
function refineListReason(v: DatePairsBody, reads: ReadonlyMap<number, PairingRead>, fail: Fail): void {
  // why: `reads` holds only entries that named a figure in order, so its keys ascend
  const failed = [...reads].flatMap(([j, read]) => (read === 'list-failed' ? [j] : []));
  const g = v.listReason;
  if (g === undefined) {
    if (failed.length > 0) fail('listReasonMissing', ['listReason'], 'a list-failed read needs its reason');
    return;
  }
  if (!sameLengths(g, LIST_REASON_COLUMNS, 'listReason', fail)) return;
  const named: number[] = [];
  for (let k = 0; k < g.figure.length; k += 1) {
    const at = groupFigureOf(g.figure, 'listReason', v.figures.pair.length, k, fail);
    if (at !== null) named.push(at);
  }
  // why: both lists ascend, so equal lists are equal sets; checked only when every entry named a figure in order
  if (named.length === g.figure.length && named.join() !== failed.join())
    fail('listReasonExact', ['listReason', 'figure'], 'a reason exactly for each list-failed read');
}

/**
 * Final review B-M5: what a pairing shown beneath its figure must say for its read (the api's `pairingReadOf` order):
 * over the limits when it reads `over-limit`, and only then or under other limits (`within-other-limits`, B-M2); stale when it reads `within-older`, fresh when it reads
 * `sellers-not-read` or `offers-incomplete`. Design 2026-11-08 §4.1: those two reads are never produced now, and what
 * the pairing's price is (an offer's, or Google's "from" price) no longer depends on the read, so the price columns are
 * checked once for every pairing (`pairingCellBreach`). The column breached first, with its message, or null.
 */
function beneathBreach(
  read: PairingRead,
  p: { which: string; stale: unknown },
): { column: 'which' | 'stale'; message: string } | null {
  // why: B-M2: a list read under other limits reads within-other-limits whether or not it is over today's limits
  const over = p.which === 'over-limit';
  if (read === 'over-limit' ? !over : over && read !== 'within-other-limits')
    return { column: 'which', message: 'a pairing beneath is over the limits exactly when it reads so' };
  if (read === 'within-older' && p.stale === false)
    return { column: 'stale', message: 'a pairing older than the refresh is stale' };
  if ((read === 'sellers-not-read' || read === 'offers-incomplete') && p.stale !== false)
    return { column: 'stale', message: 'a pairing within the refresh is fresh' };
  return null;
}

/** A provenance a flight list carries (spec rev 56 §6.9): the browser worker's own page. */
const isFlightList = (p: Provenance | undefined): boolean =>
  p?.providerId === 'camoufox' && p.sourceKind === 'scraped-self';

/**
 * Spec rev 56 §6.9 "When it leads" (prov-001): a pairing figure's entry `k` (figure `at`) is the leading pairing's own
 * words (design 2026-11-08 §4.1): either a complete offer's price (not `isFrom`, a seller, at least one offer read) or the
 * return's "from" price (`isFrom`, no seller), never an incomplete offer's price; equal to the figure's, within
 * the limits, the figure carrying its stale mark (spec rev 62: at any age), and the figure's own flight-list provenance. So a regression in the api's lead rule
 * cannot put a headline seller price on the board that the rules forbid.
 */
function refineLeading(
  v: DatePairsBody,
  q: NonNullable<DatePairsBody['pairing']>,
  k: number,
  at: number,
  fail: Fail,
): void {
  const f = v.figures;
  // why: the complete-offer words (a seller, at least one offer read) bind only an offer's price; a "from" price is
  // refused an incomplete offer's price by `isFrom`'s own rules below (never complete, no seller)
  if (!columnAt(q.isFrom, k)) {
    if (!columnAt(q.complete, k))
      fail('pairingComplete', ['pairing', 'complete', k], "a pairing figure's offers are complete");
    if (columnAt(q.offersRead, k) < 1)
      fail('pairingOffers', ['pairing', 'offersRead', k], 'a pairing figure read at least one offer');
  }
  if (columnAt(q.which, k) === 'over-limit')
    fail('pairingLimits', ['pairing', 'which', k], 'a pairing figure is within the limits');
  // why: spec rev 62: a pairing leads at any age, and the figure carries its list's stale mark, never another
  if (columnAt(q.stale, k) !== columnAt(f.stale, at))
    fail('pairingStale', ['pairing', 'stale', k], "a pairing figure's stale mark is its pairing's");
  if (columnAt(q.pricePence, k) !== columnAt(f.pricePence, at))
    fail('pairingPrice', ['pairing', 'pricePence', k], "a pairing figure's price is its offer's");
  const provenance = columnAt(q.provenance, k);
  // why: an index past the table is the group's own refusal (`pairingProvenance`), not reported twice
  if (
    provenance < v.provenances.length &&
    (provenance !== columnAt(f.provenance, at) || !isFlightList(v.provenances[provenance]))
  )
    fail('pairingSource', ['pairing', 'provenance', k], "a pairing figure's provenance is its flight list's");
}

/**
 * Spec rev 56 §10: the grid price and pairing groups' rules: lengths; figure order and range; the grid prices exactly
 * the pairing figures; a pairing figure has a pairing entry that is not a "from" price; a pairing entry beneath a calendar
 * figure, or a stale verified one (ruling 21.2), only for the five "beneath" reads, never on a fresh verified figure; a
 * seller exactly when the price is an offer's
 * (no seller and no fare on a "from" price); every provenance index in the table.
 */
function refinePairingGroups(v: DatePairsBody, fail: Fail): void {
  const f = v.figures;
  const figures = f.pair.length;
  const pairingFigures = f.basis.flatMap((b, j) => (b === 'pairing' ? [j] : []));
  const reads = refinePairingRead(v, pairingFigures, fail);
  const readOf = (j: number): PairingRead | null => (reads === null ? null : (reads.get(j) ?? 'not-read'));
  if (reads !== null) refineListReason(v, reads, fail);
  const g = v.gridPrice;
  if (g === undefined && pairingFigures.length > 0)
    fail('gridExact', ['gridPrice'], 'a pairing figure needs its grid price');
  if (g !== undefined && sameLengths(g, GRID_COLUMNS, 'gridPrice', fail)) {
    const named: number[] = [];
    for (let k = 0; k < g.figure.length; k += 1) {
      const at = groupFigureOf(g.figure, 'gridPrice', figures, k, fail);
      if (at !== null) named.push(at);
      if (columnAt(g.provenance, k) >= v.provenances.length)
        fail('gridProvenance', ['gridPrice', 'provenance', k], 'no such provenance');
    }
    // why: both lists ascend, so equal lists are equal sets; checked only when every entry named a figure in order
    if (named.length === g.figure.length && named.join() !== pairingFigures.join())
      fail('gridExact', ['gridPrice', 'figure'], 'gridPrice entries must be exactly the pairing figures');
  }
  const q = v.pairing;
  if (q === undefined) {
    if (pairingFigures.length > 0)
      fail('pairingMissing', ['pairing'], 'a pairing figure needs its pairing entry');
    return;
  }
  if (!sameLengths(q, PAIRING_COLUMNS, 'pairing', fail)) return;
  const named = new Set<number>();
  let inOrder = true;
  for (let k = 0; k < q.figure.length; k += 1) {
    const at = groupFigureOf(q.figure, 'pairing', figures, k, fail);
    if (at === null) {
      inOrder = false;
      continue;
    }
    named.add(at);
    const basis = columnAt(f.basis, at);
    const isFrom = columnAt(q.isFrom, k);
    const read = readOf(at);
    // why: ruling 21.2: beneath a calendar figure, or a stale verified one, only for the five "beneath" reads
    const beneath = basis === 'calendar' || (basis === 'verified' && columnAt(f.stale, at) !== false);
    if (basis !== 'pairing' && (!beneath || (read !== null && !BENEATH.has(read))))
      fail(
        'pairingBasis',
        ['pairing', 'figure', k],
        'a pairing entry is for a pairing figure or a pairing shown beneath',
      );
    if (basis === 'pairing') refineLeading(v, q, k, at, fail);
    // why: final review B-M5: a pairing beneath says what its read says
    const breach =
      basis === 'pairing' || read === null
        ? null
        : beneathBreach(read, { which: columnAt(q.which, k), stale: columnAt(q.stale, k) });
    if (breach !== null) fail('pairingBeneath', ['pairing', breach.column, k], breach.message);
    // why: prov-001, design 2026-11-08 §4.1: a "from" price is shown when no complete offers were read for the pairing:
    // none read, or some read and not complete (`offersRead` says which), so it is never complete itself and an
    // incomplete offer's price is never shown
    if (isFrom && columnAt(q.complete, k))
      fail('pairingFromComplete', ['pairing', 'complete', k], 'a from price is never complete');
    if (isFrom === (columnAt(q.seller, k) !== null))
      fail('pairingSeller', ['pairing', 'seller', k], "a seller exactly when the price is an offer's");
    if (isFrom && columnAt(q.fare, k) !== null)
      fail('pairingFare', ['pairing', 'fare', k], 'no fare on a from price');
    // why: Task 21.7: the "from" price beside the entry is honest: a from price is its own, and the mismatch mark says
    // exactly that an offer's price differs from it (spec rev 56 §6.9: the page names both figures)
    const from = columnAt(q.fromPence, k);
    const price = columnAt(q.pricePence, k);
    if (isFrom && from !== price)
      fail('pairingFromPrice', ['pairing', 'fromPence', k], "a from price is the return's own from price");
    if (columnAt(q.mismatch, k) !== (!isFrom && from !== price))
      fail(
        'pairingMismatch',
        ['pairing', 'mismatch', k],
        'a mismatch exactly when an offer differs from the from price',
      );
    const provenance = columnAt(q.provenance, k);
    if (provenance >= v.provenances.length)
      fail('pairingProvenance', ['pairing', 'provenance', k], 'no such provenance');
    // why: 21.7 prov-012: every pairing, beneath a figure too, is a flight list's, so the board's fixed source words
    // ("the browser worker's flight list") never name another source's price; a leading one is refused by refineLeading
    else if (basis !== 'pairing' && !isFlightList(v.provenances[provenance]))
      fail('pairingSource', ['pairing', 'provenance', k], "a pairing's provenance is a flight list's");
  }
  if (inOrder && pairingFigures.some((j) => !named.has(j)))
    fail('pairingMissing', ['pairing', 'figure'], 'a pairing figure needs its pairing entry');
  // why: final review B-M5: a "beneath" read names the pairing shown beneath it, so its entry is there
  const r = v.pairingRead;
  if (inOrder && reads !== null && r !== undefined)
    for (let k = 0; k < r.figure.length; k += 1) {
      const at = columnAt(r.figure, k);
      const read = reads.get(at);
      if (read !== undefined && BENEATH.has(read) && !named.has(at))
        fail(
          'beneathMissing',
          ['pairingRead', 'code', k],
          'a pairing read beneath its figure needs its pairing entry',
        );
    }
}

/** The sparse groups' rules: lengths, figure order and basis, the cheaper price below its figure's, indices. */
function refineGroups(v: DatePairsBody, fail: Fail): void {
  refinePairingGroups(v, fail);
  const c = v.cheaperCached;
  if (sameLengths(c, CHEAPER_COLUMNS, 'cheaperCached', fail))
    for (let k = 0; k < c.figure.length; k += 1) {
      const at = verifiedFigureOf(v, 'cheaperCached', k, fail);
      if (at !== null && columnAt(c.pricePence, k) >= columnAt(v.figures.pricePence, at))
        fail(
          'cheaperBelow',
          ['cheaperCached', 'pricePence', k],
          "a cheaper cached price must be below the figure's",
        );
      if (columnAt(c.provenance, k) >= v.provenances.length)
        fail('cheaperProvenance', ['cheaperCached', 'provenance', k], 'no such provenance');
      if (columnAt(c.origin, k) >= v.scope.origins.length)
        fail('cheaperOrigin', ['cheaperCached', 'origin', k], 'no such origin in scope');
      if (columnAt(c.destination, k) >= v.scope.destinations.length)
        fail('cheaperDestination', ['cheaperCached', 'destination', k], 'no such destination in scope');
    }
  const t = v.times;
  if (sameLengths(t, TIME_COLUMNS, 'times', fail))
    for (let k = 0; k < t.figure.length; k += 1) {
      verifiedFigureOf(v, 'times', k, fail);
      // why: an entry exists only for a figure with a time, so each figure has one encoding
      if (
        columnAt(t.departOut, k) === null &&
        columnAt(t.arriveOut, k) === null &&
        columnAt(t.departBack, k) === null &&
        columnAt(t.arriveBack, k) === null
      )
        fail('timesEmpty', ['times', 'departOut', k], 'a times entry must hold at least one time');
    }
}

/**
 * Spec §10's date-pair route shape with revision 50's columns (brief §5): a strict object with one refinement, one
 * linear pass, no per-pair allocation. `core`'s `decodeDatePairs` is the only reader of the columns.
 */
export const datePairsResponseSchema = datePairsBodySchema.superRefine(refineDatePairs);
export type DatePairsResponse = z.output<typeof datePairsResponseSchema>;

/** A cheaper current calendar price a verified figure hides (decision 38), named with its own airport pair. */
const cheaperCachedPriceSchema = z.strictObject({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: staleMarkSchema,
  truncated: z.boolean(),
  origin: iataSchema,
  destination: iataSchema,
});

/** Spec rev 56 §6.9: the calendar price a pairing figure replaced, its provenance inline. */
const gridPriceCellSchema = z.strictObject({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: staleMarkSchema,
  truncated: z.boolean(),
});
/** Spec rev 56 §10: one pairing as the `pairing` group carries it, its provenance inline. */
const pairingCellSchema = z.strictObject({
  pricePence: moneyPenceSchema,
  fromPence: moneyPenceSchema,
  isFrom: z.boolean(),
  seller: pageText.nullable(),
  fare: pageText.nullable(),
  offersRead: count,
  complete: z.boolean(),
  which: z.enum(WHICH),
  departOut: hhmm,
  arriveOut: hhmm,
  departBack: hhmm,
  arriveBack: hhmm,
  mismatch: z.boolean(),
  provenance: provenanceSchema,
  stale: staleMarkSchema,
  ageHours: ageHoursSchema,
});

/**
 * The figure the Dates board shows for one date pair, as the scoped `/results` read sends it (`datePairFigure`): the
 * decoder's `DatePairFigure` less its airport-pair index, each provenance inline, with the board's per-figure rules.
 */
export const datePairFigureSchema = z
  .strictObject({
    price: priceCellSchema,
    basis: figureBasisSchema,
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
    cheaperCached: cheaperCachedPriceSchema.nullable(),
    /** spec rev 56 §6.9: non-null exactly on a pairing figure (required since Task 21.7, R-order) */
    gridPrice: gridPriceCellSchema.nullable(),
    /** spec rev 56 §6.9: a pairing figure's own words, or the pairing beneath a calendar figure */
    pairing: pairingCellSchema.nullable(),
    /** spec rev 56 §6.9: `not-read` with no list; `within` exactly on a pairing figure */
    pairingRead: pairingReadSchema,
    /** the 21.6 ruling: why the cell's newest list failed, non-null exactly on a `list-failed` read */
    listReason: z.enum(STOP_DETAILS).nullable(),
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
      // why: §10 refuses times on a calendar figure, as `refineGroups` refuses a `times` entry on one, so the two
      // encodings of one figure accept the same shapes (no "arrives HH:MM" beside an unchecked calendar price)
      for (const k of TIME_KEYS) if (f[k] !== null) fail([k], 'local times are for verified figures');
    }
    if (f.cheaperCached !== null && f.cheaperCached.pricePence >= f.price.pricePence)
      fail(['cheaperCached', 'pricePence'], "a cheaper cached price must be below the figure's");
    // why: spec rev 56 §10: the board's refinement, figure by figure, so the two encodings accept the same shapes
    const pairingBasis = f.basis === 'pairing';
    const read = f.pairingRead;
    const p = f.pairing;
    if (pairingBasis !== (f.gridPrice !== null))
      fail(['gridPrice'], 'a grid price exactly on a pairing figure');
    if (pairingBasis !== (read === 'within'))
      fail(['pairingRead'], 'pairingRead is within exactly on a pairing figure');
    if ((read === 'list-failed') !== (f.listReason !== null))
      fail(['listReason'], 'a reason exactly on a list-failed read');
    // why: ruling 21.2: a pairing is shown beneath a calendar figure, or a stale verified one, as the board allows
    const beneath = f.basis === 'calendar' || (f.basis === 'verified' && f.price.stale !== false);
    if (pairingBasis ? p === null : p !== null && (!beneath || !BENEATH.has(read)))
      fail(
        ['pairing'],
        'a pairing for a pairing figure, or shown beneath a calendar or stale verified figure',
      );
    // why: final review B-M5: a "beneath" read names the pairing shown beneath it
    if (p === null && BENEATH.has(read))
      fail(['pairing'], 'a pairing read beneath its figure needs its pairing');
    if (p === null) return;
    if (pairingBasis) {
      // why: prov-001: the leading pairing's own words, the board's `refineLeading` figure by figure
      if (!p.isFrom) {
        if (!p.complete) fail(['pairing', 'complete'], "a pairing figure's offers are complete");
        if (p.offersRead < 1) fail(['pairing', 'offersRead'], 'a pairing figure read at least one offer');
      }
      if (p.which === 'over-limit') fail(['pairing', 'which'], 'a pairing figure is within the limits');
      if (p.stale !== f.price.stale)
        fail(['pairing', 'stale'], "a pairing figure's stale mark is its pairing's");
      if (p.pricePence !== f.price.pricePence)
        fail(['pairing', 'pricePence'], "a pairing figure's price is its offer's");
      if (provenanceKey(p.provenance) !== provenanceKey(f.price.provenance) || !isFlightList(p.provenance))
        fail(['pairing', 'provenance'], "a pairing figure's provenance is its flight list's");
    } else {
      // why: 21.7 prov-012: a pairing beneath a figure is a flight list's too, as the board's group requires
      if (!isFlightList(p.provenance))
        fail(['pairing', 'provenance'], "a pairing's provenance is a flight list's");
      // why: final review B-M5: as the board's group, figure by figure
      const breach = beneathBreach(read, p);
      if (breach !== null) fail(['pairing', breach.column], breach.message);
    }
    if (p.isFrom && p.complete) fail(['pairing', 'complete'], 'a from price is never complete');
    if (p.isFrom === (p.seller !== null))
      fail(['pairing', 'seller'], "a seller exactly when the price is an offer's");
    if (p.isFrom && p.fare !== null) fail(['pairing', 'fare'], 'no fare on a from price');
    // why: Task 21.7: as the board's group (refinePairingGroups), figure by figure
    if (p.isFrom && p.fromPence !== p.pricePence)
      fail(['pairing', 'fromPence'], "a from price is the return's own from price");
    if (p.mismatch !== (!p.isFrom && p.fromPence !== p.pricePence))
      fail(['pairing', 'mismatch'], 'a mismatch exactly when an offer differs from the from price');
  });
