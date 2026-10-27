import { describe, expect, it } from 'vitest';
import { oneOf } from '../../src/state/oneOf.js';
import {
  int,
  isSortDir,
  list,
  nightsRange,
  safeInt,
  sortToken,
  uniqueIataList,
} from '../../src/state/parse.js';

// The URL parsers shared by resultsState and datesState (WP19 §4: moved out of resultsState.ts, whose own tests stay
// the pin for the Results parameters). These are pure, and Stryker runs them (spec §9 item 6, revision 50).

describe('list: a comma list, empty tokens dropped', () => {
  it('splits on commas and drops empty tokens', () => {
    expect(list('LHR,LGW')).toEqual(['LHR', 'LGW']);
    expect(list('LHR,,LGW,')).toEqual(['LHR', 'LGW']);
  });
  it('an absent or empty parameter is the empty list', () => {
    expect(list(null)).toEqual([]);
    expect(list('')).toEqual([]);
  });
});

describe('safeInt and int: whole numbers only, never coerced', () => {
  it('accepts digits only', () => {
    expect(safeInt('0')).toBe(0);
    expect(safeInt('600')).toBe(600);
  });
  it('refuses signs, decimals, blanks, exponents and anything past 2^53', () => {
    for (const bad of ['-1', '+1', '1.5', '', ' 1', '1e3', '0x10', '9007199254740993'])
      expect(safeInt(bad)).toBeUndefined();
    expect(safeInt('9007199254740991')).toBe(9007199254740991);
  });
  it('int reads an absent parameter as undefined', () => {
    expect(int(null)).toBeUndefined();
    expect(int('14')).toBe(14);
    expect(int('x')).toBeUndefined();
  });
});

describe('nightsRange: "min-max", both whole, min ≤ max', () => {
  it('reads a range, one night included', () => {
    expect(nightsRange('10-14')).toEqual({ min: 10, max: 14 });
    expect(nightsRange('12-12')).toEqual({ min: 12, max: 12 });
    expect(nightsRange('0-90')).toEqual({ min: 0, max: 90 });
  });
  it('a reversed or malformed range is no range', () => {
    for (const bad of [null, '', '14-10', '10', '10-', '-14', '10-14-16', 'a-b', '10 - 14', '1.5-3'])
      expect(nightsRange(bad), String(bad)).toBeNull();
  });
});

describe('sortToken: "<key>.<asc|desc>", exactly two segments', () => {
  const isKey = oneOf(['price', 'nights'] as const);
  it('reads a known key and direction', () => {
    expect(sortToken('price.asc', isKey)).toEqual({ key: 'price', dir: 'asc' });
    expect(sortToken('nights.desc', isKey)).toEqual({ key: 'nights', dir: 'desc' });
  });
  it('refuses an unknown key, an unknown direction, a missing or an extra segment', () => {
    for (const bad of [null, '', 'journey.asc', 'price.up', 'price', 'price.asc.extra', '.asc'])
      expect(sortToken(bad, isKey), String(bad)).toBeNull();
  });
  it('isSortDir knows the two directions only', () => {
    expect(isSortDir('asc')).toBe(true);
    expect(isSortDir('desc')).toBe(true);
    expect(isSortDir('ASC')).toBe(false);
  });
});

describe('uniqueIataList: only codes core accepts, as spelled, each once', () => {
  it('keeps three upper-case letters and drops the rest', () => {
    expect(uniqueIataList('LHR,lgw,LON1,JFK')).toEqual(['LHR', 'JFK']);
  });
  it('drops a repeat, keeping the first place', () => {
    expect(uniqueIataList('JFK,EWR,JFK')).toEqual(['JFK', 'EWR']);
  });
  it('an absent parameter is the empty list', () => {
    expect(uniqueIataList(null)).toEqual([]);
  });
});
