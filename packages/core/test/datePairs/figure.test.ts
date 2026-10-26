import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type FigureCandidate,
  figuresByDatePair,
  pickCalendarFigure,
  pickFigure,
  pickVerifiedFigure,
} from '../../src/datePairs/figure.js';
import { addDays } from '../../src/dates/epochDay.js';
import type { ResultRow } from '../../src/results/types.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';
import { calendarRow, NOW, row } from '../helpers/rows.js';

// why: the row helpers take the schema's input shape, so the cell is plain strings and needs no brand helper.
const onPair = (origin: string, destination: string) => ({
  origin,
  destination,
  departureDate: '2027-03-14',
  returnDate: '2027-03-24',
  nights: 10,
});
const scopeOf = (origins: string[]) => ({
  space: {
    origins: origins.map(asIata),
    destinations: [asIata('EWR'), asIata('JFK')],
    departureFrom: asIsoDate('2027-03-14'),
    departureTo: asIsoDate('2027-03-15'),
    minNights: 10,
    maxNights: 11,
  },
  maxJourneyMinutes: null,
});

describe('a figure is the cheapest across the airport pairs in scope (decision 53)', () => {
  it('a date pair priced only on a filtered-out airport pair has no figure', () => {
    const priced = calendarRow({ cell: onPair('LGW', 'EWR'), pricePence: 31_200 });
    // index 0 is 14 Mar, 10 nights: its only priced cell is LGW→EWR, outside an LHR-only scope
    expect(figuresByDatePair([priced], scopeOf(['LHR']), NOW).figures.has(0)).toBe(false);
    // and the same price is the figure once its airport pair is in scope
    expect(figuresByDatePair([priced], scopeOf(['LGW', 'LHR']), NOW).figures.get(0)?.chosen.pricePence).toBe(
      31_200,
    );
  });
});

// Ages at NOW (2027-03-01T12:00Z): a verified row fetched at 10:00 with a 0 h bound is 2 h old; a calendar row fetched
// at 10:00 with Travelpayouts' 48 h bound is 50 h old (worst case, spec §3).
const OLD = '2027-02-20T12:00:00.000Z'; // 216 h before NOW
const fresh = (pricePence: number, over: Parameters<typeof row>[0] = {}) => row({ pricePence, ...over });
const stale = (pricePence: number, over: Parameters<typeof row>[0] = {}) =>
  row({ pricePence, stale: true, ...over });
const cal = (pricePence: number, over: Parameters<typeof calendarRow>[0] = {}) =>
  calendarRow({ pricePence, ...over });

type Want = { basis: 'verified' | 'calendar'; chosen: number; cheaperCached: number | null } | null;
const summary = (rows: readonly ResultRow[]): Want => {
  const f = pickFigure(rows, NOW);
  return f === null
    ? null
    : { basis: f.basis, chosen: f.chosen.pricePence, cheaperCached: f.cheaperCached?.pricePence ?? null };
};

