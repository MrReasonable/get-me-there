import { asIsoDate, type DatePair, decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  arrival,
  boardModel,
  isSyntheticRead,
  PAGE_SIZE,
  sortBoard,
} from '../../../../src/views/Dates/board.js';
import {
  at,
  calendarFig,
  type DatesOptions,
  datesResponse,
  decodedDates,
  priced,
  pricedPair,
  provCached,
  provSearched,
  provSynthetic,
  verifiedFig,
} from '../../../fixtures.dates.js';
import { NOW } from '../../../render.js';

// Spec §11 Board, Filters: the stay filter applies first, then the rank (core's rankDatePairs, the price rank whatever
// the sort), then the week switch, then the sort. Pure; Stryker runs it (revision 50).

const pairsOf = (o: DatesOptions) => decodeDatePairs(datesResponse(o)).pairs;
const NO_FILTER = { nights: null, bestPerWeek: false, sort: { key: 'price', dir: 'asc' } } as const;
const indexes = (xs: readonly DatePair[]) => xs.map((p) => `${p.departureDate}/${p.nights}`);

/** Three priced date pairs: the 12-night one is cheapest, so a 10–11 stay filter moves the 3rd-ranked one to 1st. */
const three: DatesOptions = {
  pairs: {
    [at('2027-03-14', 12)]: pricedPair(priced(30_000)),
    [at('2027-03-15', 12)]: pricedPair(priced(31_000)),
    [at('2027-03-16', 10)]: pricedPair(priced(32_000)),
  },
};

describe('order of operations (spec §11 Filters; WP19 Task 19.4)', () => {
  it('the stay filter applies before ranking: it moves a date pair from rank 3 to rank 1', () => {
    const pairs = pairsOf(three);
    const all = boardModel(pairs, NO_FILTER, NOW);
    expect(all.rankOf.get(all.rows[2]?.index ?? -1)).toBe(3);
    expect(indexes(all.rows)).toEqual(['2027-03-14/12', '2027-03-15/12', '2027-03-16/10']);
    const filtered = boardModel(pairs, { ...NO_FILTER, nights: { min: 10, max: 11 } }, NOW);
    expect(indexes(filtered.rows)).toEqual(['2027-03-16/10']);
    expect(filtered.rankOf.get(filtered.rows[0]?.index ?? -1)).toBe(1);
  });

  it('only date pairs in the stay range are in view, every one of them (with or without a figure)', () => {
    const pairs = pairsOf(three);
    const m = boardModel(pairs, { ...NO_FILTER, nights: { min: 11, max: 12 } }, NOW);
    expect(m.inView.every((p) => p.nights >= 11 && p.nights <= 12)).toBe(true);
    expect(m.inView).toHaveLength(31 * 2);
    expect(boardModel(pairs, NO_FILTER, NOW).inView).toBe(pairs);
  });

  it('rows are the date pairs with a figure, in rankDatePairs order (cheapest first)', () => {
    const m = boardModel(pairsOf(three), NO_FILTER, NOW);
    expect(m.ranked.map((p) => p.figure?.price.pricePence)).toEqual([30_000, 31_000, 32_000]);
    expect(m.rows).toEqual(m.ranked);
    expect(m.weeks).toBeNull();
  });

  it('the week switch applies after ranking: the first-ranked date pair of each Monday-start departure week', () => {
    // 14 Mar 2027 is a Sunday: 14 Mar is one week, 15–21 Mar the next
    const o: DatesOptions = {
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(priced(40_000)),
        [at('2027-03-15', 10)]: pricedPair(priced(35_000)),
        [at('2027-03-21', 10)]: pricedPair(priced(30_000)),
        [at('2027-03-22', 10)]: pricedPair(priced(45_000)),
      },
    };
    const m = boardModel(pairsOf(o), { ...NO_FILTER, bestPerWeek: true }, NOW);
    expect(indexes(m.rows)).toEqual(['2027-03-21/10', '2027-03-14/10', '2027-03-22/10']);
    expect(m.weeks).toBe(3);
    // the rank stays the price rank among every date pair in view
    expect(m.rows.map((p) => m.rankOf.get(p.index))).toEqual([1, 3, 4]);
  });

  it('shows ten rows at first', () => {
    expect(PAGE_SIZE).toBe(10);
  });
});

