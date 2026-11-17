import { type DatePair, decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../../src/copy.js';
import { isSyntheticRead } from '../../../../src/lib/bookingTarget.js';
import type { ListsState } from '../../../../src/lib/flightReads.js';
import {
  boardModel,
  FIRST_PAGE,
  flightReadLine,
  LOWER_SHOWN,
  nextPage,
  PAGE_SIZE,
  sellerOf,
  shownCount,
} from '../../../../src/views/Dates/board.js';
import {
  at,
  calendarFig,
  type DatesOptions,
  datesResponse,
  decodedDates,
  figurePairing,
  pairingFig,
  priced,
  pricedPair,
  provCached,
  provFlightList,
  provSearched,
  provSynthetic,
  verifiedFig,
} from '../../../fixtures.dates.js';
import { NOW } from '../../../render.js';

// Design 2026-11-08 §5.2, Rulings 3–6: the stay filter applies first, then the rank (core's rankDatePairs), then core's
// shared rules split it into Cheapest trips and Lower on the calendar, each one per week with the switch on; five
// trips, then ten more per press; three lower dates. Pure; Stryker runs it (revision 50).

const pairsOf = (o: DatesOptions) => decodeDatePairs(datesResponse(o)).pairs;
const NO_FILTER = { nights: null, bestPerWeek: false } as const;
const indexes = (xs: readonly DatePair[]) => xs.map((p) => `${p.departureDate}/${p.nights}`);
const trip = (pence: number) =>
  pairingFig({
    pairing: figurePairing({ pricePence: pence, fromPence: pence }),
    price: { ...pairingFig().price, pricePence: pence },
  });

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
    expect(indexes(all.ranked)).toEqual(['2027-03-14/12', '2027-03-15/12', '2027-03-16/10']);
    const filtered = boardModel(pairs, { ...NO_FILTER, nights: { min: 10, max: 11 } }, NOW);
    expect(indexes(filtered.ranked)).toEqual(['2027-03-16/10']);
    expect(indexes(filtered.lower)).toEqual(['2027-03-16/10']);
  });

  it('only date pairs in the stay range are in view, every one of them (with or without a figure)', () => {
    const pairs = pairsOf(three);
    const m = boardModel(pairs, { ...NO_FILTER, nights: { min: 11, max: 12 } }, NOW);
    expect(m.inView.every((p) => p.nights >= 11 && p.nights <= 12)).toBe(true);
    expect(m.inView).toHaveLength(31 * 2);
    expect(boardModel(pairs, NO_FILTER, NOW).inView).toBe(pairs);
  });

  it('the ranking is the date pairs with a figure, in rankDatePairs order (cheapest first)', () => {
    const m = boardModel(pairsOf(three), NO_FILTER, NOW);
    expect(m.ranked.map((p) => p.figure?.price.pricePence)).toEqual([30_000, 31_000, 32_000]);
  });
});

