import { decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { countsOf, inStay, isFullStay, stayRange } from '../../../../src/views/Dates/stayScope.js';
import { at, bucketsOf, DATES_SPACE, datesResponse, priced, pricedPair } from '../../../fixtures.dates.js';

// Spec §11 Filters: the stay range is applied in the browser to the decoded date pairs before ranking and shading, and
// the header line then sums those date pairs' own counts. Pure; Stryker runs it (revision 50).

const decoded = decodeDatePairs(
  datesResponse({
    rest: { no_data: 3, error: 1 },
    pairs: (i, d) =>
      d.nights === 10
        ? {
            buckets: bucketsOf({ priced: 1, empty: 1, skipped: 1, reused: 1 }),
            selected: 1,
            itinerarySearched: 1,
            onDemand: i % 2,
          }
        : {},
  }),
);

describe('inStay', () => {
  it('keeps the date pairs whose stay is inside the range, both ends included, in index order', () => {
    const kept = inStay(decoded.pairs, { min: 11, max: 12 });
    expect(kept.map((p) => p.nights)).toEqual(Array.from({ length: 31 }, () => [11, 12]).flat());
    expect(kept.map((p) => p.index)).toEqual([...kept.map((p) => p.index)].sort((a, b) => a - b));
    expect(inStay(decoded.pairs, { min: 10, max: 10 }).every((p) => p.nights === 10)).toBe(true);
    expect(inStay(decoded.pairs, { min: 12, max: 12 })).toHaveLength(31);
  });
  it('no range is every date pair, the same array', () => {
    expect(inStay(decoded.pairs, null)).toBe(decoded.pairs);
  });
  it('a range outside the space keeps nothing', () => {
    expect(inStay(decoded.pairs, { min: 20, max: 21 })).toEqual([]);
  });
});

describe('countsOf: the header line is the sum of the date pairs in view', () => {
  it('sums every bucket, reused, the cell total and the itinerary counts', () => {
    const tens = inStay(decoded.pairs, { min: 10, max: 10 });
    expect(countsOf(tens)).toEqual({
      buckets: { priced: 31, empty: 31, no_data: 0, error: 0, skipped: 31, not_run: 31, reused: 31 },
      total: 124,
      selected: 31,
      itinerarySearched: 31,
      onDemand: 15,
      reused: 31,
    });
  });
  it('over every date pair it equals the route’s own summary', () => {
    expect(countsOf(decoded.pairs)).toEqual(decoded.summary);
  });
  it('nothing in view counts nothing', () => {
    expect(countsOf([])).toEqual({
      buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
      total: 0,
      selected: 0,
      itinerarySearched: 0,
      onDemand: 0,
      reused: 0,
    });
  });
});

describe('stayRange and isFullStay: the stay range the view shows', () => {
  it('no filter is the space’s whole range', () => {
    expect(stayRange(DATES_SPACE, null)).toEqual({ min: 10, max: 12 });
    expect(isFullStay(DATES_SPACE, null)).toBe(true);
  });
  it('a filter is clipped to the space', () => {
    expect(stayRange(DATES_SPACE, { min: 11, max: 20 })).toEqual({ min: 11, max: 12 });
    expect(stayRange(DATES_SPACE, { min: 5, max: 10 })).toEqual({ min: 10, max: 10 });
  });
  it('a filter outside the space leaves no range', () => {
    expect(stayRange(DATES_SPACE, { min: 13, max: 20 })).toBeNull();
    expect(stayRange(DATES_SPACE, { min: 1, max: 9 })).toBeNull();
  });
  it('a filter covering the whole range is the same as none, so the header line reads the same', () => {
    expect(isFullStay(DATES_SPACE, { min: 10, max: 12 })).toBe(true);
    expect(isFullStay(DATES_SPACE, { min: 0, max: 90 })).toBe(true);
    expect(isFullStay(DATES_SPACE, { min: 10, max: 11 })).toBe(false);
    expect(isFullStay(DATES_SPACE, { min: 11, max: 12 })).toBe(false);
  });
  it('a filtered view of priced pairs keeps their figures', () => {
    const d = decodeDatePairs(
      datesResponse({ pairs: { [at('2027-03-14', 11)]: pricedPair(priced(30_000)) } }),
    );
    expect(inStay(d.pairs, { min: 11, max: 11 }).filter((p) => p.figure !== null)).toHaveLength(1);
  });
});
