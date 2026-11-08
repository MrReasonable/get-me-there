import { describe, expect, it } from 'vitest';
import {
  type DatePairsResponse,
  DEFAULT_MAX_CELLS,
  datePairFigureSchema,
  datePairsQuerySchema,
  datePairsResponseSchema,
  MAX_DATE_PAIRS,
} from '../../src/api-contract/datePairs.js';
import { type DatePairFigure, type DatePairPairing, encodeDatePairs } from '../../src/datePairs/encode.js';
import { PAIRING_READ } from '../../src/datePairs/pairing.js';
import { asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import {
  calendarFigure,
  decoded,
  figurePairing,
  pairingFigure,
  verifiedFigure,
  workedExampleResponse,
} from '../helpers/datePairs.js';

/** A deep copy of the worked example's wire body to break one rule on. */
const body = (): DatePairsResponse => structuredClone(workedExampleResponse());
/** The issues' paths; every issue must say what is wrong (zod puts "Invalid input" in place of an empty message). */
const issuePaths = (value: unknown): string[] => {
  const r = datePairsResponseSchema.safeParse(value);
  if (r.success) return [];
  for (const i of r.error.issues) expect(i.message, i.path.join('.')).toMatch(/^(?!Invalid input$).*\w{4,}/);
  return r.error.issues.map((i) => i.path.join('.'));
};
const firstWhere = <T>(xs: readonly T[], f: (x: T) => boolean): number => {
  const i = xs.findIndex(f);
  if (i < 0) throw new Error('the worked example lacks the case');
  return i;
};
/** Recompute the summary from the columns, so a test breaks only the rule it names. */
function resum(r: DatePairsResponse): DatePairsResponse {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const p = r.pairs;
  r.summary = {
    buckets: {
      priced: sum(p.priced),
      empty: sum(p.empty),
      no_data: sum(p.noData),
      error: sum(p.error),
      skipped: sum(p.skipped),
      not_run: sum(p.notRun),
      reused: sum(p.reused),
    },
    total: r.scope.cells,
    selected: sum(p.selected),
    itinerarySearched: sum(p.itinerarySearched),
    onDemand: sum(p.onDemand),
    reused: sum(p.reused),
  };
  return r;
}
/** Entry `i` of a column, or the test's own error. */
const columnOf = <T>(xs: readonly T[], i: number): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`no entry ${i}`);
  return x;
};
const verifiedAt = (r: DatePairsResponse) => firstWhere(r.figures.basis, (b) => b === 'verified');
const calendarAt = (r: DatePairsResponse) => firstWhere(r.figures.basis, (b) => b === 'calendar');

