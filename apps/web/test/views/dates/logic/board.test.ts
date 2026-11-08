import { asIsoDate, type DatePair, decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../../src/copy.js';
import {
  arrival,
  boardModel,
  calendarStyled,
  flightReadLine,
  gridFetchedAtOf,
  isSyntheticRead,
  type ListsState,
  PAGE_SIZE,
  sellerCoverage,
  sellerOf,
  setsAirlineOrLayover,
  sortBoard,
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

  // why: design 2026-11-08 §5.1: the three fresh verified figures (trips with flights read) rank before the calendar price
  // at 31000, which ranks last whatever it costs
  it('price ascending is the rank order; a second press reverses it', () => {
    expect(sorted('price', 'asc')).toEqual([
      '2027-03-14/12',
      '2027-03-16/11',
      '2027-03-17/10',
      '2027-03-15/10',
    ]);
    expect(sorted('price', 'desc')).toEqual([
      '2027-03-15/10',
      '2027-03-17/10',
      '2027-03-16/11',
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
      '2027-03-17/10',
      '2027-03-15/10',
      '2027-03-16/11',
      '2027-03-14/12',
    ]);
    expect(sorted('nights', 'desc')).toEqual([
      '2027-03-14/12',
      '2027-03-16/11',
      '2027-03-17/10',
      '2027-03-15/10',
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

describe('calendarStyled: every basis but verified is calendar-styled (spec rev 56 §6.9: resultBasisOf)', () => {
  it('verified is not; calendar and pairing are', () => {
    expect(calendarStyled('verified')).toBe(false);
    expect(calendarStyled('calendar')).toBe(true);
    expect(calendarStyled('pairing')).toBe(true);
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
  it('not-read: "flights not read" where flight lists are read, nothing where they are not', () => {
    expect(line(calendarFig())).toEqual({ lead: 'flights not read', pairing: null });
    expect(line(calendarFig(), 'unavailable')).toBeNull();
  });
  it('21.7 prov-004: "loading flights" while the flight-lists request is pending; the mark kept when it failed', () => {
    expect(line(calendarFig(), 'loading')).toEqual({ lead: 'loading flights', pairing: null });
    expect(line(calendarFig(), 'failed')).toEqual({ lead: 'flights not read', pairing: null });
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

describe('sellerCoverage (21.7 persona coverage: seller prices read for N of the M date pairs shown)', () => {
  const from = figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false });
  // why: design 2026-11-08 §4.1: only complete offers count; an incomplete one is Google's price, not a seller's
  it('null without a pairing figure; else the rows with a complete offer (leading or beneath) of the rows shown', () => {
    expect(sellerCoverage([])).toBeNull();
    expect(
      sellerCoverage([
        { figure: null },
        { figure: calendarFig({ pairingRead: 'within-older', pairing: figurePairing() }) },
      ]),
    ).toBeNull();
    expect(
      sellerCoverage([
        { figure: pairingFig() },
        {
          figure: calendarFig({
            pairingRead: 'offers-incomplete',
            pairing: figurePairing({ complete: false }),
          }),
        },
        { figure: calendarFig({ pairingRead: 'sellers-not-read', pairing: from }) },
        { figure: calendarFig() },
        { figure: null },
      ]),
    ).toEqual({ read: 1, shown: 5 });
  });
});

describe('sellerOf (21.7 code M9: an offer always names its seller; the contract says so)', () => {
  it("the offer's seller; a RangeError naming the broken rule when an offer has none", () => {
    expect(sellerOf(figurePairing())).toBe('QQ Travel');
    expect(() => sellerOf(figurePairing({ seller: null }))).toThrow(RangeError);
    expect(() => sellerOf(figurePairing({ seller: null }))).toThrow(/an offer names its seller/);
  });
});

describe('setsAirlineOrLayover (spec rev 56 §11 Board: "airline settings not applied to flights read")', () => {
  it('any airline list, layover bound or the overnight-layover rule; nothing else', () => {
    expect(setsAirlineOrLayover({})).toBe(false);
    expect(setsAirlineOrLayover({ includeAirlines: [] })).toBe(false);
    expect(setsAirlineOrLayover({ excludeAirlines: [] })).toBe(false);
    expect(setsAirlineOrLayover({ includeAirlines: ['VS'] })).toBe(true);
    expect(setsAirlineOrLayover({ excludeAirlines: ['VS'] })).toBe(true);
    expect(setsAirlineOrLayover({ minLayoverMinutes: 60 })).toBe(true);
    expect(setsAirlineOrLayover({ maxLayoverMinutes: 240 })).toBe(true);
    expect(setsAirlineOrLayover({ noOvernightLayover: true })).toBe(true);
    expect(setsAirlineOrLayover({ noOvernightLayover: false })).toBe(false);
  });
});

// why: spec rev 63: the block weighs an older pairing against the same grid price the board's figure does
describe('gridFetchedAtOf', () => {
  it("names a pairing figure's grid price, a calendar figure's own, and none for a verified figure or none", () => {
    const pairing = pairingFig();
    expect(gridFetchedAtOf(pairing)).toBe(pairing.gridPrice?.provenance.fetchedAt);
    const calendar = calendarFig();
    expect(gridFetchedAtOf(calendar)).toBe(calendar.price.provenance.fetchedAt);
    expect(gridFetchedAtOf(verifiedFig())).toBeNull();
    expect(gridFetchedAtOf(null)).toBeNull();
  });
});