describe('pickFigure (spec §11 "The figure"; plan decisions 38, 54, 58)', () => {
  it.each<[string, ResultRow[], Want]>([
    [
      'fresh verified wins over a cheaper current calendar price and carries it as cheaperCached',
      [fresh(41_200), cal(31_200)],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'a fresh verified price below every calendar price has cheaperCached null',
      [fresh(30_000), cal(31_200)],
      { basis: 'verified', chosen: 30_000, cheaperCached: null },
    ],
    [
      'a fresh verified price is the figure even beside a fresher calendar price (fresh is by the threshold, not by age)',
      [fresh(41_200, { provenance: { fetchedAt: OLD } }), cal(31_200)],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'a calendar price equal to the fresh verified one is not cheaper',
      [fresh(31_200), cal(31_200)],
      { basis: 'verified', chosen: 31_200, cheaperCached: null },
    ],
    [
      'a fresh verified figure whose only cheaper calendar price is superseded has cheaperCached null',
      [fresh(41_200), cal(31_200, { superseded: true })],
      { basis: 'verified', chosen: 41_200, cheaperCached: null },
    ],
    [
      'cheaperCached is the cheapest current calendar price, never a cheaper superseded one',
      [fresh(41_200), cal(20_000, { superseded: true }), cal(35_000), cal(36_000)],
      { basis: 'verified', chosen: 41_200, cheaperCached: 35_000 },
    ],
    [
      'stale verified against calendar: the fresher (verified, 2 h) wins and carries the cheaper calendar price',
      [stale(41_200), cal(31_200)],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'stale verified against calendar: the fresher (calendar, 50 h against 216 h) wins with no cheaperCached',
      [stale(30_000, { provenance: { fetchedAt: OLD } }), cal(31_200)],
      { basis: 'calendar', chosen: 31_200, cheaperCached: null },
    ],
    [
      'equal ages go to verified',
      [stale(41_200, { provenance: { maxAgeHours: 48 } }), cal(31_200)],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'an unknown verified age loses to a known calendar age',
      [stale(30_000, { provenance: { maxAgeHours: 'unknown' } }), cal(31_200)],
      { basis: 'calendar', chosen: 31_200, cheaperCached: null },
    ],
    [
      'an unknown calendar age loses to a known verified age',
      [
        stale(41_200, { provenance: { fetchedAt: OLD } }),
        cal(31_200, { provenance: { maxAgeHours: 'unknown' } }),
      ],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'two unknown ages go to verified',
      [
        stale(41_200, { provenance: { maxAgeHours: 'unknown' } }),
        cal(31_200, { provenance: { maxAgeHours: 'unknown' } }),
      ],
      { basis: 'verified', chosen: 41_200, cheaperCached: 31_200 },
    ],
    [
      'a stale verified figure against a superseded calendar price carries no cheaperCached',
      [stale(41_200), cal(31_200, { superseded: true })],
      { basis: 'verified', chosen: 41_200, cheaperCached: null },
    ],
    [
      'a superseded calendar price fresher than the stale verified one is the figure',
      [stale(41_200, { provenance: { fetchedAt: OLD } }), cal(31_200, { superseded: true })],
      { basis: 'calendar', chosen: 31_200, cheaperCached: null },
    ],
    [
      'stale verified alone is the figure',
      [stale(41_200)],
      { basis: 'verified', chosen: 41_200, cheaperCached: null },
    ],
    [
      'a calendar price alone is the figure',
      [cal(31_200)],
      { basis: 'calendar', chosen: 31_200, cheaperCached: null },
    ],
    ['neither gives no figure', [], null],
    [
      'a partially-verified candidate is never chosen, even when cheapest and alone',
      [fresh(10_000, { verdictClass: 'partially-verified', unverified: ['cabin'] })],
      null,
    ],
    [
      'a failed candidate is never chosen, even when cheapest and alone',
      [fresh(10_000, { verdictClass: 'failed' })],
      null,
    ],
    [
      'beside a partially-verified and a failed candidate, the calendar price is the figure',
      [
        fresh(10_000, { verdictClass: 'partially-verified', unverified: ['cabin'] }),
        fresh(11_000, { verdictClass: 'failed' }),
        cal(31_200),
      ],
      { basis: 'calendar', chosen: 31_200, cheaperCached: null },
    ],
  ])('%s', (_name, rows, want) => {
    expect(summary(rows)).toEqual(want);
  });

  it('cheaperCached may sit on another airport pair than the figure and keeps its own cell', () => {
    const f = pickFigure(
      [fresh(41_200, { cell: onPair('LHR', 'JFK') }), cal(31_200, { cell: onPair('LGW', 'EWR') })],
      NOW,
    );
    expect(f?.chosen.cell).toMatchObject({ origin: 'LHR', destination: 'JFK' });
    expect(f?.cheaperCached?.cell).toMatchObject({ origin: 'LGW', destination: 'EWR' });
  });
});

describe('pickVerifiedFigure: seen, then fresh, then cheaper (decisions 54, 58)', () => {
  it('prefers a price the latest search returned over a cheaper, fresher one it did not', () => {
    const seen = stale(50_000);
    const notSeen = fresh(30_000, { notSeenInLatest: { ageHours: 3 } });
    expect(pickVerifiedFigure([notSeen, seen])).toBe(seen);
    expect(pickVerifiedFigure([seen, notSeen])).toBe(seen);
  });
  it('then a fresh price over a cheaper stale one', () => {
    const f = fresh(50_000);
    const s = stale(30_000);
    expect(pickVerifiedFigure([s, f])).toBe(f);
    expect(pickVerifiedFigure([f, s])).toBe(f);
  });
  it('then the cheaper', () => {
    const a = fresh(30_000);
    const b = fresh(30_001);
    expect(pickVerifiedFigure([b, a])).toBe(a);
    expect(pickVerifiedFigure([a, b])).toBe(a);
  });
  it('gives null for no rows', () => {
    expect(pickVerifiedFigure([])).toBeNull();
  });
});