describe('sortBoard: the sort changes the order, never the rank (spec §11 Board)', () => {
  const o: DatesOptions = {
    pairs: {
      [at('2027-03-14', 12)]: pricedPair(
        verifiedFig({ journeyMinutes: 900, price: { ...verifiedFig().price, pricePence: 30_000 } }),
      ),
      [at('2027-03-15', 10)]: pricedPair(
        calendarFig({ price: { ...calendarFig().price, pricePence: 31_000 } }),
      ),
      [at('2027-03-16', 11)]: pricedPair(
        verifiedFig({ journeyMinutes: 700, price: { ...verifiedFig().price, pricePence: 32_000 } }),
      ),
      [at('2027-03-17', 10)]: pricedPair(
        verifiedFig({ journeyMinutes: 900, price: { ...verifiedFig().price, pricePence: 33_000 } }),
      ),
    },
  };
  const m = boardModel(pairsOf(o), NO_FILTER, NOW);
  const sorted = (key: 'price' | 'departure' | 'nights' | 'journey', dir: 'asc' | 'desc') =>
    indexes(sortBoard(m.rows, { key, dir }, m.rankOf));

  it('price ascending is the rank order; a second press reverses it', () => {
    expect(sorted('price', 'asc')).toEqual([
      '2027-03-14/12',
      '2027-03-15/10',
      '2027-03-16/11',
      '2027-03-17/10',
    ]);
    expect(sorted('price', 'desc')).toEqual([
      '2027-03-17/10',
      '2027-03-16/11',
      '2027-03-15/10',
      '2027-03-14/12',
    ]);
  });
  it('departure orders by departure date, then nights', () => {
    expect(sorted('departure', 'asc')).toEqual([
      '2027-03-14/12',
      '2027-03-15/10',
      '2027-03-16/11',
      '2027-03-17/10',
    ]);
    expect(sorted('departure', 'desc')).toEqual([
      '2027-03-17/10',
      '2027-03-16/11',
      '2027-03-15/10',
      '2027-03-14/12',
    ]);
  });
  it('nights orders by stay length, ties by rank', () => {
    expect(sorted('nights', 'asc')).toEqual([
      '2027-03-15/10',
      '2027-03-17/10',
      '2027-03-16/11',
      '2027-03-14/12',
    ]);
    expect(sorted('nights', 'desc')).toEqual([
      '2027-03-14/12',
      '2027-03-16/11',
      '2027-03-15/10',
      '2027-03-17/10',
    ]);
  });
  it('journey time orders by minutes, ties by rank, and an unknown journey time sorts last either way', () => {
    expect(sorted('journey', 'asc')).toEqual([
      '2027-03-16/11',
      '2027-03-14/12',
      '2027-03-17/10',
      '2027-03-15/10',
    ]);
    expect(sorted('journey', 'desc')).toEqual([
      '2027-03-14/12',
      '2027-03-17/10',
      '2027-03-16/11',
      '2027-03-15/10',
    ]);
  });
  it('two unknown journey times fall to the rank between themselves, whatever order they arrive in', () => {
    const o2: DatesOptions = {
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
        [at('2027-03-15', 10)]: pricedPair(priced(31_000)),
        [at('2027-03-16', 10)]: pricedPair(
          verifiedFig({ journeyMinutes: 600, price: { ...verifiedFig().price, pricePence: 32_000 } }),
        ),
        [at('2027-03-17', 10)]: pricedPair(
          verifiedFig({ journeyMinutes: 900, price: { ...verifiedFig().price, pricePence: 33_000 } }),
        ),
      },
    };
    const m2 = boardModel(pairsOf(o2), NO_FILTER, NOW);
    const reversed = [...m2.rows].reverse();
    for (const dir of ['asc', 'desc'] as const)
      expect(indexes(sortBoard(reversed, { key: 'journey', dir }, m2.rankOf)).slice(2), dir).toEqual([
        '2027-03-14/10',
        '2027-03-15/10',
      ]);
    expect(indexes(sortBoard(reversed, { key: 'journey', dir: 'asc' }, m2.rankOf)).slice(0, 2)).toEqual([
      '2027-03-16/10',
      '2027-03-17/10',
    ]);
    expect(indexes(sortBoard(reversed, { key: 'journey', dir: 'desc' }, m2.rankOf)).slice(0, 2)).toEqual([
      '2027-03-17/10',
      '2027-03-16/10',
    ]);
  });
  it('ties on the key fall to the rank whatever order the rows arrive in', () => {
    const reversed = [...m.rows].reverse();
    expect(indexes(sortBoard(reversed, { key: 'nights', dir: 'asc' }, m.rankOf))).toEqual(
      sorted('nights', 'asc'),
    );
    expect(indexes(sortBoard(reversed, { key: 'price', dir: 'asc' }, m.rankOf))).toEqual(
      sorted('price', 'asc'),
    );
  });
  it('a date pair without a figure has no journey key and sorts last', () => {
    const bare = pairsOf({}).slice(0, 1);
    expect(sortBoard([...bare, ...m.rows], { key: 'journey', dir: 'asc' }, m.rankOf).at(-1)).toBe(bare[0]);
  });
  it('does not change the input', () => {
    const before = indexes(m.rows);
    sortBoard(m.rows, { key: 'nights', dir: 'desc' }, m.rankOf);
    expect(indexes(m.rows)).toEqual(before);
  });
});

