import { BANNED_WORD_ALLOWLIST, type DatePair, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { howFarChecked } from '../../../../src/views/Dates/howFar.js';
import { bucketsOf, calendarFig, datePairOf, verifiedFig } from '../../../fixtures.dates.js';

// Spec §11 "How far checked": from the date pair's own counts, never the "searched" umbrella, never a word claiming
// completeness, and "verified" only beside a class-verified figure. Pure; Stryker runs it (revision 50).

/** A date pair over `airportPairs`, with the counts given. */
function pair(over: Partial<DatePair>): DatePair {
  return { ...datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null }), ...over };
}
const words = (p: DatePair, airportPairs = 4, limit: number | null = null) =>
  howFarChecked(p, airportPairs, limit);

describe('the figure: class verified or a calendar price', () => {
  it('a class-verified figure says verified', () => {
    expect(words(pair({ figure: verifiedFig(), buckets: bucketsOf({ priced: 4 }) }))[0]).toBe('verified');
  });
  it('a calendar figure says it is a calendar price whose constraints are not checked', () => {
    expect(words(pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 4 }) }))[0]).toBe(
      'calendar price, constraints not checked',
    );
  });
  it('"verified" never stands beside a calendar figure', () => {
    const all = words(
      pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 4 }), partiallyVerified: 0 }),
    );
    expect(all.some((w) => /(?<!\p{L})verified/u.test(w))).toBe(false);
  });
});

describe('the itinerary stage: itinerary-searched, selected but not reached, or not selected', () => {
  const priced = { figure: calendarFig(), buckets: bucketsOf({ priced: 4 }) };
  it('itinerary-searched cells, of the airport pairs', () => {
    expect(words(pair({ ...priced, selected: 2, itinerarySearched: 2 }))).toContain(
      'itinerary-searched 2 of 4 airport pairs',
    );
    expect(words(pair({ ...priced, selected: 1, itinerarySearched: 1 }), 1)).toContain(
      'itinerary-searched 1 of 1 airport pair',
    );
  });
  it('selected but not reached, by its own count', () => {
    expect(words(pair({ ...priced, selected: 2, notReached: 2 }))).toContain('2 selected but not reached');
  });
  it('a selected cell in error is worded as an error, never "not reached"', () => {
    const w = words(pair({ ...priced, selected: 1 }));
    expect(w).toContain('1 selected, itinerary search error or skipped');
    expect(w.join(' ')).not.toContain('not reached');
  });
  it('the three together, each by its count', () => {
    expect(words(pair({ ...priced, selected: 4, itinerarySearched: 1, notReached: 2 }))).toEqual(
      expect.arrayContaining([
        'itinerary-searched 1 of 4 airport pairs',
        '2 selected but not reached',
        '1 selected, itinerary search error or skipped',
      ]),
    );
  });
  it('nothing selected says so; on-demand searches are counted apart', () => {
    expect(words(pair(priced))).toContain('not selected for itinerary search');
    expect(words(pair({ ...priced, onDemand: 1 }))).toEqual(
      expect.arrayContaining(['not selected for itinerary search', '+1 on demand']),
    );
  });
});

describe('partially-verified and unconfirmed prices', () => {
  it('counts each', () => {
    const w = words(
      pair({
        figure: calendarFig(),
        buckets: bucketsOf({ priced: 4 }),
        partiallyVerified: 2,
        unconfirmed: 1,
      }),
    );
    expect(w).toContain('2 partially verified');
    expect(w).toContain('1 price not confirmed');
  });
});

describe('the airport pairs without a price, by bucket', () => {
  it('names each unpriced bucket with its count, and the not searched ones as a share of the airport pairs', () => {
    const w = words(
      pair({
        figure: calendarFig(),
        buckets: bucketsOf({ priced: 1, empty: 1, no_data: 3, error: 2, skipped: 1, not_run: 1 }, 9),
      }),
      9,
    );
    expect(w).toEqual(
      expect.arrayContaining([
        '1 no fares',
        '3 no cached data',
        '2 error',
        '1 skipped',
        '1 of 9 airport pairs not searched',
      ]),
    );
    expect(w.join(' ')).not.toMatch(/\bpriced\b/);
  });
  it('a bucket with no airport pair in it is not named', () => {
    expect(
      words(pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 1, no_data: 3 }) })).join(' '),
    ).not.toMatch(/no fares|error|skipped|not searched/);
  });
});

