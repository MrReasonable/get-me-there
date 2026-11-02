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
async function setup(o: { constraints?: DefinitionInput['constraints']; bPence?: number } = {}) {
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
  const e = s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E', ALL, { discovery: ['fixture', 'travelpayouts'] });
  s.tile('E', A, { status: 'priced', fetchedAt: at(-2), pricePence: 40_000 });
  s.tile('E', B, { status: 'priced', fetchedAt: at(-2), pricePence: o.bPence ?? 41_000, tileIndex: 1 });
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

  it('A8: an expand-failed booking leads when its cheapest offer equals the "from" price; else offers-incomplete', async () => {
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
      basis: 'calendar',
      pairingRead: 'offers-incomplete',
      pairing: {
        pricePence: 119_500,
        isFrom: false,
        seller: 'QQ Fares',
        fare: 'Economy Basic',
        complete: false,
      },
    });
  });

  it("a booking of another return than bookingReturnOf's keeps the grid price: sellers-not-read, the from price beneath", async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ returnIndex: 1 }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'sellers-not-read',
      pairing: { ...PAIRING, isFrom: true, seller: null, fare: null, offersRead: 0, complete: false },
    });
  });

  it('R-sellers: a read booking with a further control and its cheapest above the "from" price is offers-incomplete', async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ moreControl: true, offers: OFFER_FARES }));
    expect(await figureA(x, def)).toMatchObject({ basis: 'calendar', pairingRead: 'offers-incomplete' });
  });

  it('with no control left, a cheapest offer above the "from" price leads with the mismatch mark', async () => {
    const { x, def } = await setup();
    store(x, def, A, fixture({ offers: OFFER_FARES }));
    expect(await figureA(x, def)).toMatchObject({
      basis: 'pairing',
      price: { pricePence: 119_500 },
      pairing: {
        pricePence: 119_500,
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

  it('a list older than the refresh (200 h of 168) keeps the grid price: within-older, the pairing beneath with its age', async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns, { hoursAgo: 200 });
    expect(await figureA(x, def)).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'within-older',
      pairing: { ...PAIRING, provenance: listProvenance(200), stale: 'refresh', ageHours: 200 },
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
      pairing: { pricePence: 120_400, isFrom: true, seller: null, which: 'over-limit' },
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

  it("the board's rank follows the pairing's price; the step's ranking (rankedPairsFor) keeps the calendar figures", async () => {
    const { x, def } = await setup();
    store(x, def, A, PAIRING_FIXTURE.returns);
    const board = rankDatePairs((await datesOf(x, def.id)).pairs, x.clock.now());
    expect(board.map((p) => [p.departureDate, p.figure?.price.pricePence])).toEqual([
      ['2026-11-03', 41_000],
      ['2026-11-02', 118_000],
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