describe("the two sections (Rulings 3–6: core's shared rules over the ranking)", () => {
  const mixed: DatesOptions = {
    pairs: {
      [at('2027-03-14', 10)]: pricedPair(trip(48_000)),
      [at('2027-03-15', 10)]: pricedPair(trip(41_200)),
      [at('2027-03-16', 10)]: pricedPair(priced(37_200)),
      [at('2027-03-17', 10)]: pricedPair(priced(39_000)),
      // above the cheapest trip: not lower
      [at('2027-03-18', 10)]: pricedPair(priced(45_000)),
      // a superseded calendar price is not lower, however cheap
      [at('2027-03-19', 10)]: pricedPair(priced(20_000, { superseded: true })),
      // flights read, none within the limits: not lower, but read and over the limit
      [at('2027-03-20', 10)]: pricedPair(priced(30_000, { pairingRead: 'over-limit' })),
      // a calendar price whose flights failed to read: lower, its flights not read
      [at('2027-03-21', 10)]: pricedPair(
        priced(38_000, { pairingRead: 'list-failed', listReason: 'network' }),
      ),
    },
  };

  it('Cheapest trips are the trips in rank order; Lower on the calendar the calendar prices below the cheapest, by price', () => {
    const m = boardModel(pairsOf(mixed), NO_FILTER, NOW);
    expect(m.trips.map((p) => p.figure.price.pricePence)).toEqual([41_200, 48_000]);
    expect(m.lower.map((p) => p.figure.price.pricePence)).toEqual([37_200, 38_000, 39_000]);
  });

  it('counts the dates over the journey limit, and the dates with flights read (trips and reads with none)', () => {
    const m = boardModel(pairsOf(mixed), NO_FILTER, NOW);
    expect(m.overLimit).toBe(1);
    // two trips and the over-limit read; a failed read is not a read
    expect(m.readDates).toBe(3);
  });

  it('with no trip every current calendar price is lower, cheapest first', () => {
    const m = boardModel(pairsOf(three), NO_FILTER, NOW);
    expect(m.trips).toEqual([]);
    expect(m.lower.map((p) => p.figure.price.pricePence)).toEqual([30_000, 31_000, 32_000]);
    expect(m.readDates).toBe(0);
    expect(m.overLimit).toBe(0);
  });

  it('the stay filter narrows both sections and their counts', () => {
    const m = boardModel(pairsOf(mixed), { ...NO_FILTER, nights: { min: 11, max: 12 } }, NOW);
    expect([m.trips, m.lower, m.overLimit, m.readDates]).toEqual([[], [], 0, 0]);
  });

  it("the week switch keeps each section's first of each Monday-start departure week, in its own order", () => {
    // 14 Mar 2027 is a Sunday: 14 Mar is one week, 15–21 Mar the next, 22 Mar the one after
    const o: DatesOptions = {
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(trip(60_000)),
        [at('2027-03-15', 10)]: pricedPair(trip(55_000)),
        [at('2027-03-16', 10)]: pricedPair(trip(50_000)),
        [at('2027-03-17', 10)]: pricedPair(priced(30_000)),
        [at('2027-03-18', 10)]: pricedPair(priced(32_000)),
        [at('2027-03-22', 10)]: pricedPair(priced(31_000)),
      },
    };
    const m = boardModel(pairsOf(o), { ...NO_FILTER, bestPerWeek: true }, NOW);
    expect(indexes(m.trips)).toEqual(['2027-03-16/10', '2027-03-14/10']);
    expect(indexes(m.lower)).toEqual(['2027-03-17/10', '2027-03-22/10']);
    // the rank stays the rank among every date pair in view
    expect(m.trips.map((p) => m.ranked.indexOf(p) + 1)).toEqual([1, 3]);
  });
});

