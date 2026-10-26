import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DatePair } from '../../src/datePairs/encode.js';
import { bestPerWeek, rankDatePairs } from '../../src/datePairs/rank.js';
import { type DatePairSpace, datePairCount, datePairIndex } from '../../src/datePairs/space.js';
import { addDays } from '../../src/dates/epochDay.js';
import { asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import {
  calendarFigure,
  calendarProvenance,
  datePair,
  verifiedFigure,
  verifiedProvenance,
} from '../helpers/datePairs.js';
import { NOW } from '../helpers/rows.js';

const SPACE: DatePairSpace = {
  departureFrom: asIsoDate('2027-03-14'),
  departureTo: asIsoDate('2027-03-31'),
  minNights: 10,
  maxNights: 12,
};
const hoursAgo = (h: number) => asIsoDateTime(new Date(Date.parse(NOW) - h * 3_600_000).toISOString());

interface Spec {
  pence: number;
  basis: 'verified' | 'calendar';
  /** effective age in hours (bound 0 on a verified price, the fetch age on a calendar one); 'unknown' for no bound */
  age?: number | 'unknown';
  /** a calendar price with a 7-day bound fetched now */
  bounded7d?: true;
  superseded?: true;
  notSeen?: true;
  truncated?: true;
  depart?: string;
  nights?: number;
}

/** A date pair of SPACE with one figure built from the spec. */
function pairOf(s: Spec): DatePair {
  const depart = asIsoDate(s.depart ?? '2027-03-20');
  const nights = s.nights ?? 10;
  const index = datePairIndex(SPACE, depart, addDays(depart, nights));
  if (index === null) throw new Error('outside SPACE');
  const fetchedAt = hoursAgo(typeof s.age === 'number' ? s.age : 2);
  const provenance =
    s.basis === 'verified'
      ? verifiedProvenance({ fetchedAt, maxAgeHours: s.age === 'unknown' ? 'unknown' : 0 })
      : calendarProvenance({
          fetchedAt: s.bounded7d === true ? NOW : fetchedAt,
          maxAgeHours: s.age === 'unknown' ? 'unknown' : s.bounded7d === true ? 168 : 0,
        });
  const price = {
    pricePence: s.pence,
    provenance,
    stale: false,
    ageHours: s.age ?? 2,
    truncated: s.truncated === true,
  };
  const figure =
    s.basis === 'verified'
      ? verifiedFigure({ price, notSeenInLatest: s.notSeen === true ? { ageHours: 40 } : null })
      : calendarFigure({ price, superseded: s.superseded === true });
  return datePair(SPACE, index, 1, { figure });
}

// One row per tie rule, each built so only that rule decides: where the index (departure, then nights) would order the
// pair the other way, the expected first one has the later index.
const CASES: Array<[string, Spec, Spec, 'a' | 'b']> = [
  [
    'price',
    { pence: 30_000, basis: 'calendar', depart: '2027-03-21' },
    { pence: 31_000, basis: 'verified' },
    'a',
  ],
  [
    'equal price, basis',
    { pence: 30_000, basis: 'calendar' },
    { pence: 30_000, basis: 'verified', depart: '2027-03-21' },
    'b',
  ],
  [
    'equal price and basis, fresher',
    { pence: 30_000, basis: 'verified', age: 2, depart: '2027-03-21' },
    { pence: 30_000, basis: 'verified', age: 30 },
    'a',
  ],
  [
    'unknown age last',
    { pence: 30_000, basis: 'calendar', age: 'unknown' },
    { pence: 30_000, basis: 'calendar', bounded7d: true, depart: '2027-03-21' },
    'b',
  ],
  [
    'earlier departure',
    { pence: 30_000, basis: 'calendar', depart: '2027-03-14', nights: 12 },
    { pence: 30_000, basis: 'calendar', depart: '2027-03-15', nights: 10 },
    'a',
  ],
  [
    'fewer nights',
    { pence: 30_000, basis: 'calendar', depart: '2027-03-14', nights: 12 },
    { pence: 30_000, basis: 'calendar', depart: '2027-03-14', nights: 10 },
    'b',
  ],
  [
    'equal price, basis and age, nights decide',
    { pence: 30_000, basis: 'verified', age: 2, depart: '2027-03-14', nights: 12 },
    { pence: 30_000, basis: 'verified', age: 2, depart: '2027-03-14', nights: 11 },
    'b',
  ],
  [
    'superseded after current',
    { pence: 20_000, basis: 'calendar', superseded: true },
    { pence: 90_000, basis: 'calendar', depart: '2027-03-21' },
    'b',
  ],
  [
    'not seen after current',
    { pence: 20_000, basis: 'verified', notSeen: true },
    { pence: 90_000, basis: 'calendar', depart: '2027-03-21' },
    'b',
  ],
  [
    'superseded against not seen: price decides',
    { pence: 25_000, basis: 'calendar', superseded: true },
    { pence: 24_000, basis: 'verified', notSeen: true, depart: '2027-03-21' },
    'b',
  ],
  [
    'only superseded set, against current',
    { pence: 10_000, basis: 'calendar', superseded: true },
    { pence: 50_000, basis: 'verified', depart: '2027-03-21' },
    'b',
  ],
  [
    'only not-seen set, against current',
    { pence: 10_000, basis: 'verified', notSeen: true },
    { pence: 50_000, basis: 'calendar', depart: '2027-03-21' },
    'b',
  ],
  [
    'truncated ranked by amount',
    { pence: 25_000, basis: 'calendar', truncated: true, depart: '2027-03-21' },
    { pence: 26_000, basis: 'calendar' },
    'a',
  ],
];

describe('rankDatePairs (spec §11 "Board": the rank is by price whatever the sort)', () => {
  it.each(CASES)('%s', (_name, a, b, first) => {
    const pa = pairOf(a);
    const pb = pairOf(b);
    const want = first === 'a' ? [pa, pb] : [pb, pa];
    expect(rankDatePairs([pa, pb], NOW)).toEqual(want);
    expect(rankDatePairs([pb, pa], NOW)).toEqual(want);
  });

  it('leaves out date pairs without a figure', () => {
    const priced = pairOf({ pence: 30_000, basis: 'calendar' });
    const bare = datePair(SPACE, 0, 1);
    expect(rankDatePairs([bare, priced, bare], NOW)).toEqual([priced]);
    expect(rankDatePairs([], NOW)).toEqual([]);
  });
});

/** A ranked-board arbitrary: date pairs of SPACE with distinct indices, most with a figure. */
const arbPairs = fc
  .uniqueArray(fc.integer({ min: 0, max: datePairCount(SPACE) - 1 }), { minLength: 0, maxLength: 12 })
  .chain((indices) =>
    fc.tuple(
      ...indices.map((index) =>
        fc
          .record({
            has: fc.integer({ min: 0, max: 4 }),
            pence: fc.constantFrom(20_000, 25_000, 30_000),
            basis: fc.constantFrom<'verified' | 'calendar'>('verified', 'calendar'),
            age: fc.constantFrom<number | 'unknown'>(2, 30, 'unknown'),
            mark: fc.constantFrom('none', 'superseded', 'notSeen'),
            truncated: fc.boolean(),
          })
          .map((r) => {
            if (r.has === 0) return datePair(SPACE, index, 1);
            const p = pairOf({
              pence: r.pence,
              basis: r.basis,
              age: r.age,
              ...(r.mark === 'superseded' && r.basis === 'calendar' ? { superseded: true } : {}),
              ...(r.mark === 'notSeen' && r.basis === 'verified' ? { notSeen: true } : {}),
              ...(r.truncated && r.basis === 'calendar' ? { truncated: true } : {}),
            });
            return { ...p, ...datePair(SPACE, index, 1), figure: p.figure };
          }),
      ),
    ),
  );

describe('rankDatePairs properties', () => {
  it('is a total order: the same output for every permutation, pairwise consistent, figures only', () => {
    fc.assert(
      fc.property(
        arbPairs.chain((ps) =>
          fc.tuple(fc.constant(ps), fc.shuffledSubarray(ps, { minLength: ps.length, maxLength: ps.length })),
        ),
        ([pairs, perm]) => {
          const ranked = rankDatePairs(pairs, NOW);
          expect(rankDatePairs(perm, NOW)).toEqual(ranked);
          expect(ranked).toHaveLength(pairs.filter((p) => p.figure !== null).length);
          expect(ranked.every((p) => p.figure !== null)).toBe(true);
          // antisymmetric and transitive: every pair of the output keeps its order when ranked on its own
          for (let i = 0; i < ranked.length; i += 1)
            for (let j = i + 1; j < ranked.length; j += 1) {
              const [x, y] = [ranked[i], ranked[j]];
              if (x !== undefined && y !== undefined) expect(rankDatePairs([y, x], NOW)).toEqual([x, y]);
            }
          // a truncated figure's flag survives the ranking
          expect(ranked.filter((p) => p.figure?.price.truncated).length).toBe(
            pairs.filter((p) => p.figure?.price.truncated).length,
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('bestPerWeek (revision 50: the first-ranked date pair of each Monday-start departure week)', () => {
  const at = (depart: string, pence: number) => {
    const space: DatePairSpace = {
      departureFrom: asIsoDate('2027-03-01'),
      departureTo: asIsoDate('2028-01-31'),
      minNights: 10,
      maxNights: 10,
    };
    const index = datePairIndex(space, asIsoDate(depart), addDays(asIsoDate(depart), 10)) ?? -1;
    return datePair(space, index, 1, {
      figure: calendarFigure({ price: { ...calendarFigure().price, pricePence: pence } }),
    });
  };

  it('a Sunday and the following Monday fall in different weeks', () => {
    // 14 Mar 2027 is a Sunday
    const sunday = at('2027-03-14', 30_000);
    const monday = at('2027-03-15', 31_000);
    expect(bestPerWeek([sunday, monday])).toEqual([sunday, monday]);
  });

  it('keeps the first in rank order of each week and drops the rest, in rank order', () => {
    const mon = at('2027-03-15', 30_000);
    const sun = at('2027-03-21', 29_000);
    const nextTue = at('2027-03-23', 31_000);
    const wed = at('2027-03-17', 32_000);
    // ranked: sun (29,000), mon, nextTue, wed: sun and mon share a week, so mon and wed go
    expect(bestPerWeek([sun, mon, nextTue, wed])).toEqual([sun, nextTue]);
  });

  it('a week crossing a month end is one week, and so is one crossing the 2027→2028 boundary', () => {
    const wed = at('2027-03-31', 30_000);
    const sat = at('2027-04-03', 29_000);
    expect(bestPerWeek([sat, wed])).toEqual([sat]);
    // 27 Dec 2027 is a Monday; 2 Jan 2028 is the Sunday of the same week
    const dec = at('2027-12-27', 30_000);
    const jan = at('2028-01-02', 31_000);
    const nextMon = at('2028-01-03', 32_000);
    expect(bestPerWeek([dec, jan, nextMon])).toEqual([dec, nextMon]);
  });

  it('its output is a subsequence of its input with one date pair per week (property)', () => {
    fc.assert(
      fc.property(arbPairs, (pairs) => {
        const ranked = rankDatePairs(pairs, NOW);
        const best = bestPerWeek(ranked);
        let from = 0;
        for (const p of best) {
          const at = ranked.indexOf(p, from);
          expect(at).toBeGreaterThanOrEqual(from);
          from = at + 1;
        }
        const week = (d: string) => Math.floor((Date.parse(`${d}T00:00:00Z`) / 86_400_000 + 3) / 7);
        const weeks = best.map((p) => week(p.departureDate));
        expect(new Set(weeks).size).toBe(best.length);
        expect(new Set(weeks)).toEqual(new Set(ranked.map((p) => week(p.departureDate))));
      }),
    );
  });
});