const TIMES = ['departOut', 'arriveOut', 'departBack', 'arriveBack'] as const;
const PAIR_COUNTS = [
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

describe("datePairsResponseSchema (spec §10 the date-pair route's shape; brief §5)", () => {
  it("the helper's worked-example response parses", () => {
    expect(issuePaths(workedExampleResponse())).toEqual([]);
    expect(MAX_DATE_PAIRS).toBe(36_400);
    expect(DEFAULT_MAX_CELLS).toBe(50_000);
  });

  // §10's rules
  it('rejects a pairs column not days × stays long', () => {
    const r = body();
    r.pairs.onDemand.pop();
    expect(issuePaths(r)).toContain('pairs.onDemand');
  });
  it('rejects figures columns of different lengths, longer or shorter', () => {
    const r = body();
    r.figures.journeyMinutes.push(null);
    expect(issuePaths(r)).toEqual(['figures.journeyMinutes']);
    const s = body();
    s.figures.origin.pop();
    expect(issuePaths(s)).toEqual(['figures.origin']);
    // and nothing is read across them: the sparse groups name figures 0 to 4
    const t = body();
    t.figures.basis.splice(4);
    expect(issuePaths(t)).toEqual(['figures.basis']);
  });
  it('rejects a pair index that is not strictly ascending', () => {
    const r = body();
    const [a = 0, b = 0] = r.figures.pair;
    r.figures.pair[0] = b;
    r.figures.pair[1] = a;
    expect(issuePaths(r)).toEqual(['figures.pair.1']);
    const s = body();
    s.figures.pair[1] = s.figures.pair[0] ?? 0;
    expect(issuePaths(s)).toEqual(['figures.pair.1']);
  });
  it('rejects a pair index out of range', () => {
    const r = body();
    const last = r.figures.pair.length - 1;
    r.figures.pair[last] = r.pairs.priced.length;
    expect(issuePaths(r)).toEqual([`figures.pair.${last}`]);
  });
  it.each([
    ['provenance', (r: DatePairsResponse) => r.provenances.length],
    ['origin', (r: DatePairsResponse) => r.scope.origins.length],
    ['destination', (r: DatePairsResponse) => r.scope.destinations.length],
  ] as const)('rejects a %s index out of range', (column, outside) => {
    const r = body();
    r.figures[column][2] = outside(r);
    expect(issuePaths(r)).toEqual([`figures.${column}.2`]);
  });
  it.each([
    ['provenance', (r: DatePairsResponse) => r.provenances.length],
    ['origin', (r: DatePairsResponse) => r.scope.origins.length],
    ['destination', (r: DatePairsResponse) => r.scope.destinations.length],
  ] as const)('rejects a cheaper-cached %s index out of range', (column, outside) => {
    const r = body();
    r.cheaperCached[column][1] = outside(r);
    expect(issuePaths(r)).toEqual([`cheaperCached.${column}.1`]);
  });
  it.each(PAIR_COUNTS)('rejects a %s count above scope.airportPairs', (column) => {
    const r = body();
    r.pairs[column][5] = 5;
    expect(issuePaths(r)).toContain(`pairs.${column}.5`);
  });
  it('rejects a count that is not an integer', () => {
    const r = body();
    r.pairs.selected[0] = 0.5;
    expect(issuePaths(r)).toEqual(['pairs.selected.0']);
  });
  it('rejects superseded on a verified figure', () => {
    const r = body();
    const j = verifiedAt(r);
    r.figures.superseded[j] = true;
    expect(issuePaths(r)).toEqual([`figures.superseded.${j}`]);
  });
  it('rejects a not-seen age on a calendar figure', () => {
    const r = body();
    const j = calendarAt(r);
    r.figures.notSeenInLatestAgeHours[j] = 3;
    expect(issuePaths(r)).toEqual([`figures.notSeenInLatestAgeHours.${j}`]);
  });
  it('rejects scope.cells above 50,000 (36,400 date pairs × 2 airport pairs)', () => {
    const r = encodeDatePairs(
      decoded({
        space: {
          departureFrom: asIsoDate('2027-01-01'),
          departureTo: asIsoDate('2028-02-04'),
          minNights: 0,
          maxNights: 90,
        },
        origins: ['LHR'],
        destinations: ['EWR', 'JFK'],
      }),
    );
    expect(r.scope.cells).toBe(72_800);
    expect(issuePaths(r)).toEqual(['scope.cells']);
  });

  it('accepts exactly 50,000 cells (250 days × 50 stays × 4 airport pairs)', () => {
    const r = encodeDatePairs(
      decoded({
        space: {
          departureFrom: asIsoDate('2027-01-01'),
          departureTo: asIsoDate('2027-09-07'),
          minNights: 0,
          maxNights: 49,
        },
      }),
    );
    expect(r.scope.cells).toBe(DEFAULT_MAX_CELLS);
    expect(issuePaths(r)).toEqual([]);
  });
  it('accepts a figure of 0 pence with no cheaper-cached price', () => {
    const r = body();
    const j = calendarAt(r);
    r.figures.pricePence[j] = 0;
    expect(issuePaths(r)).toEqual([]);
  });

  // brief §5's rules
  it.each([
    ['one too many', 1],
    ['one too few', -1],
  ])('rejects six buckets summing to anything but airportPairs (%s)', (_name, delta) => {
    const r = body();
    // date pair 5 has 1 priced, 1 no cached data and 2 not searched of 4
    r.pairs.notRun[5] = (r.pairs.notRun[5] ?? 0) + delta;
    expect(issuePaths(resum(r))).toEqual(['pairs.notRun.5']);
  });
  it('rejects six buckets summing to 0 (a cell without a discovery result is not searched, never absent)', () => {
    const r = body();
    for (const c of ['priced', 'empty', 'noData', 'error', 'skipped', 'notRun', 'reused'] as const)
      r.pairs[c][0] = 0;
    expect(issuePaths(resum(r))).toEqual(['pairs.notRun.0']);
  });
  it.each(['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run', 'reused'] as const)(
    'rejects summary.buckets.%s differing from the column sum',
    (bucket) => {
      const r = body();
      r.summary.buckets[bucket] += 1;
      expect(issuePaths(r)).toEqual([`summary.buckets.${bucket}`]);
    },
  );
  it.each(['reused', 'selected', 'itinerarySearched', 'onDemand'] as const)(
    'rejects summary.%s differing from the column sum',
    (field) => {
      const r = body();
      r.summary[field] += 1;
      expect(issuePaths(r)).toEqual([`summary.${field}`]);
    },
  );
  it('rejects summary.total differing from scope.cells', () => {
    const r = body();
    r.summary.total -= 1;
    expect(issuePaths(r)).toEqual(['summary.total']);
  });
  it('rejects unsorted or repeated scope airports', () => {
    const r = body();
    r.scope.origins.reverse();
    expect(issuePaths(r)).toEqual(['scope.origins']);
    const s = body();
    const [first] = s.scope.destinations;
    if (first !== undefined) s.scope.destinations[1] = first;
    expect(issuePaths(s)).toEqual(['scope.destinations']);
  });
  it('rejects airportPairs other than origins × destinations', () => {
    const r = body();
    r.scope.origins.pop();
    expect(issuePaths(r)).toContain('scope.airportPairs');
  });
  it('rejects cells other than days × stays × airportPairs', () => {
    const r = body();
    r.scope.cells += 4;
    r.summary.total += 4;
    expect(issuePaths(r)).toEqual(['scope.cells']);
  });
  it('rejects more than 36,400 date pairs', () => {
    const r = body();
    r.space = {
      departureFrom: asIsoDate('2027-01-01'),
      departureTo: asIsoDate('2028-02-05'),
      minNights: 0,
      maxNights: 90,
    };
    expect(issuePaths(r)).toContain('space');
  });
  it('rejects notReached above selected', () => {
    const r = body();
    r.pairs.selected[3] = 0;
    expect(issuePaths(resum(r))).toEqual(['pairs.notReached.3']);
  });
  it('rejects journeyLeftOut non-zero with no journey limit, and accepts it under one', () => {
    const r = body();
    r.pairs.journeyLeftOut[7] = 1;
    expect(issuePaths(r)).toEqual(['pairs.journeyLeftOut.7']);
    r.scope.maxJourneyMinutes = 600;
    expect(issuePaths(r)).toEqual([]);
  });
  // the sparse groups (revision 50): the worked example's cheaper-cached prices are on figures 0 and 4, its times on
  // figures 0, 2 and 4; figures 1, 3, 5, 6 and 7 are calendar figures
  it('the worked example has the sparse groups this file assumes', () => {
    const r = body();
    expect([r.cheaperCached.figure, r.times.figure]).toEqual([
      [0, 4],
      [0, 2, 4],
    ]);
    expect(r.figures.basis.map((b) => b[0])).toEqual(['v', 'c', 'v', 'c', 'v', 'c', 'c', 'c']);
  });
  it('rejects sparse-group columns of different lengths', () => {
    const r = body();
    r.cheaperCached.provenance.pop();
    expect(issuePaths(r)).toEqual(['cheaperCached.provenance']);
    const s = body();
    s.times.departOut.pop();
    expect(issuePaths(s)).toEqual(['times.departOut']);
  });
  it.each(['cheaperCached', 'times'] as const)(
    'rejects a %s figure index not strictly ascending',
    (group) => {
      const r = body();
      r[group].figure[1] = r[group].figure[0] ?? 0;
      expect(issuePaths(r)).toEqual([`${group}.figure.1`]);
    },
  );
  it.each(['cheaperCached', 'times'] as const)('rejects a %s figure index that names no figure', (group) => {
    const r = body();
    const last = r[group].figure.length - 1;
    r[group].figure[last] = r.figures.pair.length;
    expect(issuePaths(r)).toEqual([`${group}.figure.${last}`]);
  });
  it('rejects a cheaper-cached price on a calendar figure', () => {
    const r = body();
    r.cheaperCached.figure[0] = 1;
    expect(issuePaths(r)).toEqual(['cheaperCached.figure.0']);
  });
  it('rejects times on a calendar figure', () => {
    const r = body();
    r.times.figure[1] = 1;
    expect(issuePaths(r)).toEqual(['times.figure.1']);
  });
  it("rejects a cheaper-cached price not below the figure's price", () => {
    const r = body();
    r.cheaperCached.pricePence[1] = r.figures.pricePence[4] ?? 0;
    expect(issuePaths(r)).toEqual(['cheaperCached.pricePence.1']);
  });
  it('rejects a times entry holding no time', () => {
    const r = body();
    for (const c of TIMES) r.times[c][2] = null;
    expect(issuePaths(r)).toEqual(['times.departOut.2']);
  });
  it.each(TIMES)('accepts a times entry holding %s alone', (kept) => {
    const r = body();
    for (const c of TIMES) if (c !== kept) r.times[c][2] = null;
    expect(issuePaths(r)).toEqual([]);
  });
  it('rejects truncated on a verified figure', () => {
    const r = body();
    const j = verifiedAt(r);
    r.figures.truncated[j] = true;
    expect(issuePaths(r)).toEqual([`figures.truncated.${j}`]);
  });
  it.each([31_200.5, -1])('rejects money that is not integer pence (%d)', (pence) => {
    const r = body();
    r.figures.pricePence[0] = pence;
    // why: zod runs the refinement after a continuable issue (a minimum), which may then add its own
    expect(issuePaths(r)).toContain('figures.pricePence.0');
    const s = body();
    s.cheaperCached.pricePence[0] = pence;
    expect(issuePaths(s)).toContain('cheaperCached.pricePence.0');
  });
  it('rejects an unknown key (strict)', () => {
    expect(issuePaths({ ...body(), extra: 1 })).toEqual(['']);
    expect(issuePaths({ ...body(), figures: { ...body().figures, extra: [] } })).toEqual(['figures']);
    expect(issuePaths({ ...body(), times: { ...body().times, extra: [] } })).toEqual(['times']);
  });
  it('reports one custom issue per rule, at the first offending index', () => {
    const r = body();
    r.pairs.journeyLeftOut[2] = 1;
    r.pairs.journeyLeftOut[9] = 1;
    expect(issuePaths(r)).toEqual(['pairs.journeyLeftOut.2']);
    expect(datePairsResponseSchema.safeParse(r).error?.issues.map((i) => i.code)).toEqual(['custom']);
  });
  it('accepts a draft definition (no airports) and an expired window (no date pairs)', () => {
    expect(issuePaths(encodeDatePairs(decoded({ origins: [], destinations: [] })))).toEqual([]);
    const expired = encodeDatePairs(
      decoded({
        space: {
          departureFrom: asIsoDate('2027-03-15'),
          departureTo: asIsoDate('2027-03-14'),
          minNights: 10,
          maxNights: 11,
        },
      }),
    );
    expect(expired.pairs.priced).toEqual([]);
    expect(issuePaths(expired)).toEqual([]);
  });
});

describe('datePairsQuerySchema (spec §10: the wire form, parsed and answered 422 by the api)', () => {
  it('accepts the three strings, each optional', () => {
    const q = { origins: 'LHR,LGW', destinations: 'JFK', maxJourneyMinutes: '600' };
    expect(datePairsQuerySchema.parse(q)).toEqual(q);
    expect(datePairsQuerySchema.parse({})).toEqual({});
    // why: the api answers 422 for a value that is not one of the definition's codes or not 60..6000, not the schema
    expect(datePairsQuerySchema.parse({ maxJourneyMinutes: 'abc' })).toEqual({ maxJourneyMinutes: 'abc' });
  });
  it('rejects an unknown key and an unbounded value', () => {
    expect(datePairsQuerySchema.safeParse({ basis: 'verified' }).success).toBe(false);
    expect(datePairsQuerySchema.safeParse({ origins: 'A'.repeat(201) }).success).toBe(false);
    expect(datePairsQuerySchema.safeParse({ maxJourneyMinutes: '1'.repeat(11) }).success).toBe(false);
  });
});

describe("datePairFigureSchema (the detail's figure, the board's less its airport pair)", () => {
  const { airportPair: _a, ...figure } = verifiedFigure({ notSeenInLatest: { ageHours: 4 } });
  const cheaper = (pricePence: number) => ({
    pricePence,
    provenance: figure.price.provenance,
    stale: false,
    truncated: false,
    origin: 'LGW',
    destination: 'EWR',
  });
  it('parses a verified figure with inline provenance', () => {
    expect(datePairFigureSchema.parse(figure)).toEqual(figure);
  });
  /** The verified figure's times cleared, so a calendar case breaks only the rule it names. */
  const noTimes = { departOut: null, arriveOut: null, departBack: null, arriveBack: null };
  const calendar = { ...figure, ...noTimes, basis: 'calendar', notSeenInLatest: null };
  it('parses a calendar figure with no local times', () => {
    expect(datePairFigureSchema.parse(calendar)).toEqual(calendar);
  });
  it.each([
    ['superseded on a verified figure', { superseded: true }, 'superseded'],
    ['truncated on a verified figure', { price: { ...figure.price, truncated: true } }, 'price.truncated'],
    ['a not-seen age on a calendar figure', { ...noTimes, basis: 'calendar' }, 'notSeenInLatest'],
    [
      'a cheaper-cached price on a calendar figure',
      { ...calendar, cheaperCached: cheaper(1) },
      'cheaperCached',
    ],
    // why: §10 refuses times on a calendar figure; the board's `times` group refuses them too, so the two encodings
    // of one figure accept the same shapes (an "arrives HH:MM" beside a price whose constraints were never checked)
    ...(['departOut', 'arriveOut', 'departBack', 'arriveBack'] as const).map(
      (k) => [`a local time (${k}) on a calendar figure`, { ...calendar, [k]: '08:15' }, k] as const,
    ),
    [
      "a cheaper-cached price not below the figure's",
      { cheaperCached: cheaper(figure.price.pricePence) },
      'cheaperCached.pricePence',
    ],
    ['an airport pair index', { airportPair: 3 }, ''],
  ] as const)('rejects %s', (_name, over, path) => {
    const r = datePairFigureSchema.safeParse({ ...figure, ...over });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual([path]);
    // why: zod puts "Invalid input" in place of an empty message; each rule says what is wrong
    for (const i of r.error?.issues ?? []) expect(i.message).toMatch(/^(?!Invalid input$).*\w{4,}/);
  });
});

/** The worked example with a pairing figure at date pair 1 and a calendar figure with a pairing beneath at 3. */
const withPairing = (lead: Partial<DatePairFigure> = {}): DatePairsResponse => {
  const x = decoded({
    pair: (i, a) =>
      i === 1
        ? {
            buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: a - 1, reused: 0 },
            figure: pairingFigure(lead),
          }
        : i === 3
          ? {
              buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: a - 1, reused: 0 },
              figure: calendarFigure({
                pairingRead: 'within-older',
                pairing: figurePairing({ stale: 'refresh' }),
              }),
            }
          : i === 5
            ? {
                buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: a - 1, reused: 0 },
                figure: verifiedFigure(),
              }
            : {},
  });
  return structuredClone(encodeDatePairs(x));
};
/** The response's sparse group, which the codec always writes. */
function groupOf<K extends 'gridPrice' | 'pairing' | 'pairingRead' | 'listReason'>(
  r: DatePairsResponse,
  k: K,
): NonNullable<DatePairsResponse[K]> {
  const g = r[k];
  if (g === undefined || g === null) throw new Error(`no ${k} group`);
  return g;
}

