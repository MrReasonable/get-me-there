import { describe, expect, it } from 'vitest';
import {
  type DatePairsResponse,
  DEFAULT_MAX_CELLS,
  datePairFigureSchema,
  datePairsQuerySchema,
  datePairsResponseSchema,
  MAX_DATE_PAIRS,
} from '../../src/api-contract/datePairs.js';
import { type DatePairFigure, encodeDatePairs } from '../../src/datePairs/encode.js';
import { PAIRING_READ } from '../../src/datePairs/pairing.js';
import { asIsoDate } from '../../src/types/ids.js';
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
function groupOf<K extends 'gridPrice' | 'pairing' | 'pairingRead'>(
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
  it('pairingRead (sparse): columns of one length, figure ascending and in range, a code of 1 to 8', () => {
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
    groupOf(unknown, 'pairingRead').code[1] = 9;
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
  it('pairing: the pairing figure has an entry that is not a "from" price; none on a verified figure', () => {
    expect(issuePaths(withPairing({ pairing: null }))).toEqual(['pairing.figure']);
    const isFrom = withPairing();
    groupOf(isFrom, 'pairing').isFrom[0] = true;
    groupOf(isFrom, 'pairing').seller[0] = null;
    expect(issuePaths(isFrom)).toEqual(['pairing.isFrom.0']);
    const onVerified = withPairing();
    groupOf(onVerified, 'pairing').figure[1] = 2;
    expect(issuePaths(onVerified)).toEqual(['pairing.figure.1']);
    const order = withPairing();
    groupOf(order, 'pairing').figure = [1, 0];
    expect(issuePaths(order)).toContain('pairing.figure.1');
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
  it('pairing beneath a calendar figure only for the five "shown beneath" reads', () => {
    const r = withPairing();
    groupOf(r, 'pairingRead').code[1] = 1;
    expect(issuePaths(r)).toEqual(['pairing.figure.1']);
  });
  it('a seller exactly when the price is not a "from" price; the seller is bounded page text; times are HH:MM', () => {
    const fromWithSeller = withPairing();
    groupOf(fromWithSeller, 'pairing').isFrom[1] = true;
    expect(issuePaths(fromWithSeller)).toEqual(['pairing.seller.1']);
    const noSeller = withPairing();
    groupOf(noSeller, 'pairing').seller[1] = null;
    expect(issuePaths(noSeller)).toEqual(['pairing.seller.1']);
    const long = withPairing();
    groupOf(long, 'pairing').seller[1] = 'Q'.repeat(81);
    expect(issuePaths(long)).toEqual(['pairing.seller.1']);
    const fare = withPairing();
    groupOf(fare, 'pairing').isFrom[1] = true;
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
                    pairing: figurePairing(),
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
  it('accepts a pairing figure with its grid price, pairing and pairingRead, and a figure without them', () => {
    expect(r(pairing).error?.issues ?? []).toEqual([]);
    const { gridPrice: _g, pairing: _q, pairingRead: _r, ...older } = calendar;
    expect(r(older).success).toBe(true);
    expect(r({ ...calendar, pairingRead: 'within-older', pairing: figurePairing() }).success).toBe(true);
  });
  it('a grid price exactly on a pairing figure; within exactly on one; its pairing never a "from" price', () => {
    expect(paths({ ...pairing, gridPrice: null })).toEqual(['gridPrice']);
    expect(paths({ ...calendar, gridPrice: pairing.gridPrice })).toEqual(['gridPrice']);
    expect(paths({ ...pairing, pairingRead: 'within-older' })).toEqual(['pairingRead']);
    expect(paths({ ...calendar, pairingRead: 'within' })).toEqual(['pairingRead']);
    expect(paths({ ...pairing, pairing: null })).toEqual(['pairing']);
    expect(paths({ ...pairing, pairing: figurePairing({ isFrom: true, seller: null }) })).toEqual([
      'pairing.isFrom',
    ]);
    expect(paths({ ...calendar, pairing: figurePairing() })).toEqual(['pairing']);
    expect(
      paths({ ...calendar, pairingRead: 'offers-incomplete', pairing: figurePairing({ seller: null }) }),
    ).toEqual(['pairing.seller']);
    expect(
      paths({
        ...calendar,
        pairingRead: 'sellers-not-read',
        pairing: figurePairing({ isFrom: true, seller: null, fare: 'Economy Basic' }),
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
