import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type DatePairSpace,
  datePairAt,
  datePairCount,
  datePairIndex,
  datePairIndexer,
  stayCount,
} from '../../src/datePairs/space.js';
import { addDays } from '../../src/dates/epochDay.js';
import { countCells, generateCells, sortedAirportPairs, windowDays } from '../../src/space/generate.js';
import { DEFAULT_MAX_CELLS, MAX_DATE_PAIRS, MAX_NIGHTS, MAX_WINDOW_DAYS } from '../../src/space/limits.js';
import { validateSearchSpace } from '../../src/space/validate.js';
import { asIsoDate } from '../../src/types/ids.js';
import { iatas } from '../helpers/space.js';

const dps = (from: string, to: string, minNights: number, maxNights: number): DatePairSpace => ({
  departureFrom: asIsoDate(from),
  departureTo: asIsoDate(to),
  minNights,
  maxNights,
});

/** Every date pair of a space by `datePairAt`, checked to be the inverse of `datePairIndex`. */
function roundTrip(s: DatePairSpace): Array<{ departureDate: string; returnDate: string; nights: number }> {
  const out = [];
  for (let i = 0; i < datePairCount(s); i += 1) {
    const p = datePairAt(s, i);
    expect(datePairIndex(s, p.departureDate, p.returnDate)).toBe(i);
    expect(addDays(p.departureDate, p.nights)).toBe(p.returnDate);
    expect(p.dayIndex).toBe(Math.floor(i / stayCount(s)));
    out.push({ departureDate: p.departureDate, returnDate: p.returnDate, nights: p.nights });
  }
  return out;
}