describe('datePairsResponseSchema: the pairing figure (spec rev 56 §10)', () => {
  it("takes basis 'pairing', a gridPrice entry for it and a pairing entry for it and for a calendar figure beneath", () => {
    const r = withPairing();
    expect(issuePaths(r)).toEqual([]);
    expect(r.figures.basis).toEqual(['pairing', 'calendar', 'verified']);
    // why: R-sparse: codes by PAIRING_READ's order, an entry only for a read other than not-read
    expect(r.pairingRead).toEqual({ figure: [0, 1], code: [6, 7] });
    expect(groupOf(r, 'gridPrice').figure).toEqual([0]);
    expect(groupOf(r, 'pairing').figure).toEqual([0, 1]);
  });
  it('a body without the new column and groups parses (an older api)', () => {
    const { gridPrice: _g, pairing: _p, pairingRead: _r, ...older } = body();
    expect(issuePaths(older)).toEqual([]);
  });
  it('pairingRead (sparse): columns of one length, figure ascending and in range, a code of 1 to 9', () => {
    const ragged = withPairing();
    groupOf(ragged, 'pairingRead').code.pop();
    expect(issuePaths(ragged)).toEqual(['pairingRead.code']);
    const order = withPairing();
    groupOf(order, 'pairingRead').figure = [1, 0];
    groupOf(order, 'pairingRead').code = [7, 6];
    expect(issuePaths(order)).toContain('pairingRead.figure.1');
    const past = withPairing();
    groupOf(past, 'pairingRead').figure[1] = 3;
    expect(issuePaths(past)).toContain('pairingRead.figure.1');
    const notRead = withPairing();
    groupOf(notRead, 'pairingRead').code[1] = 0;
    expect(issuePaths(notRead)).toEqual(['pairingRead.code.1']);
    const unknown = withPairing();
    groupOf(unknown, 'pairingRead').code[1] = 10;
    expect(issuePaths(unknown)).toEqual(['pairingRead.code.1']);
    const fraction = withPairing();
    groupOf(fraction, 'pairingRead').code[1] = 6.5;
    expect(issuePaths(fraction)).toEqual(['pairingRead.code.1']);
  });
  it('within exactly on a pairing figure (a figure with no entry reads not-read)', () => {
    const within = withPairing();
    groupOf(within, 'pairingRead').figure = [0, 1, 2];
    groupOf(within, 'pairingRead').code = [6, 7, 6];
    expect(issuePaths(within)).toEqual(['pairingRead.code.2']);
    const notWithin = withPairing();
    groupOf(notWithin, 'pairingRead').code[0] = 7;
    expect(issuePaths(notWithin)).toEqual(['pairingRead.code.0']);
    const calendarWithin = withPairing();
    groupOf(calendarWithin, 'pairingRead').code[1] = 6;
    expect(issuePaths(calendarWithin)).toEqual(['pairingRead.code.1', 'pairing.figure.1']);
    expect(PAIRING_READ.indexOf('within')).toBe(6);
  });
  it('a pairing figure in a body without the gridPrice or the pairing group is refused', () => {
    const { gridPrice: _g, ...noGrid } = withPairing();
    expect(issuePaths(noGrid)).toEqual(['gridPrice']);
    const { pairing: _p, ...noPairing } = withPairing();
    expect(issuePaths(noPairing)).toEqual(['pairing']);
  });
  it('a pairing figure without its pairingRead entry, or without the group, is refused (absent reads not-read)', () => {
    const { pairingRead: _r, ...noGroup } = withPairing();
    // why: read as not-read, the calendar figure's pairing beneath (within-older) has no read to stand on either
    expect(issuePaths(noGroup)).toEqual(['pairingRead', 'pairing.figure.1']);
    const missing = withPairing();
    groupOf(missing, 'pairingRead').figure = [1];
    groupOf(missing, 'pairingRead').code = [7];
    expect(issuePaths(missing)).toEqual(['pairingRead.figure']);
  });
  it('gridPrice: exactly the pairing figures, figure strictly ascending, in range, its provenance in the table', () => {
    const none = withPairing();
    groupOf(none, 'gridPrice').figure = [];
    for (const k of ['pricePence', 'provenance', 'stale', 'truncated'] as const)
      groupOf(none, 'gridPrice')[k] = [];
    expect(issuePaths(none)).toEqual(['gridPrice.figure']);
    const onCalendar = withPairing();
    groupOf(onCalendar, 'gridPrice').figure = [1];
    expect(issuePaths(onCalendar)).toEqual(['gridPrice.figure']);
    const past = withPairing();
    groupOf(past, 'gridPrice').figure = [3];
    expect(issuePaths(past)).toEqual(['gridPrice.figure.0']);
    const provenance = withPairing();
    groupOf(provenance, 'gridPrice').provenance = [99];
    expect(issuePaths(provenance)).toEqual(['gridPrice.provenance.0']);
    const ragged = withPairing();
    groupOf(ragged, 'gridPrice').stale = [];
    expect(issuePaths(ragged)).toEqual(['gridPrice.stale']);
    const raggedPairing = withPairing();
    groupOf(raggedPairing, 'pairing').mismatch = [];
    expect(issuePaths(raggedPairing)).toEqual(['pairing.mismatch']);
  });
  it('pairing: the pairing figure has an entry (an offer\'s or a "from" price); none on a verified figure', () => {
    expect(issuePaths(withPairing({ pairing: null }))).toEqual(['pairing.figure']);
    // why: design 2026-11-08 §4.1: a leading pairing may carry the return's "from" price (no seller), with its offers read
    // as read (none, or some not complete)
    for (const offersRead of [0, 2]) {
      const isFrom = withPairing();
      groupOf(isFrom, 'pairing').isFrom[0] = true;
      groupOf(isFrom, 'pairing').seller[0] = null;
      groupOf(isFrom, 'pairing').offersRead[0] = offersRead;
      groupOf(isFrom, 'pairing').complete[0] = false;
      expect(issuePaths(isFrom)).toEqual([]);
    }
    const onVerified = withPairing();
    groupOf(onVerified, 'pairing').figure[1] = 2;
    // why: final review B-M5: figure 1's within-older read then names a pairing the group no longer holds
    expect(issuePaths(onVerified)).toEqual(['pairing.figure.1', 'pairingRead.code.1']);
    const order = withPairing();
    groupOf(order, 'pairing').figure = [1, 0];
    expect(issuePaths(order)).toContain('pairing.figure.1');
  });
  it('prov-001: a pairing figure is complete, within the limits, carries its stale mark, read from an offer, priced and sourced as its figure', () => {
    const pairingAt = (r: DatePairsResponse) => groupOf(r, 'pairing');
    const incomplete = withPairing();
    pairingAt(incomplete).complete[0] = false;
    expect(issuePaths(incomplete)).toEqual(['pairing.complete.0']);
    // why: design 2026-11-08 §4.1: an offer shown beneath a calendar figure is of complete offers too, so an
    // incomplete one (entry 1) is refused by the beneath rule, not the leading one
    const incompleteBeneath = withPairing();
    pairingAt(incompleteBeneath).complete[1] = false;
    expect(issuePaths(incompleteBeneath)).toEqual(['pairing.complete.1']);
    const overLimit = withPairing();
    pairingAt(overLimit).which[0] = 'over-limit';
    expect(issuePaths(overLimit)).toEqual(['pairing.which.0']);
    const stale = withPairing();
    pairingAt(stale).stale[0] = 'refresh';
    expect(issuePaths(stale)).toEqual(['pairing.stale.0']);
    const staleFigure = withPairing();
    staleFigure.figures.stale[0] = 'refresh';
    expect(issuePaths(staleFigure)).toEqual(['pairing.stale.0']);
    // why: spec rev 62: an older pairing still leads, the figure carrying the list's stale mark
    const older = withPairing();
    pairingAt(older).stale[0] = 'refresh';
    older.figures.stale[0] = 'refresh';
    expect(issuePaths(older)).toEqual([]);
    const noOffers = withPairing();
    pairingAt(noOffers).offersRead[0] = 0;
    expect(issuePaths(noOffers)).toEqual(['pairing.offersRead.0']);
    const priced = withPairing();
    pairingAt(priced).pricePence[0] = 117_999;
    // why: Task 21.7: the offer then differs from the return's "from" price, which the mismatch mark must say
    pairingAt(priced).mismatch[0] = true;
    expect(issuePaths(priced)).toEqual(['pairing.pricePence.0']);
    // why: the figure's provenance is the flight list's, the pairing's one table entry
    const sourced = withPairing();
    const calendarProvenance = columnOf(sourced.figures.provenance, 1);
    pairingAt(sourced).provenance[0] = calendarProvenance;
    expect(issuePaths(sourced)).toEqual(['pairing.provenance.0']);
    const notList = withPairing();
    notList.figures.provenance[0] = calendarProvenance;
    pairingAt(notList).provenance[0] = calendarProvenance;
    expect(issuePaths(notList)).toEqual(['pairing.provenance.0']);
    // why: another flight list's provenance is still not the figure's own
    const otherList = withPairing();
    const own = columnOf(otherList.provenances, columnOf(otherList.figures.provenance, 0));
    pairingAt(otherList).provenance[0] =
      otherList.provenances.push({ ...own, fetchedAt: asIsoDateTime('2027-03-01T08:00:00.000Z') }) - 1;
    expect(issuePaths(otherList)).toEqual(['pairing.provenance.0']);
    // why: both halves of "a flight list": the browser worker's, and its own page (never a synthetic copy)
    for (const over of [{ sourceKind: 'synthetic' as const }, { providerId: 'fixture' as const }]) {
      const half = withPairing();
      const at = half.provenances.push({ ...own, ...over }) - 1;
      half.figures.provenance[0] = at;
      pairingAt(half).provenance[0] = at;
      expect(issuePaths(half), JSON.stringify(over)).toEqual(['pairing.provenance.0']);
    }
    const one = withPairing();
    pairingAt(one).offersRead[0] = 1;
    expect(issuePaths(one)).toEqual([]);
    // why: an index just past the table is the group's own refusal, never also a source mismatch
    const past = withPairing();
    pairingAt(past).provenance[0] = past.provenances.length;
    expect(issuePaths(past)).toEqual(['pairing.provenance.0']);
  });
  it('prov-001: a "from" price is never complete, whether no offer was read or not every seller was (design 2026-11-08)', () => {
    const offers = withPairing();
    groupOf(offers, 'pairing').isFrom[1] = true;
    groupOf(offers, 'pairing').seller[1] = null;
    groupOf(offers, 'pairing').complete[1] = false;
    expect(issuePaths(offers)).toEqual([]);
    const complete = withPairing();
    groupOf(complete, 'pairing').isFrom[1] = true;
    groupOf(complete, 'pairing').seller[1] = null;
    groupOf(complete, 'pairing').offersRead[1] = 0;
    expect(issuePaths(complete)).toEqual(['pairing.complete.1']);
  });
  it('Task 21.7: the pairing group carries the return\'s "from" price; a mismatch exactly when an offer differs from it', () => {
    const ok = withPairing();
    expect(groupOf(ok, 'pairing').fromPence).toEqual([118_000, 118_000]);
    expect(issuePaths(ok)).toEqual([]);
    const differs = withPairing();
    groupOf(differs, 'pairing').fromPence[1] = 117_500;
    expect(issuePaths(differs)).toEqual(['pairing.mismatch.1']);
    groupOf(differs, 'pairing').mismatch[1] = true;
    expect(issuePaths(differs)).toEqual([]);
    const from = withPairing();
    groupOf(from, 'pairing').isFrom[1] = true;
    groupOf(from, 'pairing').seller[1] = null;
    groupOf(from, 'pairing').offersRead[1] = 0;
    groupOf(from, 'pairing').complete[1] = false;
    groupOf(from, 'pairing').fromPence[1] = 117_500;
    expect(issuePaths(from)).toEqual(['pairing.fromPence.1']);
    // why: 21.7 code M11: the column refinement pinned both ways: a mismatch on an offer equal to its "from" price, and
    // a mismatch on a "from" price, are each refused
    const same = withPairing();
    groupOf(same, 'pairing').mismatch[1] = true;
    expect(issuePaths(same)).toEqual(['pairing.mismatch.1']);
    const fromMismatch = withPairing();
    groupOf(fromMismatch, 'pairing').isFrom[1] = true;
    groupOf(fromMismatch, 'pairing').seller[1] = null;
    groupOf(fromMismatch, 'pairing').offersRead[1] = 0;
    groupOf(fromMismatch, 'pairing').complete[1] = false;
    groupOf(fromMismatch, 'pairing').mismatch[1] = true;
    expect(issuePaths(fromMismatch)).toEqual(['pairing.mismatch.1']);
  });
  it("21.7 prov-012: every pairing entry, beneath a figure too, carries a flight list's provenance", () => {
    const beneath = withPairing();
    // why: entry 1 is shown beneath a calendar figure; that figure's own (date-grid) provenance is no flight list's
    groupOf(beneath, 'pairing').provenance[1] = columnOf(beneath.figures.provenance, 1);
    expect(issuePaths(beneath)).toEqual(['pairing.provenance.1']);
  });
  it('the 21.6 ruling: a failed list reads list-failed with its cause, an entry exactly for each such figure', () => {
    const failed = (): DatePairsResponse =>
      structuredClone(
        encodeDatePairs(
          decoded({
            pair: (i, a) =>
              i === 3
                ? {
                    buckets: {
                      priced: 1,
                      empty: 0,
                      no_data: 0,
                      error: 0,
                      skipped: 0,
                      not_run: a - 1,
                      reused: 0,
                    },
                    figure: calendarFigure({ pairingRead: 'list-failed', listReason: 'network' }),
                  }
                : {},
          }),
        ),
      );
    const r = failed();
    expect(issuePaths(r)).toEqual([]);
    expect(r.pairingRead).toEqual({ figure: [0], code: [9] });
    expect(r.listReason).toEqual({ figure: [0], reason: ['network'] });
    const { listReason: _l, ...noGroup } = failed();
    expect(issuePaths(noGroup)).toEqual(['listReason']);
    const missing = failed();
    groupOf(missing, 'listReason').figure = [];
    groupOf(missing, 'listReason').reason = [];
    expect(issuePaths(missing)).toEqual(['listReason.figure']);
    const notFailed = failed();
    groupOf(notFailed, 'pairingRead').code[0] = 1;
    expect(issuePaths(notFailed)).toEqual(['listReason.figure']);
    const ragged = failed();
    groupOf(ragged, 'listReason').reason = [];
    expect(issuePaths(ragged)).toEqual(['listReason.reason']);
    const word = failed();
    Reflect.set(groupOf(word, 'listReason').reason, 0, 'the page said no');
    expect(issuePaths(word)).toEqual(['listReason.reason.0']);
    const past = failed();
    groupOf(past, 'listReason').figure[0] = 5;
    // why: an entry that names no figure is its own refusal, never also an inexact set
    expect(issuePaths(past)).toEqual(['listReason.figure.0']);
  });
  it('ruling 21.2: a pairing beneath a stale verified figure for the five reads; never beneath a fresh one', () => {
    const staleVerified = (stale: false | 'refresh'): DatePairsResponse =>
      structuredClone(
        encodeDatePairs(
          decoded({
            pair: (i, a) =>
              i === 5
                ? {
                    buckets: {
                      priced: 1,
                      empty: 0,
                      no_data: 0,
                      error: 0,
                      skipped: 0,
                      not_run: a - 1,
                      reused: 0,
                    },
                    figure: verifiedFigure({
                      price: { ...verifiedFigure().price, stale },
                      pairingRead: 'within-older',
                      pairing: figurePairing({ stale: 'refresh' }),
                    }),
                  }
                : {},
          }),
        ),
      );
    expect(issuePaths(staleVerified('refresh'))).toEqual([]);
    expect(issuePaths(staleVerified(false))).toEqual(['pairing.figure.0']);
    const notBeneath = staleVerified('refresh');
    groupOf(notBeneath, 'pairingRead').code[0] = 1;
    expect(issuePaths(notBeneath)).toEqual(['pairing.figure.0']);
  });
  // why: final review B-M5: the board's group, as datePairFigureSchema: entry 1 (within-older) must be stale, and a
  // beneath read needs its pairing entry
  it('a pairing entry beneath agrees with its read; a beneath read needs its entry', () => {
    const fresh = withPairing();
    groupOf(fresh, 'pairing').stale[1] = false;
    expect(issuePaths(fresh)).toEqual(['pairing.stale.1']);
    // why: figure 1's entry (the calendar figure's pairing beneath, read within-older) taken out of every column
    const missing = withPairing();
    const q = groupOf(missing, 'pairing');
    for (const column of Object.values(q)) column.splice(1, 1);
    expect(issuePaths(missing)).toEqual(['pairingRead.code.1']);
  });
  it('pairing beneath a calendar figure only for the five "shown beneath" reads', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').code[1] = 1;
    expect(issuePaths(r)).toEqual(['pairing.figure.1']);
  });
  it('a seller exactly when the price is not a "from" price; the seller is bounded page text; times are HH:MM', () => {
    /** Entry 1 made a "from" price that read no offer, so a case breaks only the rule it names. */
    const asFrom = (r: DatePairsResponse): DatePairsResponse => {
      groupOf(r, 'pairing').isFrom[1] = true;
      groupOf(r, 'pairing').offersRead[1] = 0;
      groupOf(r, 'pairing').complete[1] = false;
      return r;
    };
    const fromWithSeller = asFrom(withPairing());
    expect(issuePaths(fromWithSeller)).toEqual(['pairing.seller.1']);
    const noSeller = withPairing();
    groupOf(noSeller, 'pairing').seller[1] = null;
    expect(issuePaths(noSeller)).toEqual(['pairing.seller.1']);
    const long = withPairing();
    groupOf(long, 'pairing').seller[1] = 'Q'.repeat(81);
    expect(issuePaths(long)).toEqual(['pairing.seller.1']);
    const fare = asFrom(withPairing());
    groupOf(fare, 'pairing').seller[1] = null;
    groupOf(fare, 'pairing').fare[1] = 'Economy Basic';
    expect(issuePaths(fare)).toEqual(['pairing.fare.1']);
    const time = withPairing();
    groupOf(time, 'pairing').departOut[0] = '7:15';
    expect(issuePaths(time)).toEqual(['pairing.departOut.0']);
    const provenance = withPairing();
    groupOf(provenance, 'pairing').provenance[0] = 99;
    expect(issuePaths(provenance)).toEqual(['pairing.provenance.0']);
  });
  it("the times group stays for verified figures (a pairing figure's times ride in its pairing entry)", () => {
    const r = withPairing();
    r.times = {
      figure: [0],
      departOut: ['07:15'],
      arriveOut: [null],
      departBack: [null],
      arriveBack: [null],
    };
    expect(issuePaths(r)).toEqual(['times.figure.0']);
  });
  it('36,400 date pairs, every one with a figure, a few hundred of them read, stay within 4 MiB (R-sparse)', () => {
    const space = {
      departureFrom: asIsoDate('2027-01-01'),
      departureTo: asIsoDate('2028-02-04'),
      minNights: 0,
      maxNights: 90,
    };
    const priced = { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
    const board = (reads: boolean) =>
      decoded({
        space,
        origins: ['LHR'],
        destinations: ['JFK'],
        pair: (i) => ({
          buckets: priced,
          figure: !reads
            ? calendarFigure({ airportPair: 0 })
            : i % 120 === 0
              ? pairingFigure({ airportPair: 0 })
              : i % 120 === 1
                ? calendarFigure({
                    airportPair: 0,
                    pairingRead: 'offers-incomplete',
                    pairing: figurePairing({}),
                  })
                : i % 120 === 2
                  ? calendarFigure({ airportPair: 0, pairingRead: 'outbound-only' })
                  : calendarFigure({ airportPair: 0 }),
        }),
      });
    const x = board(true);
    expect(x.pairs).toHaveLength(MAX_DATE_PAIRS);
    const wire = encodeDatePairs(x);
    expect(issuePaths(wire)).toEqual([]);
    expect(wire.pairingRead?.figure).toHaveLength(3 * Math.ceil(MAX_DATE_PAIRS / 120));
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    expect(bytes(wire)).toBeLessThanOrEqual(4 * 1024 * 1024);
    // why: the api's worst-case body (richer provenance than these fixtures) sits about 380 KB under 4 MiB without
    // the reads, so the three sparse groups of ~900 reads must cost well under that
    expect(bytes(wire) - bytes(encodeDatePairs(board(false)))).toBeLessThan(200 * 1024);
  });
});

