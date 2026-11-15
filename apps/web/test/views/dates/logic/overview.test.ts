import { asIsoDate, asIsoMonth, type DatePair, type DatePairSpace } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  type DayModel,
  dayModel,
  dayName,
  dayScale,
  heatOf,
  monthsOf,
  panelOrder,
  stayMark,
  staysByDay,
  weeksOf,
} from '../../../../src/views/Dates/overview.js';
import { buildScale } from '../../../../src/views/Dates/shade.js';
import {
  bucketsOf,
  calendarFig,
  DATES_SPACE,
  decodedDates,
  figurePairing,
  type PairOver,
  pairingFig,
  priced,
  pricedPair,
  provCached,
} from '../../../fixtures.dates.js';

// Trips and Search plan, Ruling 18 (Task 9): the calendar's months, a day's mark and price, its name, the heat scale and
// the day panel's order. Pure; Stryker runs it.

const d = asIsoDate;
const DAY = d('2027-03-14');
/** The web tests' clock is 14 Oct 2026, so a March 2027 day has not departed. */
const TODAY = d('2026-10-14');

/** One day's stays (10, 11 and 12 nights), each as given by its nights, the rest with no cached data. */
function stays(over: Record<number, PairOver>, date: string = DAY): DatePair[] {
  const space: DatePairSpace = {
    departureFrom: d(date),
    departureTo: d(date),
    minNights: 10,
    maxNights: 12,
  };
  return decodedDates({
    space,
    pairs: (_i, at) => over[at.nights] ?? { buckets: bucketsOf({ no_data: 4 }) },
  }).pairs;
}

const model = (over: Record<number, PairOver>, date: string = DAY, today = TODAY): DayModel =>
  dayModel({ date: d(date), today }, stays(over, date));

describe('weeksOf (moved from the Calendar view; gridLogic.test.ts ported)', () => {
  it('weeks are Monday-first with null padding', () => {
    const weeks = weeksOf(asIsoMonth('2027-03'));
    expect(weeks[0]?.slice(0, 2)).toEqual([d('2027-03-01'), d('2027-03-02')]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeksOf(asIsoMonth('2027-05'))[0]?.[0]).toBeNull(); // 1 May 2027 is a Saturday
    expect(
      weeksOf(asIsoMonth('2027-05'))
        .flat()
        .filter((x) => x !== null),
    ).toHaveLength(31);
    expect(weeksOf(asIsoMonth('2027-05')).at(-1)?.at(-1)).toBeNull();
  });
});

describe('monthsOf: the months the window touches', () => {
  it('across a month end and a year boundary, in order', () => {
    expect(monthsOf(DATES_SPACE)).toEqual(['2027-03', '2027-04']);
    expect(monthsOf({ departureFrom: d('2027-12-20'), departureTo: d('2028-02-01') })).toEqual([
      '2027-12',
      '2028-01',
      '2028-02',
    ]);
    expect(monthsOf({ departureFrom: d('2027-03-14'), departureTo: d('2027-03-14') })).toEqual(['2027-03']);
    // a window from a month's last day to the next month's first, and across February in a leap year
    expect(monthsOf({ departureFrom: d('2027-01-31'), departureTo: d('2027-02-01') })).toEqual([
      '2027-01',
      '2027-02',
    ]);
    expect(monthsOf({ departureFrom: d('2028-01-31'), departureTo: d('2028-04-01') })).toEqual([
      '2028-01',
      '2028-02',
      '2028-03',
      '2028-04',
    ]);
  });
  it('none for an expired window', () => {
    expect(monthsOf({ departureFrom: d('2027-03-15'), departureTo: d('2027-03-14') })).toEqual([]);
  });
});

describe('staysByDay: each departure day’s stays in view', () => {
  it('groups the date pairs by departure date, each day’s stays in index order', () => {
    const pairs = decodedDates().pairs;
    const days = staysByDay(pairs);
    expect(days.size).toBe(31);
    expect(days.get(d('2027-03-14'))?.map((p) => p.nights)).toEqual([10, 11, 12]);
    expect(days.get(d('2027-04-13'))?.map((p) => p.index)).toEqual([90, 91, 92]);
    expect([...days.keys()][0]).toBe('2027-03-14');
  });
  it('a stay filter leaves each day only the stays in view', () => {
    const pairs = decodedDates().pairs.filter((p) => p.nights === 11);
    expect(
      staysByDay(pairs)
        .get(d('2027-03-20'))
        ?.map((p) => p.nights),
    ).toEqual([11]);
  });
});