describe('pickCalendarFigure: current before superseded, then cheapest (decision 54)', () => {
  it('prefers a current price over a cheaper superseded one', () => {
    const current = cal(40_000);
    const superseded = cal(20_000, { superseded: true });
    expect(pickCalendarFigure([superseded, current])).toBe(current);
    expect(pickCalendarFigure([current, superseded])).toBe(current);
  });
  it('returns the cheapest superseded price when nothing is current', () => {
    const a = cal(25_000, { superseded: true });
    const b = cal(20_000, { superseded: true });
    expect(pickCalendarFigure([a, b])).toBe(b);
    expect(pickCalendarFigure([b, a])).toBe(b);
  });
  it('returns the cheapest current price', () => {
    const a = cal(25_000);
    const b = cal(20_000);
    expect(pickCalendarFigure([a, b])).toBe(b);
    expect(pickCalendarFigure([b, a])).toBe(b);
  });
  it('gives null for no rows', () => {
    expect(pickCalendarFigure([])).toBeNull();
  });
});

// One case per tie level: every arm of the generation order (origin, destination, departure, return) and of the row
// key, each from both input orders; a full tie keeps the first in input order.
const cellAt = (
  origin: string,
  destination: string,
  departureDate: string,
  returnDate: string,
  nights: number,
) => ({
  origin,
  destination,
  departureDate,
  returnDate,
  nights,
});
/** A cell of the scope's space by departure date and nights. */
const at = (origin: string, destination: string, departureDate = '2027-03-14', nights = 10) =>
  cellAt(origin, destination, departureDate, addDays(asIsoDate(departureDate), nights), nights);
const TIES: Array<[string, Parameters<typeof row>[0], Parameters<typeof row>[0]]> = [
  ['cells differing only in origin', { cell: onPair('LGW', 'JFK') }, { cell: onPair('LHR', 'JFK') }],
  ['cells differing only in destination', { cell: onPair('LHR', 'EWR') }, { cell: onPair('LHR', 'JFK') }],
  [
    'cells differing only in departure date',
    { cell: cellAt('LHR', 'JFK', '2027-03-14', '2027-03-25', 11) },
    { cell: cellAt('LHR', 'JFK', '2027-03-15', '2027-03-25', 10) },
  ],
  [
    'cells differing only in return date',
    { cell: cellAt('LHR', 'JFK', '2027-03-14', '2027-03-24', 10) },
    { cell: cellAt('LHR', 'JFK', '2027-03-14', '2027-03-25', 11) },
  ],
  [
    'one cell, an itinerary hash against a calendar key',
    { itineraryHash: 'aaa', calendarPriceId: null },
    { itineraryHash: null, calendarPriceId: 7 },
  ],
  ['one cell, two itinerary hashes', { itineraryHash: 'h1' }, { itineraryHash: 'h2' }],
];

describe.each([
  ['pickVerifiedFigure', pickVerifiedFigure, (o: Parameters<typeof row>[0]) => fresh(30_000, o)],
  ['pickCalendarFigure', pickCalendarFigure, (o: Parameters<typeof row>[0]) => cal(30_000, o)],
] as const)('%s ties: generation order, then the row key', (_name, pick, make) => {
  it.each(TIES)('%s: the first by that order wins from either input order', (_case, first, second) => {
    const a = make(first);
    const b = make(second);
    expect(pick([a, b])).toBe(a);
    expect(pick([b, a])).toBe(a);
  });
  it('the same cell and the same row key: the first in input order stays', () => {
    const a = make({ observationId: 1 });
    const b = make({ observationId: 2 });
    expect(pick([a, b])).toBe(a);
    expect(pick([b, a])).toBe(b);
  });
});

