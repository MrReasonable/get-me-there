// Spec revision 56 §6.9 "Flight lists and the date pair's figure" and §10 (WP21 Task 21.6; R-lead, R-sellers, A8,
// R-unread, R-stale-verified): the date-pairs board, the scoped `/results` read, the cards and the step's ranking read
// one pairings map built from the newest flight list of each figure's cell. The shared fixture (`@gmt/core/testing`,
// synthetic) is stored through the repository; the definition's limits are the fixture's (25 h a leg, at most 1 stop).
import {
  apiContract,
  asIsoDate,
  type BookingRead,
  type CellKey,
  type DatePairFigure,
  type DefinitionInput,
  type ListedFlight,
  type ReturnRead,
  rankDatePairs,
  returnReadSchema,
  type SearchDefinition,
} from '@gmt/core';
import { PAIRING_FIXTURE } from '@gmt/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { rankedPairsFor } from '../../src/read/ranked.js';
import { currentSpace } from '../../src/read/space.js';
import { datesOf, pairOf, resultsOf } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const WORKER_ENV = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
  CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef0123456789abcdef',
};
const SPACE: Partial<DefinitionInput> = {
  origins: [LHR, LGW],
  destinations: [JFK, EWR],
  window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-03') },
  minNights: 10,
  maxNights: 10,
  constraints: { maxJourneyMinutes: 1500, maxStops: 1 },
};
const ALL = [LHR, LGW].flatMap((o) =>
  [JFK, EWR].flatMap((d) => [cell(o, d, '2026-11-02', '2026-11-12'), cell(o, d, '2026-11-03', '2026-11-13')]),
);
/** The figure's cell of the first date pair (the cheapest calendar price, £400) and of the second (£410). */
const A = cell(LHR, JFK, '2026-11-02', '2026-11-12');
const B = cell(LGW, EWR, '2026-11-03', '2026-11-13');

/** A search naming camoufox beside the fixture; run E started 2 h ago and priced A at £400 and B at `bPence`. */
async function setup(
  o: { constraints?: DefinitionInput['constraints']; bPence?: number; gridHoursAgo?: number } = {},
) {
  h = await createHarness({ env: WORKER_ENV });
  const x = h;
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({
      ...SPACE,
      ...(o.constraints === undefined ? {} : { constraints: o.constraints }),
      providers: {
        discovery: ['fixture', 'camoufox'],
        verification: [],
        discoveryRefreshHours: { fixture: 168, camoufox: 168 },
      },
    }),
  );
  const s = seeder(x.ports);
  // why: spec rev 63: the grid's read time decides whether an older list still leads; by default 2 h ago
  const g = o.gridHoursAgo ?? 2;
  const e = s.execution('E', { def, status: 'completed', startedAt: at(-g), finishedAt: at(-(g - 1)) });
  s.cells('E', ALL, { discovery: ['fixture', 'travelpayouts'] });
  s.tile('E', A, { status: 'priced', fetchedAt: at(-g), pricePence: 40_000 });
  s.tile('E', B, { status: 'priced', fetchedAt: at(-g), pricePence: o.bPence ?? 41_000, tileIndex: 1 });
  return { x, def, e };
}

/** Stores a flight list on `c` with the fixture's outbounds and `returns`, `hoursAgo` old, of `executionId`. */
function store(
  x: Harness,
  def: SearchDefinition,
  c: CellKey,
  returns: ReturnRead | null,
  o: { hoursAgo?: number; executionId?: string | null; flights?: ListedFlight[] } = {},
) {
  const flights = o.flights ?? PAIRING_FIXTURE.flights;
  x.ports.repos.flightLists.insert({
    definitionId: def.id,
    executionId: o.executionId ?? null,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    cabin: 'economy',
    ...c,
    fetchedAt: at(-(o.hoursAgo ?? 1)),
    pointOfSale: 'GB',
    status: 'read',
    reason: null,
    listed: 'flights',
    minMinor: Math.min(...flights.map((f) => f.amountMinor)),
    tabMinor: null,
    cheapestView: 'cheapest',
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: flights.length,
    flights,
    returns,
  });
}