describe('arrival: "arrives HH:MM" and the day offset (spec §11 Board, revision 50)', () => {
  it('reads a well-formed local time and its date', () => {
    expect(arrival('2027-03-14T09:00', '2027-03-14T21:05')).toEqual({
      time: '21:05',
      date: asIsoDate('2027-03-14'),
      dayOffset: 0,
    });
  });
  it('an overnight arrival carries +1, and two days later +2', () => {
    expect(arrival('2027-03-14T18:30', '2027-03-15T06:40')?.dayOffset).toBe(1);
    expect(arrival('2027-03-31T22:00', '2027-04-02T06:40')).toEqual({
      time: '06:40',
      date: asIsoDate('2027-04-02'),
      dayOffset: 2,
    });
  });
  it('an arrival on an earlier date than its departure (a date-line crossing) shows no offset', () => {
    expect(arrival('2027-03-15T01:00', '2027-03-14T22:00')?.dayOffset).toBe(0);
  });
  it('without a well-formed departure the time still shows, with no offset', () => {
    expect(arrival(null, '2027-03-15T06:40')).toEqual({
      time: '06:40',
      date: asIsoDate('2027-03-15'),
      dayOffset: 0,
    });
    expect(arrival('soon', '2027-03-15T06:40')?.dayOffset).toBe(0);
  });
  it('the whole string is the local time: nothing before or after it', () => {
    expect(arrival(null, 'x2027-03-15T06:40')).toBeNull();
    expect(arrival(null, '2027-03-15T06:40x')).toBeNull();
  });
  it('nothing for a missing or malformed arrival: seconds, a zone, a bad date or hour', () => {
    for (const bad of [
      null,
      '',
      '2027-03-15',
      '2027-03-15T06:40:00',
      '2027-03-15T06:40Z',
      '2027-13-15T06:40',
      '2027-03-15T24:00',
      '2027-03-15T06:60',
      '2027-02-30T06:40',
    ])
      expect(arrival('2027-03-14T18:30', bad), String(bad)).toBeNull();
  });
});

describe('isSyntheticRead: the red banner, judged on the whole decoded read (spec §11 Dates, revision 50)', () => {
  const real = (pence: number) =>
    calendarFig({ price: { ...calendarFig().price, pricePence: pence, provenance: provCached() } });
  const read = (o: DatesOptions) => decodedDates({ discoveryProviders: ['travelpayouts'], ...o });

  it('nothing synthetic anywhere: no banner', () => {
    expect(
      isSyntheticRead(read({ pairs: { [at('2027-03-14', 10)]: pricedPair(real(30_000)) } }), undefined),
    ).toBe(false);
  });
  it('any figure synthetic, wherever it ranks', () => {
    const o = {
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(real(30_000)),
        [at('2027-04-13', 12)]: pricedPair(priced(90_000)),
      },
    };
    expect(isSyntheticRead(read(o), undefined)).toBe(true);
  });
  it('a synthetic source kind alone, or the fixture provider alone, is enough', () => {
    const kind = { pairs: { [at('2027-03-14', 10)]: pricedPair(real(30_000)) } };
    const d = read(kind);
    const pair = d.pairs[0];
    if (pair?.figure == null) throw new Error('fixture');
    pair.figure.price.provenance = { ...pair.figure.price.provenance, sourceKind: 'synthetic' };
    expect(isSyntheticRead(d, undefined)).toBe(true);
    pair.figure.price.provenance = {
      ...pair.figure.price.provenance,
      sourceKind: 'authorised-cached',
      providerId: 'fixture',
    };
    expect(isSyntheticRead(d, undefined)).toBe(true);
  });
  it('only a cheaper-cached provenance synthetic', () => {
    const fig = verifiedFig({
      price: { ...verifiedFig().price, provenance: provSearched() },
      cheaperCached: {
        pricePence: 20_000,
        provenance: provSynthetic(),
        stale: false,
        truncated: false,
        origin: calendarFig().origin,
        destination: calendarFig().destination,
      },
    });
    expect(isSyntheticRead(read({ pairs: { [at('2027-03-14', 10)]: pricedPair(fig) } }), undefined)).toBe(
      true,
    );
    const clean = verifiedFig({
      ...fig,
      cheaperCached: fig.cheaperCached === null ? null : { ...fig.cheaperCached, provenance: provCached() },
    });
    expect(isSyntheticRead(read({ pairs: { [at('2027-03-14', 10)]: pricedPair(clean) } }), undefined)).toBe(
      false,
    );
  });
  it('the fixture among the discovery providers, with no price at all', () => {
    expect(
      isSyntheticRead(decodedDates({ discoveryProviders: ['travelpayouts', 'fixture'] }), undefined),
    ).toBe(true);
  });
  it('the shown run names the fixture provider in its progress', () => {
    const run = { progress: [{ providerId: 'travelpayouts' }, { providerId: 'fixture' }] };
    expect(isSyntheticRead(read({}), run)).toBe(true);
    expect(isSyntheticRead(read({}), { progress: [{ providerId: 'travelpayouts' }] })).toBe(false);
  });
});