describe("datePairFigureSchema: basis 'pairing', gridPrice, pairing and pairingRead (spec rev 56 §10)", () => {
  const { airportPair: _p, ...pairing } = pairingFigure();
  const { airportPair: _c, ...calendar } = calendarFigure();
  const r = (v: unknown) => datePairFigureSchema.safeParse(v);
  const paths = (v: unknown) => {
    const x = r(v);
    return x.success ? [] : x.error.issues.map((i) => i.path.join('.'));
  };
  it('accepts a pairing figure with its grid price, pairing and pairingRead; refuses a figure without them (Task 21.7)', () => {
    expect(r(pairing).error?.issues ?? []).toEqual([]);
    const { gridPrice: _g, pairing: _q, pairingRead: _r, ...older } = calendar;
    expect(r(older).success).toBe(false);
    const { listReason: _l, ...noReason } = calendar;
    expect(r(noReason).success).toBe(false);
    expect(
      r({ ...calendar, pairingRead: 'within-older', pairing: figurePairing({ stale: 'refresh' }) }).success,
    ).toBe(true);
  });
  it('prov-001: a pairing figure is complete, within the limits, carries its stale mark, read from an offer, priced and sourced as its figure', () => {
    expect(paths({ ...pairing, pairing: figurePairing({ complete: false }) })).toEqual(['pairing.complete']);
    expect(paths({ ...pairing, pairing: figurePairing({ which: 'over-limit' }) })).toEqual(['pairing.which']);
    expect(paths({ ...pairing, pairing: figurePairing({ stale: 'refresh' }) })).toEqual(['pairing.stale']);
    expect(paths({ ...pairing, price: { ...pairing.price, stale: 'refresh' } })).toEqual(['pairing.stale']);
    // why: spec rev 62: an older pairing still leads, the figure carrying the list's stale mark
    expect(
      paths({
        ...pairing,
        price: { ...pairing.price, stale: 'refresh' },
        pairing: figurePairing({ stale: 'refresh' }),
      }),
    ).toEqual([]);
    expect(paths({ ...pairing, pairing: figurePairing({ offersRead: 0 }) })).toEqual(['pairing.offersRead']);
    expect(paths({ ...pairing, pairing: figurePairing({ offersRead: 1 }) })).toEqual([]);
    expect(paths({ ...pairing, pairing: figurePairing({ pricePence: 117_999, mismatch: true }) })).toEqual([
      'pairing.pricePence',
    ]);
    const other = { ...pairing.price.provenance, fetchedAt: asIsoDateTime('2027-03-01T09:31:00.000Z') };
    expect(paths({ ...pairing, pairing: figurePairing({ provenance: other }) })).toEqual([
      'pairing.provenance',
    ]);
    const grid = calendar.price.provenance;
    expect(
      paths({
        ...pairing,
        price: { ...pairing.price, provenance: grid },
        pairing: figurePairing({ provenance: grid }),
      }),
    ).toEqual(['pairing.provenance']);
  });
  it('prov-001: a "from" price is never complete, whether no offer was read or not every seller was (design 2026-11-08)', () => {
    const from = { isFrom: true, seller: null } as const;
    const beneath = { ...calendar, pairingRead: 'sellers-not-read' as const };
    expect(
      paths({ ...beneath, pairing: figurePairing({ ...from, offersRead: 0, complete: false }) }),
    ).toEqual([]);
    expect(
      paths({ ...beneath, pairing: figurePairing({ ...from, offersRead: 2, complete: false }) }),
    ).toEqual([]);
    expect(paths({ ...beneath, pairing: figurePairing({ ...from, offersRead: 0, complete: true }) })).toEqual(
      ['pairing.complete'],
    );
  });
  // why: final review B-M5: a pairing shown beneath its figure says what its read says, and a "beneath" read has one
  it('a pairing beneath agrees with its read; a beneath read needs its pairing', () => {
    const under = (read: string, over: Partial<DatePairPairing>) =>
      paths({ ...calendar, pairingRead: read, pairing: figurePairing(over) });
    const from = { isFrom: true, seller: null, offersRead: 0, complete: false } as const;
    expect(under('over-limit', { which: 'over-limit' })).toEqual([]);
    expect(under('over-limit', {})).toEqual(['pairing.which']);
    // why: a list read under other limits reads within-other-limits whether or not it is over today's (B-M2)
    expect(under('within-other-limits', { which: 'over-limit' })).toEqual([]);
    expect(under('within-older', { which: 'over-limit', stale: 'refresh' })).toEqual(['pairing.which']);
    expect(under('within-older', { stale: 'refresh' })).toEqual([]);
    expect(under('within-older', {})).toEqual(['pairing.stale']);
    expect(under('sellers-not-read', from)).toEqual([]);
    // why: design 2026-11-08 §4.1: these two reads are never produced now; the beneath rule keeps only the fresh mark
    // for them, and no longer says which price the pairing carries
    expect(under('sellers-not-read', { ...from, stale: 'refresh' })).toEqual(['pairing.stale']);
    // why: design 2026-11-08 §4.1: an offer's price, beneath a figure too, is of complete offers only
    expect(under('sellers-not-read', { complete: false })).toEqual(['pairing.complete']);
    expect(under('offers-incomplete', { complete: false })).toEqual(['pairing.complete']);
    expect(under('offers-incomplete', {})).toEqual([]);
    expect(paths({ ...calendar, pairingRead: 'over-limit', pairing: null })).toEqual(['pairing']);
  });
  it("21.7 prov-012: a pairing shown beneath a figure carries a flight list's provenance", () => {
    const beneath = { ...calendar, pairingRead: 'offers-incomplete' as const };
    expect(
      paths({
        ...beneath,
        pairing: figurePairing({ provenance: calendar.price.provenance }),
      }),
    ).toEqual(['pairing.provenance']);
  });
  it('Task 21.7: fromPence is the return\'s "from" price, the figure\'s own when isFrom, unlike it exactly on a mismatch', () => {
    const beneath = { ...calendar, pairingRead: 'offers-incomplete' as const };
    const incomplete = {};
    expect(
      paths({ ...beneath, pairing: figurePairing({ ...incomplete, fromPence: 117_500, mismatch: true }) }),
    ).toEqual([]);
    expect(paths({ ...beneath, pairing: figurePairing({ ...incomplete, fromPence: 117_500 }) })).toEqual([
      'pairing.mismatch',
    ]);
    expect(paths({ ...beneath, pairing: figurePairing({ ...incomplete, mismatch: true }) })).toEqual([
      'pairing.mismatch',
    ]);
    const from = { isFrom: true, seller: null, offersRead: 0, complete: false } as const;
    expect(
      paths({
        ...calendar,
        pairingRead: 'sellers-not-read',
        pairing: figurePairing({ ...from, fromPence: 1 }),
      }),
    ).toEqual(['pairing.fromPence']);
  });
  it('the 21.6 ruling: a list reason exactly on a list-failed read', () => {
    expect(paths({ ...calendar, pairingRead: 'list-failed', listReason: 'network' })).toEqual([]);
    expect(paths({ ...calendar, pairingRead: 'list-failed', listReason: null })).toEqual(['listReason']);
    expect(paths({ ...calendar, pairingRead: 'list-failed' })).toEqual(['listReason']);
    expect(paths({ ...calendar, pairingRead: 'outbound-only', listReason: 'network' })).toEqual([
      'listReason',
    ]);
    expect(paths({ ...calendar, pairingRead: 'list-failed', listReason: 'no reason' })).toEqual([
      'listReason',
    ]);
  });
  it('a grid price exactly on a pairing figure; within exactly on one', () => {
    expect(paths({ ...pairing, gridPrice: null })).toEqual(['gridPrice']);
    expect(paths({ ...calendar, gridPrice: pairing.gridPrice })).toEqual(['gridPrice']);
    expect(paths({ ...pairing, pairingRead: 'within-older' })).toEqual(['pairingRead']);
    expect(paths({ ...calendar, pairingRead: 'within' })).toEqual(['pairingRead']);
    expect(paths({ ...pairing, pairing: null })).toEqual(['pairing']);
    // why: design 2026-11-08 §4.1: a leading pairing may be the return's "from" price, read or not
    expect(
      paths({
        ...pairing,
        pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }),
      }),
    ).toEqual([]);
    expect(
      paths({
        ...pairing,
        pairing: figurePairing({ isFrom: true, seller: null, offersRead: 3, complete: false }),
      }),
    ).toEqual([]);
    expect(paths({ ...calendar, pairing: figurePairing() })).toEqual(['pairing']);
    expect(
      paths({
        ...calendar,
        pairingRead: 'offers-incomplete',
        pairing: figurePairing({ seller: null }),
      }),
    ).toEqual(['pairing.seller']);
    expect(
      paths({
        ...calendar,
        pairingRead: 'sellers-not-read',
        pairing: figurePairing({
          isFrom: true,
          seller: null,
          fare: 'Economy Basic',
          offersRead: 0,
          complete: false,
        }),
      }),
    ).toEqual(['pairing.fare']);
    // why: the seller is page text held to flightTextSchema's rule, trimmed and whitespace collapsed (finding 6)
    expect(paths({ ...pairing, pairing: figurePairing({ seller: ' QQ Travel' }) })).toEqual([
      'pairing.seller',
    ]);
    expect(paths({ ...pairing, pairing: figurePairing({ fare: 'Economy  Basic' }) })).toEqual([
      'pairing.fare',
    ]);
    const { airportPair: _v, ...verified } = verifiedFigure();
    expect(paths({ ...verified, pairing: figurePairing() })).toEqual(['pairing']);
    // why: ruling 21.2: a stale verified figure whose pairing does not lead shows it beneath, as a calendar one does
    const beneath = { pairingRead: 'within-older' as const, pairing: figurePairing({ stale: 'refresh' }) };
    expect(paths({ ...verified, ...beneath })).toEqual(['pairing']);
    expect(paths({ ...verified, price: { ...verified.price, stale: 'refresh' }, ...beneath })).toEqual([]);
    expect(
      paths({
        ...verified,
        price: { ...verified.price, stale: 'refresh' },
        ...beneath,
        pairingRead: 'outbound-only',
      }),
    ).toEqual(['pairing']);
  });
});