/** The fixture's return read with its booking changed by `booking` (and the read by `over`). */
function fixture(booking: Partial<BookingRead> | null = {}, over: Partial<ReturnRead> = {}): ReturnRead {
  const r = structuredClone(PAIRING_FIXTURE.returns);
  return returnReadSchema.parse({
    ...r,
    booking: booking === null || r.booking === null ? null : { ...r.booking, ...booking },
    ...over,
  });
}
const OFFER_FARES = [
  { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
  { seller: 'QQ Fares', fare: 'Economy Flex', priceMinor: 121_000 },
];
/** The list's provenance (spec rev 56 §6.9: the browser worker's flight list). */
const listProvenance = (hoursAgo: number) => ({
  providerId: 'camoufox',
  sourceKind: 'scraped-self',
  fetchedAt: at(-hoursAgo),
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
});
/** The pairing group of the fixture's pairing (attempt 1, return 0), 1 h old, with the cheapest offer read. */
const PAIRING = {
  pricePence: 118_000,
  fromPence: 118_000,
  isFrom: false,
  seller: 'QQ Travel',
  fare: null,
  offersRead: 3,
  complete: true,
  which: 'next-cheapest',
  departOut: '07:15',
  arriveOut: '18:05',
  departBack: '14:20',
  arriveBack: '06:25',
  mismatch: false,
  provenance: listProvenance(1),
  stale: false,
  ageHours: 1,
};
const figureA = async (x: Harness, def: SearchDefinition): Promise<DatePairFigure | null> =>
  pairOf(await datesOf(x, def.id), '2026-11-02', '2026-11-12').figure;

describe('the pairing figure on the board (spec rev 56 §6.9)', () => {
  it('a fresh, complete pairing under the current limits leads: the offer price, the list provenance, the grid beneath', async () => {
    const { x, def } = await setup();
    const before = await figureA(x, def);
    store(x, def, A, PAIRING_FIXTURE.returns);
    const f = await figureA(x, def);
    expect(f).toMatchObject({
      basis: 'pairing',
      price: {
        pricePence: 118_000,
        provenance: listProvenance(1),
        stale: false,
        ageHours: 1,
        truncated: false,
      },
      origin: 'LHR',
      destination: 'JFK',
      superseded: before?.superseded,
      notSeenInLatest: null,
      departOut: null,
      arriveOut: null,
      departBack: null,
      arriveBack: null,
      fromEarlierSearch: false,
      cheaperCached: null,
      gridPrice: {
        pricePence: 40_000,
        provenance: before?.price.provenance,
        stale: before?.price.stale,
        truncated: false,
      },
      pairing: PAIRING,
      pairingRead: 'within',
    });
  });

  // why: design 2026-11-08 §4.1: an expand-failed booking with offers above the "from" price still leads, at Google's
  // "from" price (never an incomplete offer's), with the offers read counted and no seller named
  it('A8: an expand-failed booking leads with its offer when it equals the "from" price; else at the "from" price', async () => {
    const equal = await setup();
    store(
      equal.x,
      equal.def,
      A,
      fixture({ status: 'expand-failed', rule: 'more-options:not-settled', expanded: false }),
    );
    expect(await figureA(equal.x, equal.def)).toMatchObject({ basis: 'pairing', pairingRead: 'within' });
    await h?.close();
    const above = await setup();
    store(
      above.x,
      above.def,
      A,
      fixture({
        status: 'expand-failed',
        rule: 'more-options:not-settled',
        expanded: false,
        offers: OFFER_FARES,
      }),
    );
    expect(await figureA(above.x, above.def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 118_000 },
      pairingRead: 'within',
      pairing: {
        pricePence: 118_000,
        fromPence: 118_000,
        isFrom: true,
        seller: null,
        fare: null,
        offersRead: 2,
        complete: false,
        mismatch: false,
      },
    });
  });

  it("a booking of another return than bookingReturnOf's leads at the from price, no sellers read (design 2026-11-08)", async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ returnIndex: 1 }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 118_000 },
      pairingRead: 'within',
      pairing: { ...PAIRING, isFrom: true, seller: null, fare: null, offersRead: 0, complete: false },
    });
  });

  it('R-sellers: a read booking with a further control and its cheapest above the "from" price leads at the "from" price', async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ moreControl: true, offers: OFFER_FARES }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 118_000 },
      pairingRead: 'within',
      pairing: { isFrom: true, seller: null, offersRead: 2, complete: false },
    });
  });

  it('with no control left, a cheapest offer above the "from" price leads with the mismatch mark', async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ offers: OFFER_FARES }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 119_500 },
      pairing: {
        pricePence: 119_500,
        // why: Task 21.7: the board's mismatch mark names the return's "from" price ("Google listed from £1,180")
        fromPence: 118_000,
        seller: 'QQ Fares',
        fare: 'Economy Basic',
        offersRead: 2,
        mismatch: true,
      },
    });
  });

  it('fromEarlierSearch: true for a list read before the latest run started, false for an on-demand one after', async () => {
    const { x, def, e } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 3, executionId: e });
    expect((await figureA(x, def))?.fromEarlierSearch).toBe(true);
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 1 });
    expect((await figureA(x, def))?.fromEarlierSearch).toBe(false);
  });

  // why: spec rev 62 (Ian, 2026-11-06): a date keeps its last real round trip, marked older, not the grid's price
  it('a list older than the refresh (200 h of 168) still leads, the figure marked older than the refresh', async () => {
    // the grid price was read 250 h ago, before the list
    const { x, def } = await setup({ gridHoursAgo: 250 });
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 200 });
    expect(await figureA(x, def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 118_000, provenance: listProvenance(200), stale: 'refresh', ageHours: 200 },
      pairingRead: 'within',
      pairing: { ...PAIRING, provenance: listProvenance(200), stale: 'refresh', ageHours: 200 },
      gridPrice: { pricePence: 40_000 },
    });
  });

  // why: spec rev 63: a later search re-priced the date (its grid price read 2 h ago), so the 200 h old round trip no
  // longer leads it: the grid price leads, the pairing beneath, until the date's flights are read again
  it('a list older than the refresh, with a grid price read after it, gives way: within-older, the pairing beneath', async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 200 });
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'within-older',
      pairing: { ...PAIRING, provenance: listProvenance(200), stale: 'refresh', ageHours: 200 },
    });
  });

  it('a list older than the refresh with no seller read keeps the grid price: within-older, the pairing beneath', async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture(null), { hoursAgo: 200 });
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'within-older',
      pairing: { isFrom: true, seller: null, stale: 'refresh', ageHours: 200 },
    });
  });

  it('a one-attempt list read under maxStops 2, today 1, is within-other-limits', async () => {
    const { x, def } = await setup();
    const second = PAIRING_FIXTURE.returns.attempts[1];
    if (second === undefined) throw new Error('fixture');
    store(
      x,
      def,
      A,
      fixture(
        { attempt: 0 },
        { limits: { ...PAIRING_FIXTURE.returns.limits, maxStops: 2 }, attempts: [second] },
      ),
    );
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      pairingRead: 'within-other-limits',
      pairing: { pricePence: 118_000, which: 'cheapest' },
    });
  });

  it('no pairing within the limits is over-limit, the pairing beneath as its "from" price', async () => {
    const { x, def } = await setup();
    const first = PAIRING_FIXTURE.returns.attempts[0];
    if (first === undefined) throw new Error('fixture');
    store(x, def, A, fixture(null, { attempts: [first] }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      pairingRead: 'over-limit',
      pairing: { pricePence: 120_400, fromPence: 120_400, isFrom: true, seller: null, which: 'over-limit' },
    });
  });

  it('21.7 code I3: an over-limit pairing whose booking read kept offers is shown beneath with the offer, never leading', async () => {
    const { x, def } = await setup();
    const first = PAIRING_FIXTURE.returns.attempts[0];
    if (first === undefined) throw new Error('fixture');
    // why: no return of attempt 0 fits, so the worker booked the cheapest of all (return 0, from £1,204) and read it
    store(
      x,
      def,
      A,
      fixture(
        {
          attempt: 0,
          returnIndex: 0,
          offers: [
            { seller: 'QQ Travel', fare: null, priceMinor: 121_000 },
            { seller: 'QQ Fares', fare: null, priceMinor: 122_000 },
          ],
        },
        { attempts: [first] },
      ),
    );
    // why: Ian's ruling 2 for returns: the block and the board both show the seller's price, marked over the limits
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      pairingRead: 'over-limit',
      pairing: {
        pricePence: 121_000,
        fromPence: 120_400,
        isFrom: false,
        seller: 'QQ Travel',
        offersRead: 2,
        mismatch: true,
        which: 'over-limit',
      },
    });
  });

  // why: final review B-I2: two attempts with no return within the limits on either: the worker booked the last
  // attempt's cheapest (bookingReturnOf); the board shows that pairing with its offer, over the limits, never leading
  it('two attempts, none fitting: the booked pairing of the last attempt with its offer, over-limit', async () => {
    const { x, def } = await setup();
    const [first, second] = PAIRING_FIXTURE.returns.attempts;
    const r0 = second?.returns[0];
    if (first === undefined || second === undefined || r0 === undefined) throw new Error('fixture');
    const over = (fromMinor: number, departsLocal: string) => ({ ...r0, departsLocal, stops: 2, fromMinor });
    store(
      x,
      def,
      A,
      fixture(
        {
          attempt: 1,
          returnIndex: 1,
          offers: [
            { seller: 'QQ Travel', fare: null, priceMinor: 127_000 },
            { seller: 'QQ Fares', fare: null, priceMinor: 128_000 },
          ],
        },
        { attempts: [first, { ...second, returns: [over(130_000, '12:00'), over(126_000, '15:30')] }] },
      ),
    );
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      pairingRead: 'over-limit',
      pairing: {
        pricePence: 127_000,
        fromPence: 126_000,
        isFrom: false,
        seller: 'QQ Travel',
        offersRead: 2,
        which: 'over-limit',
        departOut: '07:15',
        departBack: '15:30',
      },
    });
  });

  it('no-outbound is no-pairing-read; not-verified or no return read is outbound-only; no list is not-read', async () => {
    const reads: Array<[ReturnRead | null, string]> = [
      [
        returnReadSchema.parse({
          limits: PAIRING_FIXTURE.returns.limits,
          status: 'no-outbound',
          rule: null,
          attempts: [],
          triedAll: true,
          booking: null,
        }),
        'no-pairing-read',
      ],
      [
        returnReadSchema.parse({
          limits: PAIRING_FIXTURE.returns.limits,
          status: 'not-verified',
          rule: null,
          attempts: [],
          triedAll: false,
          booking: null,
        }),
        'outbound-only',
      ],
      [null, 'outbound-only'],
    ];
    for (const [returns, read] of reads) {
      const { x, def } = await setup();
      store(x, def, A, returns);
      const f = await figureA(x, def);
      expect(f).toMatchObject({ basis: 'calendar', pairingRead: read, pairing: null });
      await h?.close();
      h = undefined;
    }
    const { x, def } = await setup();
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      pairingRead: 'not-read',
      pairing: null,
    });
  });

  it("the board ranks the pairing (trips with flights read) first; the step's ranking (rankedPairsFor) keeps the calendar figures", async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns);
    const board = rankDatePairs((await datesOf(x, def.id)).pairs, x.clock.now());
    expect(board.map((p) => [p.departureDate, p.figure?.price.pricePence])).toEqual([
      ['2026-11-02', 118_000],
      ['2026-11-03', 41_000],
    ]);
    const step = rankedPairsFor(x.ports, {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      maxJourneyMinutes: def.constraints.maxJourneyMinutes ?? null,
      now: x.clock.now(),
    });
    expect(step.map((p) => [p.departureDate, p.pricePence])).toEqual([
      ['2026-11-02', 40_000],
      ['2026-11-03', 41_000],
    ]);
  });

  it("the scoped /results read's figure equals the board's for the same date pair", async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns);
    const board = await figureA(x, def);
    if (board === null) throw new Error('a figure');
    const { airportPair: _p, ...expected } = board;
    const r = await resultsOf(x, def.id, '?departureDate=2026-11-02&returnDate=2026-11-12');
    expect(r.datePairFigure).toEqual(expected);
  });

  it("the card's cheapest is the pairing, with the list's provenance, and parses the card schema", async () => {
    const { x, def } = await setup({ bPence: 200_000 });
    store(x, def, A, PAIRING_FIXTURE.returns);
    const res = await x.request('/api/definitions/cards');
    const card = apiContract.searchCardsResponseSchema
      .parse(await res.json())
      .cards.find((c) => c.id === def.id);
    expect(card?.cheapest).toMatchObject({
      pricePence: 118_000,
      provenance: listProvenance(1),
      basis: 'pairing',
      departureDate: '2026-11-02',
      origin: 'LHR',
      destination: 'JFK',
      fromLatestRun: true,
    });
  });

  // why: design 2026-11-08 §5.1: the card's cheapest is the board's first-ranked figure, so a read trip (here at Google's
  // price, no seller read) is the cheapest even beside a cheaper calendar price on another date pair
  it("the card's cheapest is a fresh pairing at Google's price before a cheaper calendar price on another pair", async () => {
    const { x, def } = await setup({ bPence: 56_500 });
    store(x, def, A, fixture(null));
    const res = await x.request('/api/definitions/cards');
    const card = apiContract.searchCardsResponseSchema
      .parse(await res.json())
      .cards.find((c) => c.id === def.id);
    expect(card?.cheapest).toMatchObject({
      pricePence: 118_000,
      basis: 'pairing',
      departureDate: '2026-11-02',
      provenance: listProvenance(1),
      ageHours: 1,
    });
  });

  it('R-stale-verified: a leading pairing replaces a stale verified figure; one that does not lead shows beneath it', async () => {
    const world = async () => {
      h = await createHarness({ env: WORKER_ENV });
      const x = h;
      const def = x.ports.repos.definitions.create(
        exampleDefinitionInput({
          ...SPACE,
          providers: {
            discovery: ['fixture', 'camoufox'],
            verification: ['fixture'],
            discoveryRefreshHours: { fixture: 168, camoufox: 168 },
          },
        }),
      );
      const s = seeder(x.ports);
      // why: the verified price (200 h, stale past 192 h) is fresher than the calendar one (300 h), so it is the figure
      s.execution('E', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-299) });
      s.cells('E', ALL, { discovery: ['fixture'], selected: [{ cell: A, reason: 'always_include' }] });
      s.tile('E', A, { status: 'priced', fetchedAt: at(-300), pricePence: 40_000 });
      s.verified('E', A, [{ hash: 'v1', pricePence: 39_000, fetchedAt: at(-200) }]);
      return { x, def };
    };
    const stale = await world();
    expect(await figureA(stale.x, stale.def)).toMatchObject({ basis: 'verified', pairingRead: 'not-read' });
    store(stale.x, stale.def, A, PAIRING_FIXTURE.returns);
    expect(await figureA(stale.x, stale.def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 118_000 },
      gridPrice: { pricePence: 40_000 },
    });
    await h?.close();
    const older = await world();
    store(older.x, older.def, A, PAIRING_FIXTURE.returns, { hoursAgo: 250 });
    expect(await figureA(older.x, older.def)).toMatchObject({
      basis: 'verified',
      price: { pricePence: 39_000 },
      pairingRead: 'within-older',
      pairing: { pricePence: 118_000, stale: 'refresh', ageHours: 250 },
    });
  });
});

