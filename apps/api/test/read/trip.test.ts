// Design 2026-11-08 §6.1 (plan Task 5): `GET /definitions/:id/trip` assembles one pair of dates from the board's own
// rules, so the Trip card and the search page's row never disagree. The world is synthetic and seeded through the
// repositories: London → New York (LHR, LGW → JFK, EWR), 2 and 3 November, 10 nights, the limits 25 h a leg and 1 stop.
import {
  apiContract,
  asIsoDate,
  type CellKey,
  type DefinitionInput,
  type ListedFlight,
  type ReturnRead,
  returnReadSchema,
  type SearchDefinition,
} from '@gmt/core';
import { PAIRING_FIXTURE, PAIRING_LIMITS, SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import type { FlightListInsert } from '@gmt/db';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../helpers/contract.js';
import { datesOf, pairOf } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const TRIP = '/api/definitions/:id/trip';
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
const DEP = '2026-11-02';
const RET = '2026-11-12';
/** The four airport pairs of 2 November, 10 nights. */
const A = cell(LHR, JFK, DEP, RET);
const G = cell(LGW, JFK, DEP, RET);
const K = cell(LHR, EWR, DEP, RET);
const W = cell(LGW, EWR, DEP, RET);
/** Another booking page address of the real shape, for the LGW list (design §6.3). */
const LGW_BOOKING_URL = `${SYNTHETIC_BOOKING_URL}&hl=en`;

async function harness(): Promise<{ x: Harness; def: SearchDefinition }> {
  h = await createHarness({ env: WORKER_ENV });
  const def = h.ports.repos.definitions.create(
    exampleDefinitionInput({
      ...SPACE,
      providers: {
        discovery: ['fixture', 'camoufox'],
        verification: [],
        discoveryRefreshHours: { fixture: 168, camoufox: 168 },
      },
    }),
  );
  return { x: h, def };
}

/**
 * One attempt on the fixture's third outbound (09:40, 1 stop, 13h 45m) with one return of `fromMinor` (1 stop,
 * 12h 05m), its booking read naming it with one seller's offer at that price, and the booking page's address.
 */
function oneSeller(o: { fromMinor?: number; seller?: string; bookingUrl?: string | null } = {}): ReturnRead {
  const fromMinor = o.fromMinor ?? 41_200;
  return returnReadSchema.parse({
    limits: PAIRING_LIMITS,
    status: 'read',
    rule: null,
    attempts: [
      {
        outboundIndex: 2,
        outboundFits: true,
        listed: 'returns',
        moreListed: false,
        returns: [
          {
            departsLocal: '14:20',
            arrivesLocal: '06:25',
            arrivesDayOffset: 1,
            durationMinutes: 725,
            stops: 1,
            carriers: ['QQ Atlantic'],
            operatedBy: null,
            fromMinor,
          },
        ],
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
      },
    ],
    triedAll: false,
    booking: {
      status: 'read',
      rule: null,
      attempt: 0,
      returnIndex: 0,
      expanded: true,
      moreControl: false,
      grouped: 0,
      offers: [{ seller: o.seller ?? 'Kiwi.com', fare: null, priceMinor: fromMinor }],
      unparsed: 0,
      nonGbp: 0,
      offersStated: null,
      bookingUrl: o.bookingUrl === undefined ? SYNTHETIC_BOOKING_URL : o.bookingUrl,
    },
  });
}

/** Stores a flight list on `c`, `hoursAgo` old, of `executionId` (null: read by hand). */
function store(
  x: Harness,
  def: SearchDefinition,
  c: CellKey,
  o: {
    returns?: ReturnRead | null;
    hoursAgo?: number;
    executionId?: string | null;
    failed?: FlightListInsert['reason'];
    flights?: ListedFlight[];
  } = {},
): number {
  const flights = o.failed !== undefined ? [] : (o.flights ?? PAIRING_FIXTURE.flights);
  return x.ports.repos.flightLists.insert({
    definitionId: def.id,
    executionId: o.executionId ?? null,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    cabin: 'economy',
    ...c,
    fetchedAt: at(-(o.hoursAgo ?? 1)),
    pointOfSale: 'GB',
    ...(o.failed !== undefined
      ? {
          status: 'failed',
          reason: o.failed,
          listed: null,
          minMinor: null,
          cheapestView: null,
          resultsStated: null,
        }
      : {
          status: 'read',
          reason: null,
          listed: 'flights',
          minMinor: Math.min(...flights.map((f) => f.amountMinor)),
          cheapestView: 'cheapest',
          resultsStated: flights.length,
        }),
    tabMinor: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    flights,
    returns: o.failed !== undefined ? null : o.returns === undefined ? oneSeller() : o.returns,
  });
}

/** The trip read, checked against its ROUTES entry. */
async function tripOf(x: Harness, defId: string, query: string) {
  const res = await x.request(`/api/definitions/${defId}/trip?${query}`);
  return expectContract(res, 'GET', TRIP, apiContract.tripResponseSchema);
}
const Q = `departureDate=${DEP}&returnDate=${RET}`;

/** Run E (2 h ago) priced every pair of 2 November but LGW→EWR: LHR→JFK £400, LGW→JFK £450, LHR→EWR £480. */
function priced(x: Harness, def: SearchDefinition): { e: string } {
  const s = seeder(x.ports);
  const e = s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E', [A, G, K, W]);
  s.tile('E', A, { status: 'priced', fetchedAt: at(-2), pricePence: 40_000 });
  s.tile('E', G, { status: 'priced', fetchedAt: at(-2), pricePence: 45_000, tileIndex: 1 });
  s.tile('E', K, { status: 'priced', fetchedAt: at(-2), pricePence: 48_000, tileIndex: 2 });
  return { e };
}

describe('the trip read (design 2026-11-08 §6.1)', () => {
  it("a read trip: the board's pairing figure, its list, the list's booking address; the board's group says the same", async () => {
    const { x, def } = await harness();
    priced(x, def);
    const list = store(x, def, A);
    const t = await tripOf(x, def.id, Q);
    expect(t).toMatchObject({
      departureDate: DEP,
      returnDate: RET,
      nights: 10,
      inWindow: true,
      figure: {
        basis: 'pairing',
        origin: 'LHR',
        destination: 'JFK',
        price: { pricePence: 41_200, provenance: { providerId: 'camoufox', sourceKind: 'scraped-self' } },
        pairing: { seller: 'Kiwi.com', isFrom: false, complete: true, bookingUrl: SYNTHETIC_BOOKING_URL },
        pairingRead: 'within',
      },
      journeyLeftOut: 0,
      listFailure: null,
      flightList: { id: list, origin: 'LHR', destination: 'JFK', status: 'read' },
      bookingUrl: SYNTHETIC_BOOKING_URL,
      searchLink: { host: 'www.google.com' },
      booking: null,
      reading: false,
      read: { available: true, unavailableReason: null, wouldGo: true },
      verificationConfigured: false,
      refreshHours: 168,
      limits: { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null },
    });
    expect(t.read.pagesPlanned).toBeGreaterThan(0);
    // why: the secondary equality check: the board's figure for these dates is the card's, field for field
    const board = pairOf(await datesOf(x, def.id), DEP, RET).figure;
    expect(board).not.toBeNull();
    const { airportPair: _pair, ...boardFigure } = board ?? { airportPair: -1 };
    expect(t.figure).toEqual(boardFigure);
    expect(board?.pairing?.bookingUrl).toBe(SYNTHETIC_BOOKING_URL);
  });

  // Review Focus 3: the search page's filters travel to the Trip page, so its figure, list and booking are the row's
  it("with origins=LGW the figure, its list and its booking address are the LGW cell's", async () => {
    const { x, def } = await harness();
    priced(x, def);
    store(x, def, A);
    const lgw = store(x, def, G, {
      returns: oneSeller({ fromMinor: 46_100, seller: 'QQ Fares', bookingUrl: LGW_BOOKING_URL }),
    });
    const t = await tripOf(x, def.id, `${Q}&origins=LGW`);
    expect(t.figure).toMatchObject({
      basis: 'pairing',
      origin: 'LGW',
      destination: 'JFK',
      price: { pricePence: 46_100 },
      pairing: { seller: 'QQ Fares', bookingUrl: LGW_BOOKING_URL },
    });
    expect(t.flightList?.id).toBe(lgw);
    expect(t.bookingUrl).toBe(LGW_BOOKING_URL);
    expect(t.cells.map((c) => `${c.origin}-${c.destination}`)).toEqual(['LGW-EWR', 'LGW-JFK']);
    const board = pairOf(await datesOf(x, def.id, '?origins=LGW'), DEP, RET).figure;
    expect(board?.price.pricePence).toBe(46_100);
  });

  // Review Focus 1, as the board's rule stands (the 21.6 ruling: the newest list counts whatever its status): the card
  // shows the board's figure with the couldn't-read line, never the older list's trip at another price
  it("newest list failed over an older list's trip: listFailure set, the figure the board's own", async () => {
    const { x, def } = await harness();
    priced(x, def);
    store(x, def, A, { hoursAgo: 5 });
    const failed = store(x, def, A, { hoursAgo: 1, failed: 'network' });
    const t = await tripOf(x, def.id, Q);
    expect(t.listFailure).toEqual({ at: at(-1), cause: 'network' });
    const board = pairOf(await datesOf(x, def.id), DEP, RET).figure;
    const { airportPair: _pair, ...boardFigure } = board ?? { airportPair: -1 };
    expect(t.figure).toEqual(boardFigure);
    expect(t.figure).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000 },
      pairingRead: 'list-failed',
    });
    expect(t.flightList).toMatchObject({ id: failed, status: 'failed', reason: 'network' });
    expect(t.bookingUrl).toBeNull();
  });

  it('a figure whose newest list read has no listFailure; a figure with no list has none either', async () => {
    const { x, def } = await harness();
    priced(x, def);
    store(x, def, A, { hoursAgo: 5, failed: 'network' });
    store(x, def, A, { hoursAgo: 1 });
    expect((await tripOf(x, def.id, Q)).listFailure).toBeNull();
    // LHR→EWR's own list failed, but the figure is LHR→JFK's: the line is the figure's cell's only
    store(x, def, K, { hoursAgo: 1, failed: 'blocked' });
    expect((await tripOf(x, def.id, Q)).listFailure).toBeNull();
    expect((await tripOf(x, def.id, `${Q}&destinations=EWR&origins=LGW`)).listFailure).toBeNull();
  });

  // Review Focus 4: an old alert link for departed dates, and dates outside the search's current dates, answer 200
  it.each([
    ['departed dates', 'departureDate=2026-10-12&returnDate=2026-10-22', 10],
    ['a stay outside the nights range', 'departureDate=2026-11-02&returnDate=2026-11-13', 11],
    ['a departure outside the window', 'departureDate=2026-11-09&returnDate=2026-11-19', 10],
  ])('%s: 200, inWindow false, nothing of these dates', async (_name, query, nights) => {
    const { x, def } = await harness();
    priced(x, def);
    store(x, def, A);
    const t = await tripOf(x, def.id, `${query}&origins=ZZZ`);
    expect(t).toMatchObject({
      nights,
      inWindow: false,
      figure: null,
      journeyLeftOut: 0,
      listFailure: null,
      cells: [],
      flightList: null,
      bookingUrl: null,
      searchLink: null,
      booking: null,
      calendar: null,
      cached: null,
      log: [],
      reading: false,
      read: { available: true, wouldGo: false },
    });
  });

  // Ruling 3: dates read by hand with no figure show that read's trip
  it("no figure, an on-demand list of the read cell (the search's first airports): figure null, flightList that list", async () => {
    const { x, def } = await harness();
    const dep = '2026-11-03';
    const ret = '2026-11-13';
    const list = store(x, def, cell(LHR, JFK, dep, ret));
    // a list of another airport pair of these dates is not the read cell's
    store(x, def, cell(LGW, EWR, dep, ret), { hoursAgo: 0 });
    const t = await tripOf(x, def.id, `departureDate=${dep}&returnDate=${ret}`);
    expect(t).toMatchObject({
      inWindow: true,
      figure: null,
      flightList: { id: list, origin: 'LHR', destination: 'JFK', executionId: null },
      bookingUrl: SYNTHETIC_BOOKING_URL,
      listFailure: null,
      searchLink: { host: 'www.google.com' },
      read: { wouldGo: true },
    });
    expect(t.log).toEqual([
      expect.objectContaining({
        byHand: true,
        calendar: null,
        flights: expect.objectContaining({ kind: 'trip' }),
      }),
      expect.objectContaining({
        byHand: true,
        calendar: null,
        flights: expect.objectContaining({ kind: 'trip' }),
      }),
    ]);
    // with the airports filtered, the read cell is the filtered pair (LGW→EWR), whose by-hand list it shows
    const lgw = await tripOf(
      x,
      def.id,
      `departureDate=${dep}&returnDate=${ret}&origins=LGW&destinations=EWR`,
    );
    expect(lgw.flightList?.origin).toBe('LGW');
  });

  it('cells: one per airport pair of these dates in scope, with its bucket and a skipped cell’s reason', async () => {
    const { x, def } = await harness();
    const s = seeder(x.ports);
    s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E', [A, G, K, W]);
    s.tile('E', A, { status: 'priced', fetchedAt: at(-2), pricePence: 40_000 });
    s.tileError('E', [G], 'upstream', 'HTTP 503');
    x.ports.repos.cells.setOutcome(s.id('E'), K, 'discovery', 'fixture', {
      status: 'skipped',
      reason: 'budget',
    });
    const t = await tripOf(x, def.id, Q);
    expect(t.cells).toEqual([
      { origin: 'LGW', destination: 'EWR', bucket: 'not_run', skipReason: null },
      { origin: 'LGW', destination: 'JFK', bucket: 'error', skipReason: null },
      { origin: 'LHR', destination: 'EWR', bucket: 'skipped', skipReason: 'budget' },
      { origin: 'LHR', destination: 'JFK', bucket: 'priced', skipReason: null },
    ]);
  });

  it('log: one row per run that priced or read these dates and one per by-hand read, newest first', async () => {
    const { x, def } = await harness();
    const s = seeder(x.ports);
    const run = (name: string, hoursAgo: number, pricePence: number) => {
      const e = s.execution(name, {
        def,
        status: 'completed',
        startedAt: at(-hoursAgo),
        finishedAt: at(-hoursAgo + 1),
      });
      s.cells(name, [A]);
      s.tile(name, A, { status: 'priced', fetchedAt: at(-hoursAgo), pricePence });
      return e;
    };
    const e1 = run('E1', 40, 39_000);
    const e2 = run('E2', 30, 39_500);
    const e3 = run('E3', 20, 40_500);
    run('E4', 10, 41_000);
    store(x, def, A, { hoursAgo: 39, executionId: e1 });
    store(x, def, A, { hoursAgo: 29, executionId: e2, failed: 'blocked' });
    store(x, def, A, { hoursAgo: 19, executionId: e3, returns: null });
    store(x, def, A, { hoursAgo: 1, returns: oneSeller({ fromMinor: 40_900 }) });
    const t = await tripOf(x, def.id, Q);
    expect(t.log.map((r) => [r.at, r.byHand, r.calendar?.pricePence ?? null, r.flights.kind])).toEqual([
      [at(-1), true, null, 'trip'],
      [at(-10), false, 41_000, 'not-read'],
      [at(-20), false, 40_500, 'outbound-only'],
      [at(-30), false, 39_500, 'failed'],
      [at(-40), false, 39_000, 'trip'],
    ]);
    expect(t.log[0]?.flights).toEqual({
      kind: 'trip',
      price: {
        pricePence: 40_900,
        provenance: expect.objectContaining({
          providerId: 'camoufox',
          sourceKind: 'scraped-self',
          fetchedAt: at(-1),
        }),
        stale: false,
        ageHours: 1,
        truncated: false,
      },
      pairingKind: 'seller',
      seller: 'Kiwi.com',
    });
    expect(t.log[3]?.flights).toEqual({ kind: 'failed', cause: 'blocked' });
    expect(t.log[4]?.flights).toMatchObject({ kind: 'trip', price: { pricePence: 41_200 } });
    for (const r of t.log)
      if (r.calendar !== null)
        expect(r.calendar.provenance).toMatchObject({ providerId: 'fixture', sourceKind: 'synthetic' });
  });

  it.each<[string, string, ReturnRead]>([
    ['returns read, none within the limits', 'none-within', overLimit()],
    [
      'read under other limits',
      'other-limits',
      returnReadSchema.parse({ ...oneSeller(), limits: { ...PAIRING_LIMITS, maxStops: 2 } }),
    ],
    ['a finished return phase with no return listed', 'no-return', noReturn()],
  ])('log: %s is %s', async (_name, kind, returns) => {
    const { x, def } = await harness();
    store(x, def, A, { returns });
    expect((await tripOf(x, def.id, Q)).log.map((r) => r.flights.kind)).toEqual([kind]);
  });

  it('calendar and cached: the newest live calendar price and the newest cached one, a superseded one not seen again', async () => {
    const { x, def } = await harness();
    const s = seeder(x.ports);
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [A], { discovery: ['travelpayouts'] });
    s.tile('E1', A, {
      status: 'priced',
      fetchedAt: at(-30),
      pricePence: 36_000,
      real: { providerId: 'travelpayouts' },
    });
    const e2 = s.execution('E2', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('E2', [A], { discovery: ['travelpayouts', 'camoufox'] });
    // a newer search found the cached price's cell empty, so that price is not seen again
    s.tile('E2', A, { status: 'empty', fetchedAt: at(-3), real: { providerId: 'travelpayouts' } });
    x.ports.repos.calendarPrices.insert(e2, [
      {
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        cabin: 'economy',
        cell: A,
        pricePence: 38_800,
        priceNativeMinor: 38_800,
        currencyNative: 'GBP',
        fx: { converted: false },
        pointOfSale: 'GB',
        fetchedAt: at(-3),
        providerObservedAt: null,
        maxAgeHours: 0,
        vendorLink: null,
        reusedFromExecutionId: null,
        returnDateSource: 'grid-cell',
        vendorPriceMark: null,
      },
    ]);
    const t = await tripOf(x, def.id, Q);
    expect(t.calendar).toMatchObject({
      pricePence: 38_800,
      provenance: { providerId: 'camoufox', sourceKind: 'scraped-self' },
      notSeenAgain: false,
    });
    expect(t.cached).toMatchObject({
      pricePence: 36_000,
      provenance: { providerId: 'travelpayouts', sourceKind: 'authorised-cached' },
      notSeenAgain: true,
    });
  });

  it('a verified figure carries its own booking, re-validated; a pairing or calendar figure none', async () => {
    const { x, def } = await harness();
    const s = seeder(x.ports);
    s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E', [A], { selected: [{ cell: A, reason: 'top_n' }] });
    s.verified('E', A, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
    const t = await tripOf(x, def.id, Q);
    expect(t.figure?.basis).toBe('verified');
    expect(t.booking).toEqual({ kind: 'none' });
  });

  it('reading: an on-demand read in flight for these dates, and only these', async () => {
    const { x, def } = await harness();
    const real = x.engine.flightReadInFlight;
    x.engine.flightReadInFlight = () => ({
      definitionId: def.id,
      departureDate: asIsoDate(DEP),
      returnDate: asIsoDate(RET),
    });
    expect((await tripOf(x, def.id, Q)).reading).toBe(true);
    expect((await tripOf(x, def.id, 'departureDate=2026-11-03&returnDate=2026-11-13')).reading).toBe(false);
    x.engine.flightReadInFlight = () => ({
      definitionId: 'another',
      departureDate: asIsoDate(DEP),
      returnDate: asIsoDate(RET),
    });
    expect((await tripOf(x, def.id, Q)).reading).toBe(false);
    x.engine.flightReadInFlight = real;
  });
});

/** The fixture's two attempts, every return over 1 stop: returns read, none within the limits. */
function overLimit(): ReturnRead {
  const r = structuredClone(PAIRING_FIXTURE.returns);
  return returnReadSchema.parse({
    ...r,
    attempts: r.attempts.map((a) => ({ ...a, returns: a.returns.map((b) => ({ ...b, stops: 2 })) })),
    booking: null,
  });
}

/** A finished return phase whose one attempt listed no return. */
function noReturn(): ReturnRead {
  return returnReadSchema.parse({
    ...oneSeller(),
    attempts: [
      {
        outboundIndex: 2,
        outboundFits: true,
        listed: 'none-for-cell',
        moreListed: false,
        returns: [],
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
      },
    ],
    booking: null,
  });
}
