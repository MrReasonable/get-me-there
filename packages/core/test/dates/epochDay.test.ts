import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fromEpochDay,
  isLeapYear,
  monthOf,
  monthsSpanned,
  toEpochDay,
} from '../../src/dates/epochDay.js';
import { asIsoDate } from '../../src/types/ids.js';

const d = asIsoDate;
// Epoch days of 0001-01-01 and 9999-12-31, the range a four-digit IsoDate can express.
const MIN_EPOCH_DAY = -719_162;
const MAX_EPOCH_DAY = 2_932_896;

describe('toEpochDay / fromEpochDay (spec §6.1: epoch-day integers, never Date-local arithmetic)', () => {
  // Reference values computed independently when the brief was written (Date.UTC(y, m-1, d) / 86_400_000)
  // and, for 0001-01-01, from the 719,162 days between 0001-01-01 and 1970-01-01.
  it.each([
    ['1970-01-01', 0],
    ['1969-12-31', -1],
    ['2000-02-29', 11_016],
    ['2000-03-01', 11_017],
    ['2026-10-14', 20_740],
    ['2027-12-31', 21_183],
    ['2028-01-01', 21_184],
    ['2028-02-28', 21_242],
    ['2028-02-29', 21_243],
    ['2028-03-01', 21_244],
    ['0001-01-01', MIN_EPOCH_DAY],
    ['9999-12-31', MAX_EPOCH_DAY],
  ])('%s is epoch day %i both ways', (iso, n) => {
    expect(toEpochDay(d(iso))).toBe(n);
    expect(fromEpochDay(n)).toBe(iso);
  });

  it('round-trips every day in years 0001–9999 and agrees with a UTC oracle (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_EPOCH_DAY, max: MAX_EPOCH_DAY }), (n) => {
        const iso = fromEpochDay(n);
        expect(toEpochDay(iso)).toBe(n);
        // why: the oracle is UTC-only (no local time) and is used in tests, never in src.
        if (n >= 0) expect(iso).toBe(new Date(n * 86_400_000).toISOString().slice(0, 10));
      }),
      { numRuns: 2000 },
    );
  });

  it.each(['2027-02-29', '2026-13-01', '0000-06-01', '2026-1-1', 'garbage'])(
    'toEpochDay rejects %j',
    (bad: string) => {
      // why: a plain string is not an IsoDate; Reflect.apply passes it untyped, since the runtime guard is under test.
      expect(() => Reflect.apply(toEpochDay, undefined, [bad])).toThrow(RangeError);
    },
  );

  it.each([MIN_EPOCH_DAY - 1, MAX_EPOCH_DAY + 1, 1.5, Number.NaN])('fromEpochDay rejects %d', (n) => {
    expect(() => fromEpochDay(n)).toThrow(RangeError);
  });
});

describe('isLeapYear', () => {
  it.each([
    [2028, true],
    [2027, false],
    [2000, true],
    [1900, false],
    [2100, false],
    [2400, true],
  ])('%i → %s', (y, leap) => {
    expect(isLeapYear(y)).toBe(leap);
  });
});

describe('addDays / daysBetween', () => {
  it('lands on the leap day 2028-02-29 and steps over it', () => {
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2028-02-29'), 1)).toBe('2028-03-01');
    expect(addDays(d('2027-02-28'), 1)).toBe('2027-03-01'); // 2027 is not a leap year
    expect(daysBetween(d('2028-02-01'), d('2028-03-01'))).toBe(29);
    expect(daysBetween(d('2027-02-01'), d('2027-03-01'))).toBe(28);
  });
  it('crosses the 2027→2028 boundary', () => {
    expect(addDays(d('2027-12-30'), 3)).toBe('2028-01-02');
    expect(addDays(d('2028-01-01'), -1)).toBe('2027-12-31');
    expect(daysBetween(d('2027-12-31'), d('2028-01-01'))).toBe(1);
  });
  it('is zero from a date to itself and negative backwards', () => {
    expect(daysBetween(d('2027-03-28'), d('2027-03-28'))).toBe(0);
    expect(daysBetween(d('2027-03-29'), d('2027-03-28'))).toBe(-1);
  });
});

describe('monthOf / monthsSpanned', () => {
  it('monthOf takes YYYY-MM and validates', () => {
    expect(monthOf(d('2028-02-29'))).toBe('2028-02');
    const bad: string = '2027-02-29';
    // why: a plain string is not an IsoDate; Reflect.apply passes it untyped, since the runtime guard is under test.
    expect(() => Reflect.apply(monthOf, undefined, [bad])).toThrow(RangeError);
  });
  it('spans the default window: 2026-10-21 .. 2027-04-20 is seven months', () => {
    expect(monthsSpanned(d('2026-10-21'), d('2027-04-20'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
  });
  it('is one month for a single day and empty when reversed', () => {
    expect(monthsSpanned(d('2027-03-28'), d('2027-03-28'))).toEqual(['2027-03']);
    expect(monthsSpanned(d('2027-03-29'), d('2027-03-28'))).toEqual([]);
  });
});