describe('date-pair space arithmetic (spec §10: index = dayIndex × stays + (nights − minNights))', () => {
  it('datePairAt and datePairIndex are inverse across a month end', () => {
    const pairs = roundTrip(dps('2027-01-30', '2027-02-02', 1, 2));
    expect(pairs).toEqual([
      { departureDate: '2027-01-30', returnDate: '2027-01-31', nights: 1 },
      { departureDate: '2027-01-30', returnDate: '2027-02-01', nights: 2 },
      { departureDate: '2027-01-31', returnDate: '2027-02-01', nights: 1 },
      { departureDate: '2027-01-31', returnDate: '2027-02-02', nights: 2 },
      { departureDate: '2027-02-01', returnDate: '2027-02-02', nights: 1 },
      { departureDate: '2027-02-01', returnDate: '2027-02-03', nights: 2 },
      { departureDate: '2027-02-02', returnDate: '2027-02-03', nights: 1 },
      { departureDate: '2027-02-02', returnDate: '2027-02-04', nights: 2 },
    ]);
  });

  it('across the leap day (29 Feb 2028 is a departure date)', () => {
    const pairs = roundTrip(dps('2028-02-28', '2028-03-01', 1, 1));
    expect(pairs.map((p) => p.departureDate)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(pairs.map((p) => p.returnDate)).toEqual(['2028-02-29', '2028-03-01', '2028-03-02']);
  });

  it('across the 2027→2028 boundary', () => {
    const pairs = roundTrip(dps('2027-12-30', '2028-01-02', 3, 4));
    expect(pairs[2]).toEqual({ departureDate: '2027-12-31', returnDate: '2028-01-03', nights: 3 });
    expect(pairs.at(-1)).toEqual({ departureDate: '2028-01-02', returnDate: '2028-01-06', nights: 4 });
  });

  it('with minNights 0, index offset 0 returns on the departure date', () => {
    const s = dps('2027-03-14', '2027-03-15', 0, 2);
    roundTrip(s);
    expect(datePairAt(s, 0)).toEqual({
      departureDate: '2027-03-14',
      returnDate: '2027-03-14',
      nights: 0,
      dayIndex: 0,
    });
    expect(datePairAt(s, 3)).toEqual({
      departureDate: '2027-03-15',
      returnDate: '2027-03-15',
      nights: 0,
      dayIndex: 1,
    });
  });

  it('datePairIndex is null outside the space', () => {
    const s = dps('2027-03-14', '2027-03-20', 10, 12);
    const d = asIsoDate;
    expect(datePairIndex(s, d('2027-03-13'), d('2027-03-24'))).toBeNull(); // departs before the window
    expect(datePairIndex(s, d('2027-03-21'), d('2027-03-31'))).toBeNull(); // departs after it
    expect(datePairIndex(s, d('2027-03-14'), d('2027-03-23'))).toBeNull(); // 9 nights
    expect(datePairIndex(s, d('2027-03-14'), d('2027-03-27'))).toBeNull(); // 13 nights
    expect(datePairIndex(s, d('2027-03-14'), d('2027-03-10'))).toBeNull(); // returns before departing
    expect(datePairIndex(s, d('2027-03-20'), d('2027-03-30'))).toBe(18); // the last day's first stay
  });

  it('datePairAt refuses an index outside the space', () => {
    const s = dps('2027-03-14', '2027-03-15', 10, 11);
    expect(() => datePairAt(s, -1)).toThrow(
      new RangeError('datePairAt: -1 is not a date pair index of this space'),
    );
    expect(() => datePairAt(s, 4)).toThrow(RangeError);
    expect(() => datePairAt(s, 1.5)).toThrow(RangeError);
    expect(datePairAt(s, 3).returnDate).toBe('2027-03-26');
  });

  it('an expired window has no date pairs: count 0, every index null, windowDays 0', () => {
    // why: resolveWindow gives an absolute window that has passed as departureFrom after departureTo
    const s = dps('2027-03-15', '2027-03-14', 10, 11);
    expect(windowDays(s)).toBe(0);
    expect(datePairCount(s)).toBe(0);
    expect(datePairIndex(s, asIsoDate('2027-03-14'), asIsoDate('2027-03-24'))).toBeNull();
    expect(datePairIndex(s, asIsoDate('2027-03-15'), asIsoDate('2027-03-25'))).toBeNull();
    expect(() => datePairAt(s, 0)).toThrow(RangeError);
  });

  it('an inverted nights range has no stays', () => {
    expect(stayCount(dps('2027-03-14', '2027-03-15', 12, 11))).toBe(0);
    expect(datePairCount(dps('2027-03-14', '2027-03-15', 12, 11))).toBe(0);
  });

  it('counts 182 × 12 = 2,184 for the worked example and 400 × 91 = 36,400 at the largest', () => {
    expect(datePairCount(dps('2026-10-21', '2027-04-20', 10, 21))).toBe(2_184);
    const largest = dps('2027-01-01', addDays(asIsoDate('2027-01-01'), MAX_WINDOW_DAYS - 1), 0, MAX_NIGHTS);
    expect(datePairCount(largest)).toBe(36_400);
    expect(datePairCount(largest)).toBe(MAX_DATE_PAIRS);
  });

  it('datePairCount equals countCells over the same space with one airport pair (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 30 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: -2, max: 10 }),
        (len, minNights, spread) => {
          const s = dps(
            '2027-12-20',
            addDays(asIsoDate('2027-12-20'), len - 1),
            minNights,
            minNights + spread,
          );
          expect(datePairCount(s)).toBe(
            countCells({ ...s, origins: iatas('LHR'), destinations: iatas('JFK') }),
          );
        },
      ),
    );
  });

  it('datePairIndexer agrees with datePairIndex, with or without its memo warm', () => {
    const s = dps('2027-03-14', '2027-03-20', 10, 12);
    const indexOf = datePairIndexer(s);
    const dates = Array.from({ length: 30 }, (_x, i) => addDays(asIsoDate('2027-03-10'), i));
    for (const dep of dates)
      for (const ret of dates) expect(indexOf(dep, ret)).toBe(datePairIndex(s, dep, ret));
    for (const dep of dates)
      for (const ret of dates) expect(indexOf(dep, ret)).toBe(datePairIndex(s, dep, ret));
  });
});