describe('a price from an earlier search (revision 50)', () => {
  it('says so exactly when the figure was fetched before the latest parent run', () => {
    expect(
      words(pair({ figure: verifiedFig({ fromEarlierSearch: true }), buckets: bucketsOf({ priced: 1 }) })),
    ).toContain('price from an earlier search');
  });
  it('never on a figure the latest run fetched while another airport pair is not searched', () => {
    const w = words(pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 1, not_run: 1 }, 2) }), 2);
    expect(w).not.toContain('price from an earlier search');
    expect(w).toContain('1 of 2 airport pairs not searched');
  });
});

describe('a truncated figure', () => {
  it('says the read was cut short', () => {
    const fig = calendarFig({ price: { ...calendarFig().price, truncated: true } });
    expect(words(pair({ figure: fig, buckets: bucketsOf({ priced: 1 }) }))).toContain('read was cut short');
    expect(words(pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 1 }) }))).not.toContain(
      'read was cut short',
    );
  });
});

describe('a date pair without a figure', () => {
  it('every price left out for a known journey time reads "none within <limit>" with its marks, never "no fares"', () => {
    const w = words(
      pair({ figure: null, journeyLeftOut: 1, buckets: bucketsOf({ priced: 1, no_data: 3 }) }),
      4,
      600,
    );
    expect(w[0]).toBe('none within 10h 00m');
    expect(w).toContain('3 no cached data');
    expect(w.join(' ')).not.toContain('no fares');
  });
  it('a date pair that had no price keeps its own marks, never "none within"', () => {
    const w = words(pair({ figure: null, buckets: bucketsOf({ no_data: 2 }) }), 4, 600);
    expect(w.join(' ')).not.toContain('none within');
    expect(w).toEqual(['2 no cached data', '2 of 4 airport pairs not searched']);
  });
});

describe('never the umbrella, never a banned word', () => {
  it('over every branch', () => {
    const all = [
      words(
        pair({
          figure: verifiedFig({ fromEarlierSearch: true }),
          buckets: bucketsOf({ priced: 1, empty: 1, no_data: 1, error: 1 }, 5),
          selected: 3,
          itinerarySearched: 1,
          notReached: 1,
          onDemand: 1,
          partiallyVerified: 1,
          unconfirmed: 1,
        }),
        5,
      ),
      words(pair({ figure: null, journeyLeftOut: 1, buckets: bucketsOf({ priced: 1, skipped: 3 }) }), 4, 900),
    ].flat();
    expect(
      all.filter((w) => /(?<![\p{L}-])searched\b/u.test(w) && !/not searched|itinerary-searched/.test(w)),
    ).toEqual([]);
    expect(findBannedWords(all.join('\n'), BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});

describe('exact lines (each part only when its count is non-zero)', () => {
  it('a calendar figure on a date pair nothing selected, all priced, reads exactly two parts', () => {
    expect(words(pair({ figure: calendarFig(), buckets: bucketsOf({ priced: 4 }) }))).toEqual([
      'calendar price, constraints not checked',
      'not selected for itinerary search',
    ]);
  });
  it('a fully itinerary-searched selection reads its count and nothing else of the stage', () => {
    expect(
      words(
        pair({ figure: verifiedFig(), buckets: bucketsOf({ priced: 4 }), selected: 2, itinerarySearched: 2 }),
      ),
    ).toEqual(['verified', 'itinerary-searched 2 of 4 airport pairs']);
  });
  it('without a journey limit, a left-out count never reads "none within"', () => {
    expect(
      words(pair({ figure: null, journeyLeftOut: 1, buckets: bucketsOf({ priced: 4 }) }), 4, null),
    ).toEqual([]);
  });
});