/** Each issue's path, message and code, in the order reported. */
const issuesOf = (r: {
  error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }> };
}) => (r.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));

// why: the refinement reports each rule once (a `reported` set keyed by rule); a rule built per column, per group or
// per summary field is one rule each, so two of them broken are two issues, never folded into one
describe('datePairsResponseSchema: rules of one kind are reported each on its own', () => {
  it('two pairs columns of the wrong length are two issues', () => {
    const r = body();
    r.pairs.selected.pop();
    r.pairs.onDemand.pop();
    expect(issuePaths(r)).toEqual(['pairs.selected', 'pairs.onDemand']);
  });
  it('two counts above airportPairs, in two columns of one date pair, are two issues', () => {
    const r = body();
    r.pairs.priced[5] = 5;
    r.pairs.selected[5] = 5;
    expect(issuePaths(resum(r))).toEqual(expect.arrayContaining(['pairs.priced.5', 'pairs.selected.5']));
  });
  it('two summary fields off their column sums are two issues, each naming its field and the sum', () => {
    const r = body();
    const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
    r.summary.buckets.priced += 1;
    r.summary.onDemand += 1;
    expect(issuesOf(datePairsResponseSchema.safeParse(r))).toEqual([
      {
        path: 'summary.buckets.priced',
        message: `summary.buckets.priced must be the column sum (${sum(r.pairs.priced)})`,
        code: 'custom',
      },
      {
        path: 'summary.onDemand',
        message: `summary.onDemand must be the column sum (${sum(r.pairs.onDemand)})`,
        code: 'custom',
      },
    ]);
  });
  it('two figures columns of the wrong length are two issues', () => {
    const r = body();
    r.figures.origin.pop();
    r.figures.journeyMinutes.push(null);
    expect(issuePaths(r)).toEqual(['figures.origin', 'figures.journeyMinutes']);
  });
  it.each([
    [
      'not strictly ascending',
      (r: DatePairsResponse) => {
        r.cheaperCached.figure[1] = columnOf(r.cheaperCached.figure, 0);
        r.times.figure[1] = columnOf(r.times.figure, 0);
      },
      ['cheaperCached.figure.1', 'times.figure.1'],
    ],
    [
      'naming no figure',
      (r: DatePairsResponse) => {
        r.cheaperCached.figure[1] = r.figures.pair.length;
        r.times.figure[2] = r.figures.pair.length;
      },
      ['cheaperCached.figure.1', 'times.figure.2'],
    ],
    [
      'on a calendar figure',
      (r: DatePairsResponse) => {
        r.cheaperCached.figure[0] = 1;
        r.times.figure[1] = 1;
      },
      ['cheaperCached.figure.0', 'times.figure.1'],
    ],
  ] as const)('a cheaperCached and a times entry each %s are two issues', (_name, breakIt, paths) => {
    const r = body();
    breakIt(r);
    expect(issuePaths(r)).toEqual(paths);
  });
  it('a pairingRead and a pairing entry each naming no figure are two issues', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').figure[1] = 3;
    groupOf(r, 'pairing').figure[1] = 3;
    expect(issuePaths(r)).toEqual(expect.arrayContaining(['pairingRead.figure.1', 'pairing.figure.1']));
  });
  it('a pairingRead and a pairing entry each repeating the figure before it are two issues', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').figure[1] = 0;
    groupOf(r, 'pairing').figure[1] = 0;
    expect(issuePaths(r)).toEqual(expect.arrayContaining(['pairingRead.figure.1', 'pairing.figure.1']));
  });
  // why: one rule, `pairingSource`, whether the entry leads or sits beneath, so it is reported once, at its first entry
  it("a pairing's source off its flight list is one rule, reported at its first entry", () => {
    const r = withPairing();
    const calendarProvenance = columnOf(r.figures.provenance, 1);
    groupOf(r, 'pairing').provenance[0] = calendarProvenance;
    groupOf(r, 'pairing').provenance[1] = calendarProvenance;
    expect(issuesOf(datePairsResponseSchema.safeParse(r))).toEqual([
      {
        path: 'pairing.provenance.0',
        message: "a pairing figure's provenance is its flight list's",
        code: 'custom',
      },
    ]);
  });
});