describe('paging (Rulings 4 and 5: five trips, then "Show 10 more"; three lower dates)', () => {
  it('the numbers', () => {
    expect([FIRST_PAGE, PAGE_SIZE, LOWER_SHOWN]).toEqual([5, 10, 3]);
  });

  it('shownCount: five, then ten more per press, never more than there are', () => {
    expect([0, 3, 5, 6, 40].map((n) => shownCount(n, 0))).toEqual([0, 3, 5, 5, 5]);
    expect([0, 3, 5, 6, 15, 16, 40].map((n) => shownCount(n, 1))).toEqual([0, 3, 5, 6, 15, 15, 15]);
    expect(shownCount(40, 2)).toBe(25);
  });

  it('nextPage: up to ten, what is left, none when every row shows', () => {
    expect(nextPage(40, 5)).toBe(10);
    expect(nextPage(15, 5)).toBe(10);
    expect(nextPage(12, 5)).toBe(7);
    expect(nextPage(5, 5)).toBe(0);
    expect(nextPage(3, 3)).toBe(0);
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
  it("R-synthetic (prov-r3-008): a pairing figure's fixture-provider grid price is enough", () => {
    const clean = pairingFig();
    expect(isSyntheticRead(read({ pairs: { [at('2027-03-14', 10)]: pricedPair(clean) } }), undefined)).toBe(
      false,
    );
    const grid = pairingFig({
      gridPrice: { pricePence: 56_400, provenance: provSynthetic(), stale: false, truncated: false },
    });
    expect(isSyntheticRead(read({ pairs: { [at('2027-03-14', 10)]: pricedPair(grid) } }), undefined)).toBe(
      true,
    );
  });
  it('R-synthetic: a calendar figure whose pairing beneath names the fixture provider is enough', () => {
    const fig = (provenance: ReturnType<typeof provSynthetic>) =>
      calendarFig({
        price: { ...calendarFig().price, provenance: provCached() },
        pairingRead: 'within-older',
        pairing: figurePairing({ provenance, stale: 'refresh' }),
      });
    expect(
      isSyntheticRead(
        read({ pairs: { [at('2027-03-14', 10)]: pricedPair(fig(provFlightList())) } }),
        undefined,
      ),
    ).toBe(false);
    expect(
      isSyntheticRead(
        read({ pairs: { [at('2027-03-14', 10)]: pricedPair(fig(provSynthetic())) } }),
        undefined,
      ),
    ).toBe(true);
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

describe('flightReadLine: what a figure says of its flight read (spec rev 56 §6.9, §11 Board)', () => {
  const D = COPY.datesView;
  const reason = (d: string) => `the words for ${d}`;
  const line = (f: ReturnType<typeof calendarFig>, lists: ListsState = 'available') =>
    flightReadLine(f, lists, COPY, reason);
  it("within says nothing beneath (it is a pairing figure's own read), whatever the basis", () => {
    expect(line(calendarFig({ pairingRead: 'within' }))).toBeNull();
    expect(line(calendarFig({ pairingRead: 'within' }), 'unavailable')).toBeNull();
  });
  it('a pairing figure says nothing here (its own lines are beneath its price)', () => {
    expect(line(pairingFig())).toBeNull();
  });
  it('not-read: "flights not checked" where flight lists are read, nothing where they are not', () => {
    expect(line(calendarFig())).toEqual({ lead: 'flights not checked', pairing: null });
    expect(line(calendarFig(), 'unavailable')).toBeNull();
  });
  it('21.7 prov-004: "loading flights" while the flight-lists request is pending; the mark kept when it failed', () => {
    expect(line(calendarFig(), 'loading')).toEqual({ lead: 'loading flights', pairing: null });
    expect(line(calendarFig(), 'failed')).toEqual({ lead: 'flights not checked', pairing: null });
    // why: a read the date-pairs answer carries says its own words whatever the flight-lists request did
    expect(line(calendarFig({ pairingRead: 'outbound-only' }), 'loading')).toEqual({
      lead: 'return leg not read',
      pairing: null,
    });
  });
  it('21.7 ui-008 / code M9: a failed list with no reason (outside the contract) has no trailing colon', () => {
    // why: spread past the contract on purpose: the words never end in an empty cause
    expect(
      line({ ...calendarFig({ pairingRead: 'list-failed', listReason: 'network' }), listReason: null }),
    ).toEqual({
      lead: "flights couldn't be read",
      pairing: null,
    });
  });
  it('the 21.6 ruling: a failed newest list is "flights couldn\'t be read: <its reason>", never "return leg not read"', () => {
    expect(line(calendarFig({ pairingRead: 'list-failed', listReason: 'network' }))).toEqual({
      lead: "flights couldn't be read: the words for network",
      pairing: null,
    });
  });
  it('outbound-only "return leg not read"; no-pairing-read "no return flight read"', () => {
    expect(line(calendarFig({ pairingRead: 'outbound-only' }))).toEqual({
      lead: 'return leg not read',
      pairing: null,
    });
    expect(line(calendarFig({ pairingRead: 'no-pairing-read' }))).toEqual({
      lead: 'no return flight read',
      pairing: null,
    });
  });
  it('the reads with a pairing beneath, each with its lead words', () => {
    const p = figurePairing({ stale: 'refresh', ageHours: 216 });
    expect(line(calendarFig({ pairingRead: 'within-older', pairing: p }))).toEqual({
      lead: "return flights read 9d ago, older than this search's refresh:",
      pairing: p,
    });
    const q = figurePairing();
    expect(line(calendarFig({ pairingRead: 'within-other-limits', pairing: q }))).toEqual({
      lead: 'your limits have changed since these return flights were read:',
      pairing: q,
    });
    const from = figurePairing({
      isFrom: true,
      seller: null,
      offersRead: 0,
      complete: false,
      which: 'over-limit',
      pricePence: 120_400,
      fromPence: 120_400,
    });
    expect(line(calendarFig({ pairingRead: 'over-limit', pairing: from }))).toEqual({
      lead: 'no pairing within your limits read',
      pairing: from,
    });
    expect(line(calendarFig({ pairingRead: 'sellers-not-read', pairing: from }))).toEqual({
      lead: null,
      pairing: from,
    });
    const partial = figurePairing({ complete: false });
    expect(line(calendarFig({ pairingRead: 'offers-incomplete', pairing: partial }))).toEqual({
      lead: null,
      pairing: partial,
    });
  });
  it("a fresh verified figure says nothing; a stale one carries its date pair's read (ruling 21.2)", () => {
    expect(line(verifiedFig())).toBeNull();
    const stale = verifiedFig({
      price: { ...verifiedFig().price, stale: 'setting' },
      pairingRead: 'outbound-only',
    });
    expect(line(stale)).toEqual({ lead: D.pairingRead['outbound-only'], pairing: null });
  });
});

describe('sellerOf (21.7 code M9: an offer always names its seller; the contract says so)', () => {
  it("the offer's seller; a RangeError naming the broken rule when an offer has none", () => {
    expect(sellerOf(figurePairing())).toBe('QQ Travel');
    expect(() => sellerOf(figurePairing({ seller: null }))).toThrow(RangeError);
    expect(() => sellerOf(figurePairing({ seller: null }))).toThrow(/an offer names its seller/);
  });
});