// Review Focus 4: the calendar days, table-driven
describe('dayModel (Ruling 18, Review Focus 4)', () => {
  it.each<[string, Record<number, PairOver>, Partial<DayModel> & { pence: number | null }]>([
    [
      'priced plus couldn’t read: the priced stay’s calendar price',
      {
        10: pricedPair(priced(37_200)),
        11: { buckets: bucketsOf({ error: 4 }) },
      },
      { mark: 'priced', pence: 37_200, notSeenOnly: false },
    ],
    [
      'only no price',
      { 10: { buckets: bucketsOf({ empty: 4 }) }, 11: { buckets: bucketsOf({ empty: 4 }) } },
      { mark: 'no-price-shown', pence: null, notSeenOnly: false },
    ],
    [
      'only couldn’t read',
      {
        10: { buckets: bucketsOf({ error: 4 }) },
        11: { buckets: bucketsOf({ error: 4 }) },
        12: { buckets: bucketsOf({ error: 1, empty: 3 }) },
      },
      { mark: 'couldnt-read', pence: null, notSeenOnly: false },
    ],
    [
      'all not run',
      {
        10: { buckets: bucketsOf({}) },
        11: { buckets: bucketsOf({}) },
        12: { buckets: bucketsOf({}) },
      },
      { mark: 'not-searched', pence: null, notSeenOnly: false },
    ],
    [
      'one empty and three not run: not searched, never no price',
      {
        10: { buckets: bucketsOf({ empty: 1 }) },
        11: { buckets: bucketsOf({ empty: 4 }) },
        12: { buckets: bucketsOf({ empty: 4 }) },
      },
      { mark: 'not-searched', pence: null, notSeenOnly: false },
    ],
    [
      'superseded only: no price, "not seen again"',
      {
        10: pricedPair(priced(31_000, { superseded: true })),
        11: pricedPair(priced(30_000, { basis: 'verified', notSeenInLatest: { ageHours: 30 } })),
      },
      { mark: 'priced', pence: null, notSeenOnly: true },
    ],
    [
      'a superseded price beside a current one: the current one, even when dearer',
      {
        10: pricedPair(priced(31_000, { superseded: true })),
        11: pricedPair(priced(39_000)),
      },
      { mark: 'priced', pence: 39_000, notSeenOnly: false },
    ],
    [
      'stale: the stale price, its mark kept',
      { 10: pricedPair(priced(34_000, { price: { ...calendarFig().price, stale: 'refresh' } })) },
      { mark: 'priced', pence: 34_000, notSeenOnly: false },
    ],
    [
      'trip and lower calendar: the trip’s £480, with the dot, over the calendar’s £372',
      {
        10: pricedPair(priced(37_200)),
        11: pricedPair(
          pairingFig({
            pairing: figurePairing({ pricePence: 48_000, fromPence: 48_000 }),
            price: { ...pairingFig().price, pricePence: 48_000 },
          }),
        ),
      },
      { mark: 'priced', pence: 48_000, notSeenOnly: false },
    ],
    [
      'the cheapest of two trips; a read trip whose calendar price was superseded is still a trip',
      {
        10: pricedPair(priced(52_000, { basis: 'verified' })),
        12: pricedPair(
          pairingFig({
            superseded: true,
            pairing: figurePairing({ pricePence: 50_000, fromPence: 50_000 }),
            price: { ...pairingFig().price, pricePence: 50_000 },
          }),
        ),
      },
      { mark: 'priced', pence: 50_000, notSeenOnly: false },
    ],
    [
      'the lowest of several calendar prices, the first stay on a tie',
      {
        10: pricedPair(priced(40_000)),
        11: pricedPair(priced(38_000, { price: { ...calendarFig().price, provenance: provCached() } })),
        12: pricedPair(priced(38_000)),
      },
      { mark: 'priced', pence: 38_000, notSeenOnly: false },
    ],
  ])('%s', (_name, over, want) => {
    const m = model(over);
    expect(m.mark).toBe(want.mark);
    expect(m.price?.cell.pricePence ?? null).toBe(want.pence);
    expect(m.notSeenOnly).toBe(want.notSeenOnly);
    expect(m.stays.map((p) => p.nights)).toEqual([10, 11, 12]);
  });

  it('a trip prints with the dot and its own label; a calendar price without it, labelled by its source', () => {
    const trip = model({
      10: pricedPair(priced(37_200)),
      11: pricedPair(pairingFig()),
    }).price;
    expect([trip?.trip, trip?.kind]).toEqual([true, 'seller']);
    const cached = model({
      11: pricedPair(priced(38_000, { price: { ...calendarFig().price, provenance: provCached() } })),
    }).price;
    expect([cached?.trip, cached?.kind]).toEqual([false, 'cached']);
    // a tie on price: the first stay's (the cached price of 11 nights, not the 12 nights' calendar price)
    const tie = model({
      10: pricedPair(priced(40_000)),
      11: pricedPair(priced(38_000, { price: { ...calendarFig().price, provenance: provCached() } })),
      12: pricedPair(priced(38_000)),
    }).price;
    expect([tie?.cell.pricePence, tie?.kind]).toEqual([38_000, 'cached']);
    const tripTie = model({
      10: pricedPair(priced(50_000, { basis: 'verified', hasBookingOptions: true })),
      11: pricedPair(priced(50_000, { basis: 'verified' })),
    }).price;
    expect(tripTie?.kind).toBe('seller');
    const stale = model({
      10: pricedPair(priced(34_000, { price: { ...calendarFig().price, stale: 'refresh', ageHours: 300 } })),
    }).price;
    expect([stale?.cell.stale, stale?.cell.ageHours, stale?.kind]).toEqual(['refresh', 300, 'calendar']);
  });

  it('a departed day is blank and inert: out, with no stays, whatever it holds', () => {
    const over = { 10: pricedPair(priced(37_200)) };
    expect(model(over, '2026-10-13', d('2026-10-14'))).toEqual({
      mark: 'out',
      price: null,
      notSeenOnly: false,
      stays: [],
    });
    // the day itself has not departed
    expect(model(over, '2026-10-14', d('2026-10-14')).mark).toBe('priced');
  });

  it('an out day is never a button; its words, were it named, are a mark’s', () => {
    const out = dayModel({ date: DAY, today: d('2027-03-15') }, stays({}));
    expect(out.mark).toBe('out');
    expect(dayName(DAY, out)).toBe('Sun 14 Mar, not searched');
  });

  it('a day outside the window (no stays) is out', () => {
    expect(dayModel({ date: DAY, today: TODAY }, [])).toEqual({
      mark: 'out',
      price: null,
      notSeenOnly: false,
      stays: [],
    });
  });
});