describe('the pick is the same for every permutation of its input (property)', () => {
  const arbCandidate = fc.record({
    origin: fc.constantFrom('LGW', 'LHR'),
    destination: fc.constantFrom('EWR', 'JFK'),
    day: fc.integer({ min: 14, max: 15 }),
    nights: fc.integer({ min: 10, max: 11 }),
    price: fc.constantFrom(30_000, 31_000),
    stale: fc.boolean(),
    notSeen: fc.boolean(),
    superseded: fc.boolean(),
  });
  // A list of candidates and a permutation of its indices.
  const arbCase = fc.array(arbCandidate, { minLength: 1, maxLength: 6 }).chain((cs) =>
    fc.tuple(
      fc.constant(cs),
      fc.shuffledSubarray(
        cs.map((_c, i) => i),
        { minLength: cs.length, maxLength: cs.length },
      ),
    ),
  );
  it.each([
    ['pickVerifiedFigure', pickVerifiedFigure],
    ['pickCalendarFigure', pickCalendarFigure],
  ] as const)('%s', (_name, pick) => {
    fc.assert(
      fc.property(arbCase, ([cs, order]) => {
        // why: distinct row keys, so only a full tie on every key could depend on input order, and none is generated.
        const rows = cs.map((c, i) =>
          row({
            itineraryHash: `h${i}`,
            pricePence: c.price,
            stale: c.stale,
            notSeenInLatest: c.notSeen ? { ageHours: 1 } : null,
            superseded: c.superseded,
            cell: at(c.origin, c.destination, `2027-03-${c.day}`, c.nights),
          }),
        );
        expect(pick(order.map((i) => rows[i]).filter((r) => r !== undefined))).toBe(pick(rows));
      }),
      { numRuns: 200 },
    );
  });
});