describe('the pairing figure: Task 21.6 fix round 1', () => {
  // why: the 21.6 ruling (prov-003): a failed list read nothing, so it is worded as not read with its cause, never as
  // "return leg not read" (outbound-only); a failed newest list hides the finished one beneath it
  it('a failed newest list reads list-failed with its reason, on the board and the scoped /results read', async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 2 });
    x.ports.repos.flightLists.insert({
      definitionId: def.id,
      executionId: null,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
      cabin: 'economy',
      ...A,
      fetchedAt: at(-1),
      pointOfSale: 'GB',
      status: 'failed',
      reason: 'network',
      listed: null,
      minMinor: null,
      tabMinor: null,
      cheapestView: null,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
      flights: [],
      returns: null,
    });
    const board = await figureA(x, def);
    expect(board).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'list-failed',
      listReason: 'network',
      pairing: null,
    });
    const r = await resultsOf(x, def.id, '?departureDate=2026-11-02&returnDate=2026-11-12');
    expect(r.datePairFigure).toMatchObject({ pairingRead: 'list-failed', listReason: 'network' });
  });

  // why: prov-002: under ?executionId= the scoped run's own newest list counts, whatever its status, so a newer list
  // outside the scope (an on-demand read) never makes a cell the run did read look unread
  it('under ?executionId= an in-scope outbound-only list reads outbound-only beside a newer on-demand list', async () => {
    const { x, def, e } = await setup();
    store(x, def, A, null, { hoursAgo: 2, executionId: e });
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 1 });
    const scoped = await resultsOf(
      x,
      def.id,
      `?executionId=${e}&departureDate=2026-11-02&returnDate=2026-11-12`,
    );
    expect(scoped.datePairFigure).toMatchObject({ basis: 'calendar', pairingRead: 'outbound-only' });
    // the unscoped read takes the newest list overall: the on-demand one leads
    expect((await figureA(x, def))?.basis).toBe('pairing');
  });

  // why: prov-007: freshness is judged on elapsed time, not whole hours, so a list one minute past the refresh is
  // marked older (the engine's reuse rule compares milliseconds too); spec rev 62: it still leads
  it('a list one minute past the refresh leads marked older; one exactly at it leads fresh', async () => {
    const past = await setup({ gridHoursAgo: 200 });
    store(past.x, past.def, A, PAIRING_FIXTURE.returns, { hoursAgo: 168 + 1 / 60 });
    expect(await figureA(past.x, past.def)).toMatchObject({
      basis: 'pairing',
      price: { stale: 'refresh' },
      pairing: { stale: 'refresh', ageHours: 168 },
    });
    await h?.close();
    h = undefined;
    const on = await setup();
    store(on.x, on.def, A, PAIRING_FIXTURE.returns, { hoursAgo: 168 });
    expect(await figureA(on.x, on.def)).toMatchObject({ basis: 'pairing', pairing: { stale: false } });
  });

  // why: prov-004: a fresh verified figure is never asked for a pairing, through the api's dry pass too: the board, the
  // scoped /results read and the card keep it, with no pairing and no read
  it('a fresh verified figure stays verified beside a leading pairing in its best calendar cell', async () => {
    h = await createHarness({ env: WORKER_ENV });
    const x = h;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        ...SPACE,
        providers: {
          discovery: ['fixture', 'camoufox'],
          verification: ['fixture'],
          discoveryRefreshHours: { fixture: 168, camoufox: 168 },
        },
      }),
    );
    const s = seeder(x.ports);
    const e = s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E', ALL, { discovery: ['fixture'], selected: [{ cell: A, reason: 'always_include' }] });
    s.tile('E', A, { status: 'priced', fetchedAt: at(-2), pricePence: 40_000 });
    s.tile('E', B, { status: 'priced', fetchedAt: at(-2), pricePence: 200_000, tileIndex: 1 });
    s.verified('E', A, [{ hash: 'v1', pricePence: 39_000, fetchedAt: at(-1) }]);
    store(x, def, A, PAIRING_FIXTURE.returns, { executionId: e });
    const board = await figureA(x, def);
    expect(board).toMatchObject({
      basis: 'verified',
      price: { pricePence: 39_000, stale: false },
      gridPrice: null,
      pairing: null,
      pairingRead: 'not-read',
      listReason: null,
    });
    const r = await resultsOf(x, def.id, '?departureDate=2026-11-02&returnDate=2026-11-12');
    expect(r.datePairFigure).toMatchObject({ basis: 'verified', pairing: null, pairingRead: 'not-read' });
    const res = await x.request('/api/definitions/cards');
    const card = apiContract.searchCardsResponseSchema
      .parse(await res.json())
      .cards.find((c) => c.id === def.id);
    expect(card?.cheapest).toMatchObject({ pricePence: 39_000, basis: 'verified' });
  });
});