describe('the one home of the order and the clamp (space/generate.ts)', () => {
  it('sortedAirportPairs sorts origins, then destinations', () => {
    expect(sortedAirportPairs(iatas('LHR', 'LGW'), iatas('JFK', 'EWR'))).toEqual([
      { origin: 'LGW', destination: 'EWR' },
      { origin: 'LGW', destination: 'JFK' },
      { origin: 'LHR', destination: 'EWR' },
      { origin: 'LHR', destination: 'JFK' },
    ]);
    expect(sortedAirportPairs([], iatas('JFK'))).toEqual([]);
  });

  it('sortedAirportPairs leaves its inputs as they were', () => {
    const origins = iatas('LHR', 'LGW');
    sortedAirportPairs(origins, iatas('JFK'));
    expect(origins).toEqual(['LHR', 'LGW']);
  });

  it('windowDays counts the window inclusively', () => {
    expect(windowDays(dps('2027-03-14', '2027-03-14', 0, 0))).toBe(1);
    expect(windowDays(dps('2027-02-27', '2027-03-01', 0, 0))).toBe(3);
  });

  it('generateCells follows sortedAirportPairs, then days, then nights', () => {
    const s = {
      ...dps('2027-03-14', '2027-03-15', 10, 11),
      origins: iatas('LHR', 'LGW'),
      destinations: iatas('JFK', 'EWR'),
    };
    const cells = generateCells(s);
    expect(cells).toHaveLength(countCells(s));
    const pairs = sortedAirportPairs(s.origins, s.destinations);
    cells.forEach((c, i) => {
      const pair = pairs[Math.floor(i / datePairCount(s))];
      const dp = datePairAt(s, i % datePairCount(s));
      expect(c).toEqual({
        ...pair,
        departureDate: dp.departureDate,
        returnDate: dp.returnDate,
        nights: dp.nights,
      });
    });
  });
});

describe('the space limits are written once (space/limits.ts)', () => {
  it("MAX_DATE_PAIRS is MAX_WINDOW_DAYS × (MAX_NIGHTS + 1), and the cell bound is §10's", () => {
    expect([MAX_WINDOW_DAYS, MAX_NIGHTS, MAX_DATE_PAIRS, DEFAULT_MAX_CELLS]).toEqual([
      400, 90, 36_400, 50_000,
    ]);
    expect(MAX_DATE_PAIRS).toBe(MAX_WINDOW_DAYS * (MAX_NIGHTS + 1));
  });

  it('validateSearchSpace still refuses 401 days and 91 nights through the moved constants', () => {
    const lookup = { exists: () => true, metroOf: () => null, airportsOfMetro: () => [] };
    const def = {
      origins: iatas('LHR'),
      destinations: iatas('JFK'),
      window: { kind: 'relative' as const, startOffsetDays: 7, lengthDays: MAX_WINDOW_DAYS },
      minNights: 0,
      maxNights: MAX_NIGHTS,
      verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    };
    const today = asIsoDate('2026-10-14');
    expect(validateSearchSpace(def, today, lookup, DEFAULT_MAX_CELLS).ok).toBe(true);
    const longer = validateSearchSpace(
      { ...def, window: { ...def.window, lengthDays: MAX_WINDOW_DAYS + 1 } },
      today,
      lookup,
      DEFAULT_MAX_CELLS,
    );
    expect(longer.ok ? [] : longer.errors.map((e) => e.field)).toEqual(['window.lengthDays']);
    const wider = validateSearchSpace(
      { ...def, maxNights: MAX_NIGHTS + 1 },
      today,
      lookup,
      DEFAULT_MAX_CELLS,
    );
    expect(wider.ok ? [] : wider.errors.map((e) => e.field)).toEqual(['maxNights']);
  });
});