describe('dayName: each day is a button named by its date and what it shows (Ruling 18)', () => {
  it('a calendar price: "Sun 14 Mar, £372, Calendar · 2h"', () => {
    expect(dayName(DAY, model({ 10: pricedPair(priced(37_200)) }))).toBe('Sun 14 Mar, £372, Calendar · 2h');
  });
  // fix round 1 (review I1): a price an earlier search found on a day the latest run has not reached keeps its price,
  // and the day's name still says what the latest run did there
  it('a price on a day the latest run did not reach or search: the price, then the day’s mark', () => {
    const earlier = (b: Parameters<typeof bucketsOf>[0]) => ({
      10: { buckets: bucketsOf(b), figure: pairingFig({ fromEarlierSearch: true }) },
      11: { buckets: bucketsOf(b) },
      12: { buckets: bucketsOf(b) },
    });
    const reached = model(earlier({ skipped: 4 }));
    expect([reached.mark, reached.price?.cell.pricePence]).toEqual(['not-reached', 118_000]);
    expect(dayName(DAY, reached)).toBe(
      'Sun 14 Mar, £1,180, Seller · 4h, trip with flights read, not reached',
    );
    expect(dayName(DAY, model(earlier({})))).toBe(
      'Sun 14 Mar, £1,180, Seller · 4h, trip with flights read, not searched',
    );
  });
  it('a trip: "…, £1,180, Seller · 4h, trip with flights read"', () => {
    expect(dayName(DAY, model({ 11: pricedPair(pairingFig()) }))).toBe(
      'Sun 14 Mar, £1,180, Seller · 4h, trip with flights read',
    );
  });
  it('a stale price says its stale words after its label', () => {
    expect(
      dayName(
        DAY,
        model({ 10: pricedPair(priced(34_000, { price: { ...calendarFig().price, stale: 'refresh' } })) }),
      ),
    ).toBe("Sun 14 Mar, £340, Calendar · 2h, older than this search's refresh");
  });
  it.each<[string, Record<number, PairOver>, string]>([
    ['not searched', { 10: { buckets: bucketsOf({}) } }, 'Sun 14 Mar, not searched'],
    [
      'no price',
      {
        10: { buckets: bucketsOf({ empty: 4 }) },
      },
      'Sun 14 Mar, no price',
    ],
    ['couldn’t read', { 10: { buckets: bucketsOf({ error: 4 }) } }, "Sun 14 Mar, couldn't read"],
    [
      'not reached',
      {
        10: { buckets: bucketsOf({ skipped: 4 }) },
        11: { buckets: bucketsOf({ skipped: 4 }) },
        12: { buckets: bucketsOf({ skipped: 4 }) },
      },
      'Sun 14 Mar, not reached',
    ],
    [
      'not seen again',
      { 10: pricedPair(priced(31_000, { superseded: true })) },
      'Sun 14 Mar, not seen again',
    ],
    [
      'priced with no price that can be shown',
      { 10: { buckets: bucketsOf({ priced: 1, no_data: 3 }), journeyLeftOut: 1 } },
      'Sun 14 Mar, no price to show',
    ],
  ])('%s', (_name, over, name) => {
    expect(dayName(DAY, model(over))).toBe(name);
  });
});