describe('figuresByDatePair (spec §10 maxJourneyMinutes; decision 53)', () => {
  const space = scopeOf(['LGW', 'LHR']).space;
  const withLimit = (maxJourneyMinutes: number | null) => ({ space, maxJourneyMinutes });

  it('drops candidates outside the space and outside the scope airports', () => {
    const rows = [
      cal(10_000, { cell: at('LHR', 'JFK', '2027-03-16') }), // departs after the window
      cal(10_000, { cell: cellAt('LHR', 'JFK', '2027-03-14', '2027-03-26', 12) }), // 12 nights, outside 10..11
      cal(10_000, { cell: at('LHR', 'BBB') }), // destination outside the scope
      cal(10_000, { cell: at('AAA', 'JFK') }), // origin outside the scope
      cal(31_200, { cell: at('LHR', 'JFK', '2027-03-15', 11) }),
    ];
    const { figures } = figuresByDatePair(rows, withLimit(null), NOW);
    // 15 Mar, 11 nights is index 1 × 2 + 1 = 3
    expect([...figures.keys()]).toEqual([3]);
    expect(figures.get(3)?.chosen.pricePence).toBe(31_200);
  });

  it('maxJourneyMinutes 600 drops a candidate of 601 minutes and keeps 600 and an unknown journey time', () => {
    const over = (cell: ReturnType<typeof at>, totalMinutes: number | null, pricePence: number) =>
      fresh(pricePence, { cell, totalMinutes, itineraryHash: `h${pricePence}` });
    const a = figuresByDatePair(
      [over(at('LHR', 'JFK'), 601, 30_000), over(at('LHR', 'JFK'), 600, 31_000)],
      withLimit(600),
      NOW,
    );
    expect(a.figures.get(0)?.chosen.pricePence).toBe(31_000);
    const b = figuresByDatePair(
      [over(at('LHR', 'JFK'), 601, 30_000), over(at('LHR', 'JFK'), null, 32_000)],
      withLimit(600),
      NOW,
    );
    expect(b.figures.get(0)?.chosen.pricePence).toBe(32_000);
    // neither airport pair was wholly left out
    expect(a.journeyLeftOut.size + b.journeyLeftOut.size).toBe(0);
  });

  it('a date pair whose every figure-eligible candidate is over the limit has no figure and counts those airport pairs', () => {
    const rows = [
      fresh(30_000, { cell: at('LHR', 'JFK'), totalMinutes: 700, itineraryHash: 'h1' }),
      fresh(30_500, { cell: at('LHR', 'JFK'), totalMinutes: 800, itineraryHash: 'h2' }),
      fresh(31_000, { cell: at('LGW', 'EWR'), totalMinutes: 900, itineraryHash: 'h3' }),
      // a failed price within the limit makes nothing eligible
      fresh(20_000, {
        cell: at('LGW', 'EWR'),
        totalMinutes: 300,
        verdictClass: 'failed',
        itineraryHash: 'h4',
      }),
    ];
    const { figures, journeyLeftOut } = figuresByDatePair(rows, withLimit(600), NOW);
    expect(figures.has(0)).toBe(false);
    expect([...journeyLeftOut]).toEqual([[0, 2]]);
  });

  it('an airport pair with a price within the limit is not left out, whatever order its prices come in', () => {
    const within = fresh(31_000, { cell: at('LHR', 'JFK'), totalMinutes: 600, itineraryHash: 'h1' });
    const over = fresh(30_000, { cell: at('LHR', 'JFK'), totalMinutes: 601, itineraryHash: 'h2' });
    for (const rows of [
      [within, over],
      [over, within],
    ]) {
      const { figures, journeyLeftOut } = figuresByDatePair(rows, withLimit(600), NOW);
      expect(figures.get(0)?.chosen).toBe(within);
      expect(journeyLeftOut.size).toBe(0);
    }
  });

  it("counts left-out airport pairs per date pair, at each date pair's own index", () => {
    const rows = [
      fresh(30_000, { cell: at('LHR', 'JFK', '2027-03-15', 11), totalMinutes: 700, itineraryHash: 'h1' }),
      fresh(30_000, { cell: at('LGW', 'JFK', '2027-03-15', 11), totalMinutes: 700, itineraryHash: 'h2' }),
      fresh(30_000, { cell: at('LGW', 'EWR', '2027-03-14', 11), totalMinutes: 700, itineraryHash: 'h3' }),
    ];
    // 15 Mar, 11 nights is index 3; 14 Mar, 11 nights is index 1
    expect([...figuresByDatePair(rows, withLimit(600), NOW).journeyLeftOut].sort()).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });

  it('an airport pair with a calendar price is never left out (a calendar price has no journey time)', () => {
    const rows = [
      fresh(30_000, { cell: at('LHR', 'JFK'), totalMinutes: 700 }),
      cal(35_000, { cell: at('LHR', 'JFK') }),
    ];
    const { figures, journeyLeftOut } = figuresByDatePair(rows, withLimit(600), NOW);
    expect(figures.get(0)?.basis).toBe('calendar');
    expect(journeyLeftOut.size).toBe(0);
  });

  it('a date pair whose only over-limit prices are failed or partially-verified has no figure and journeyLeftOut 0', () => {
    const rows = [
      fresh(30_000, { cell: at('LHR', 'JFK'), totalMinutes: 700, verdictClass: 'failed' }),
      fresh(30_000, {
        cell: at('LGW', 'JFK'),
        totalMinutes: 700,
        verdictClass: 'partially-verified',
        unverified: ['cabin'],
      }),
    ];
    const { figures, journeyLeftOut } = figuresByDatePair(rows, withLimit(600), NOW);
    expect(figures.size).toBe(0);
    expect(journeyLeftOut.get(0) ?? 0).toBe(0);
  });

  it('with maxJourneyMinutes null, nothing is left out and journeyLeftOut is empty', () => {
    const rows = [fresh(30_000, { cell: at('LHR', 'JFK'), totalMinutes: 6_000 })];
    const { figures, journeyLeftOut } = figuresByDatePair(rows, withLimit(null), NOW);
    expect(figures.get(0)?.chosen.pricePence).toBe(30_000);
    expect(journeyLeftOut.size).toBe(0);
  });

  it('two airport pairs of one date pair give one figure, the cheaper by the precedence, wherever it sits', () => {
    const rows = [
      cal(29_000, { cell: at('LHR', 'JFK') }),
      fresh(41_200, { cell: at('LGW', 'EWR') }),
      cal(33_000, { cell: at('LGW', 'JFK', '2027-03-15', 10) }),
      cal(32_000, { cell: at('LHR', 'EWR', '2027-03-15', 10) }),
    ];
    const { figures } = figuresByDatePair(rows, withLimit(null), NOW);
    expect(figures.size).toBe(2);
    // 14 Mar, 10 nights: the fresh verified LGW→EWR price is the figure, hiding the cheaper LHR→JFK calendar price
    expect(figures.get(0)).toMatchObject({ basis: 'verified', chosen: { pricePence: 41_200 } });
    expect(figures.get(0)?.cheaperCached?.cell).toMatchObject({ origin: 'LHR', destination: 'JFK' });
    // 15 Mar, 10 nights (index 2): the cheaper calendar price, on LHR→EWR
    expect(figures.get(2)?.chosen.cell).toMatchObject({ origin: 'LHR', destination: 'EWR' });
  });

  it('keeps the candidate type it was given (FigureCandidate is a Pick of ResultRow)', () => {
    const c: FigureCandidate = cal(1, { cell: at('LHR', 'JFK') });
    expect(figuresByDatePair([c], withLimit(null), NOW).figures.get(0)?.chosen).toBe(c);
  });
});