describe('datePairsResponseSchema: the sparse groups at their edges', () => {
  it('a pairing group entry repeating the figure before it is refused (strictly ascending)', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').figure = [0, 0];
    groupOf(r, 'pairingRead').code = [6, 6];
    expect(issuePaths(r)).toEqual(['pairingRead.figure.1', 'pairing.figure.1']);
  });
  it('a gridPrice provenance index equal to the table length is refused', () => {
    const r = withPairing();
    groupOf(r, 'gridPrice').provenance[0] = r.provenances.length;
    expect(issuePaths(r)).toEqual(['gridPrice.provenance.0']);
  });
  // why: an entry naming no figure leaves the group out of order, so a pairing figure's missing read is not inferred
  // from it (the entry may have meant that figure)
  it('a pairingRead entry naming no figure is refused alone, never also as a missing read', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').figure[0] = 3;
    expect(issuePaths(r)).not.toContain('pairingRead.figure');
    expect(issuePaths(r)).toContain('pairingRead.figure.0');
  });
  it('a pairing entry naming no figure is refused alone, never also as a missing entry', () => {
    const r = withPairing();
    groupOf(r, 'pairing').figure[0] = 3;
    const paths = issuePaths(r);
    expect(paths).toContain('pairing.figure.0');
    expect(paths).not.toContain('pairing.figure');
    expect(paths).not.toContain('pairingRead.code.1');
  });
  // why: reads of different lengths cannot be read across, so a pairing beneath is not judged by them either
  it('a pairing beneath is not judged by reads whose columns differ in length', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').code.pop();
    groupOf(r, 'pairing').which[1] = 'over-limit';
    expect(issuePaths(r)).toEqual(['pairingRead.code']);
  });
  // why: design 2026-11-08 §4.1: a leading "from" price is allowed, so what refuses this one is its provenance, once
  it('a leading "from" price of another list\'s provenance is refused by the leading rule only, never also the beneath source check', () => {
    const r = withPairing();
    const q = groupOf(r, 'pairing');
    q.isFrom[0] = true;
    q.seller[0] = null;
    q.offersRead[0] = 0;
    q.complete[0] = false;
    q.provenance[0] = columnOf(r.figures.provenance, 1);
    expect(issuePaths(r)).toEqual(['pairing.provenance.0']);
  });
  // why: zod still runs the refinement after a column's own (continuable) minimum refusal, so a negative index names
  // no provenance and is refused as no flight list's, never read through
  it('a negative pairing provenance index is refused, not read through', () => {
    const r = withPairing();
    groupOf(r, 'pairing').provenance[1] = -1;
    expect(issuePaths(r)).toEqual(['pairing.provenance.1', 'pairing.provenance.1']);
  });
});