describe('dayScale and heatOf: the heat ramp over the printed prices, current only (Ruling 18)', () => {
  const days = (prices: Array<number | null>): DayModel[] =>
    prices.map((p) =>
      model(
        p === null ? { 10: pricedPair(priced(10_000, { superseded: true })) } : { 10: pricedPair(priced(p)) },
      ),
    );

  it('is the quintile scale of the days’ printed prices, not-seen days left off', () => {
    const prices = [30_000, 31_000, 32_000, 33_000, 34_000, 35_000, 36_000, 37_000, 38_000, 39_000];
    const scale = dayScale([...days(prices), ...days([null, null])]);
    expect(scale.count).toBe(10);
    expect([scale.minPence, scale.maxPence]).toEqual([30_000, 39_000]);
    expect(scale.mode).toBe(buildScale(prices).mode);
  });

  it('lower prices take the first steps of the ramp, higher the last', () => {
    const prices = [30_000, 31_000, 32_000, 33_000, 34_000, 35_000, 36_000, 37_000, 38_000, 39_000];
    const scale = dayScale(days(prices));
    expect(prices.map((p) => heatOf(scale, p))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('too few prices, or too narrow a spread, take the one flat step', () => {
    expect(heatOf(dayScale(days([30_000, 40_000])), 30_000)).toBe('flat');
    const narrow = Array.from({ length: 12 }, (_x, i) => 40_000 + i * 100);
    expect(heatOf(dayScale(days(narrow)), 40_000)).toBe('flat');
  });
});

describe('stayMark: a stay with no price to show (the day panel’s rows)', () => {
  it.each<[string, PairOver, ReturnType<typeof stayMark>]>([
    ['no price', { buckets: bucketsOf({ empty: 4 }) }, 'no-price-shown'],
    ['no cached data', { buckets: bucketsOf({ no_data: 4 }) }, 'no-price-shown'],
    ['couldn’t read', { buckets: bucketsOf({ error: 1, empty: 3 }) }, 'couldnt-read'],
    ['not reached', { buckets: bucketsOf({ skipped: 4 }) }, 'not-reached'],
    ['not searched', { buckets: bucketsOf({ empty: 1 }) }, 'not-searched'],
    [
      'every price over the journey limit',
      { buckets: bucketsOf({ priced: 1, empty: 3 }), journeyLeftOut: 1 },
      'over-limit',
    ],
    ['a price that can’t be shown', { buckets: bucketsOf({ priced: 1, empty: 3 }) }, 'unshown'],
  ])('%s', (_name, over, mark) => {
    const [p] = stays({ 10: over });
    if (p === undefined) throw new Error('no stay');
    expect(stayMark(p)).toBe(mark);
  });
});

describe('panelOrder: the day panel lists trips, then the other prices, then the stays without one', () => {
  it('trips by price, then calendar and not-seen prices by price, then the rest in stay order', () => {
    const space: DatePairSpace = { departureFrom: DAY, departureTo: DAY, minNights: 10, maxNights: 16 };
    const by: Record<number, PairOver> = {
      10: { buckets: bucketsOf({ empty: 4 }) },
      11: pricedPair(priced(39_000)),
      12: pricedPair(priced(52_000, { basis: 'verified' })),
      13: { buckets: bucketsOf({ error: 4 }) },
      14: pricedPair(priced(36_000, { superseded: true })),
      15: pricedPair(pairingFig()),
      16: pricedPair(priced(37_000)),
    };
    const pairs = decodedDates({
      space,
      pairs: (_i, at) => by[at.nights] ?? {},
    }).pairs;
    expect(panelOrder(pairs).map((p) => p.nights)).toEqual([12, 15, 14, 16, 11, 10, 13]);
  });
});