describe('datePairFigureSchema: each rule says what is wrong', () => {
  const { airportPair: _p, ...pairing } = pairingFigure();
  const { airportPair: _c, ...calendar } = calendarFigure();
  const from = { isFrom: true, seller: null, offersRead: 0, complete: false } as const;
  const under = (read: string, over: Partial<DatePairPairing>) => ({
    ...calendar,
    pairingRead: read,
    pairing: figurePairing(over),
  });
  const other = { ...pairing.price.provenance, fetchedAt: asIsoDateTime('2027-03-01T09:31:00.000Z') };
  it.each([
    [
      'no grid price on a pairing figure',
      { ...pairing, gridPrice: null },
      'gridPrice',
      'a grid price exactly on a pairing figure',
    ],
    [
      'a pairing figure not read within',
      { ...pairing, pairingRead: 'within-older' },
      'pairingRead',
      'pairingRead is within exactly on a pairing figure',
    ],
    [
      'a list-failed read without its reason',
      { ...calendar, pairingRead: 'list-failed', listReason: null },
      'listReason',
      'a reason exactly on a list-failed read',
    ],
    [
      'a pairing on a calendar figure read not-read',
      { ...calendar, pairing: figurePairing() },
      'pairing',
      'a pairing for a pairing figure, or shown beneath a calendar or stale verified figure',
    ],
    [
      'a beneath read without its pairing',
      { ...calendar, pairingRead: 'over-limit', pairing: null },
      'pairing',
      'a pairing read beneath its figure needs its pairing',
    ],
    [
      'a leading "from" price that is complete',
      { ...pairing, pairing: figurePairing({ ...from, complete: true }) },
      'pairing.complete',
      'a from price is never complete',
    ],
    [
      'a leading pairing not complete',
      { ...pairing, pairing: figurePairing({ complete: false }) },
      'pairing.complete',
      "a pairing figure's offers are complete",
    ],
    [
      'a leading pairing that read no offer',
      { ...pairing, pairing: figurePairing({ offersRead: 0 }) },
      'pairing.offersRead',
      'a pairing figure read at least one offer',
    ],
    [
      'a leading pairing over the limits',
      { ...pairing, pairing: figurePairing({ which: 'over-limit' }) },
      'pairing.which',
      'a pairing figure is within the limits',
    ],
    [
      'a leading pairing stale beside a fresh figure',
      { ...pairing, pairing: figurePairing({ stale: 'refresh' }) },
      'pairing.stale',
      "a pairing figure's stale mark is its pairing's",
    ],
    [
      "a leading pairing priced off its figure's price",
      { ...pairing, pairing: figurePairing({ pricePence: 117_999, mismatch: true }) },
      'pairing.pricePence',
      "a pairing figure's price is its offer's",
    ],
    [
      "a leading pairing of another list's provenance",
      { ...pairing, pairing: figurePairing({ provenance: other }) },
      'pairing.provenance',
      "a pairing figure's provenance is its flight list's",
    ],
    [
      'a pairing beneath of no flight list',
      under('offers-incomplete', { provenance: calendar.price.provenance }),
      'pairing.provenance',
      "a pairing's provenance is a flight list's",
    ],
    [
      'a pairing beneath within the limits read over-limit',
      under('over-limit', {}),
      'pairing.which',
      'a pairing beneath is over the limits exactly when it reads so',
    ],
    [
      'a stale pairing beneath read sellers-not-read',
      under('sellers-not-read', { ...from, stale: 'refresh' }),
      'pairing.stale',
      'a pairing within the refresh is fresh',
    ],
    [
      'a stale pairing beneath read offers-incomplete',
      under('offers-incomplete', { stale: 'refresh' }),
      'pairing.stale',
      'a pairing within the refresh is fresh',
    ],
    [
      'a complete "from" price',
      under('sellers-not-read', { ...from, complete: true }),
      'pairing.complete',
      'a from price is never complete',
    ],
    [
      'an offer without its seller',
      under('offers-incomplete', { seller: null }),
      'pairing.seller',
      "a seller exactly when the price is an offer's",
    ],
    [
      'a fare on a "from" price',
      under('sellers-not-read', { ...from, fare: 'Economy Basic' }),
      'pairing.fare',
      'no fare on a from price',
    ],
    [
      'a "from" price off the return\'s own',
      under('sellers-not-read', { ...from, fromPence: 1 }),
      'pairing.fromPence',
      "a from price is the return's own from price",
    ],
    [
      'a mismatch on an offer equal to its "from" price',
      under('offers-incomplete', { mismatch: true }),
      'pairing.mismatch',
      'a mismatch exactly when an offer differs from the from price',
    ],
  ] as const)('refuses %s, saying why', (_name, value, path, message) => {
    expect(issuesOf(datePairFigureSchema.safeParse(value))).toEqual([{ path, message, code: 'custom' }]);
  });
});
