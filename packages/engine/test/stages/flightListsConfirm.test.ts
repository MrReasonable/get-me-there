// Design 2026-11-08 (confirm the cheapest trips) §4.2–§4.6, §7: with the return leg read, the flight-list step reads an
// open-ended queue of the calendar's cheapest date pairs until rule A stops it (12 finished reads in a row that do not
// improve the 5 cheapest trips with flights read), the queue is empty, returns stop part-way, or a stop of the run's own
// ends it; it stores a summary (`confirm`). Stub provider through the real engine, guard and database; replies are keyed
// by the read's call number or by the pair's place in the ranking, and concurrency is held with deferred promises and
// the step's own writes, never with timers.
import {
  asIsoDate,
  asIsoDateTime,
  type FlightLimits,
  type FlightListQuery,
  type FlightListResult,
  type FlightListsState,
  type IsoDateTime,
  ProviderError,
  type ReturnRead,
  returnReadSchema,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newRun } from '../../src/run.js';
import { readRowOf, runFlightLists } from '../../src/stages/flightLists.js';
import type { RankedDatePair } from '../../src/types.js';
import {
  blockedError,
  type CamoufoxEngine,
  deferred,
  engineWith,
  type FlightStubOptions,
  flightLedger,
  flightRows,
  listAnswer,
  realTime,
  stubCamoufox,
} from '../support/camoufox.js';
import { JFK, LHR, T0 } from '../support/harness.js';

beforeEach(realTime);
afterEach(realTime);

const RETURNS_ONLY = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false };
const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
const NO_LIMITS: FlightLimits = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const FIRST_DAY = Date.parse('2026-11-02T00:00:00.000Z');
const DAY = 86_400_000;
const AT_ONCE = { CAMOUFOX_PAGES_AT_ONCE: '4' };

/** A return read under no limits whose one pairing costs `fromMinor` (Google's round-trip price; no booking read). */
function returnsAt(fromMinor: number, booking: ReturnRead['booking'] = null): ReturnRead {
  return returnReadSchema.parse({
    limits: NO_LIMITS,
    status: 'read',
    rule: null,
    attempts: [
      {
        outboundIndex: 0,
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
    triedAll: true,
    booking,
  });
}
/** A return read that found no outbound within the limits: checked, no trip. */
const NO_OUTBOUND: ReturnRead = returnReadSchema.parse({
  limits: NO_LIMITS,
  status: 'no-outbound',
  rule: null,
  attempts: [],
  triedAll: true,
  booking: null,
});
/** A return view that did not settle: the pass's return phases stop. */
const NOT_SETTLED: ReturnRead = returnReadSchema.parse({
  limits: NO_LIMITS,
  status: 'not-settled',
  rule: 'select-outbound:not-settled',
  attempts: [],
  triedAll: false,
  booking: null,
});

/** The i-th pair of the synthetic ranking: departing i days after 2 Nov 2026, ten nights, London Heathrow → New York JFK. */
function pairAt(i: number, pricePence: number, over: Partial<RankedDatePair> = {}): RankedDatePair {
  const dep = FIRST_DAY + i * DAY;
  return {
    departureDate: asIsoDate(new Date(dep).toISOString().slice(0, 10)),
    returnDate: asIsoDate(new Date(dep + 10 * DAY).toISOString().slice(0, 10)),
    origin: LHR,
    destination: JFK,
    pricePence,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    basis: 'calendar',
    current: true,
    stale: false,
    ...over,
  };
}
const pairs = (n: number, price: (i: number) => number): RankedDatePair[] =>
  Array.from({ length: n }, (_, i) => pairAt(i, price(i)));
/** Which pair of the ranking a read asks for (each departs on its own day). */
const placeOf = (q: FlightListQuery): number =>
  Math.round((Date.parse(q.cell.departureDate) - FIRST_DAY) / DAY);

/** What the worker answers: a return read (the list's returns), a non-ending or ending list error, or a blocked page. */
type Reply = ReturnRead | 'network' | 'quota' | 'blocked';

function answerOf(reply: Reply, q: FlightListQuery): FlightListResult {
  if (reply === 'blocked') return { kind: 'list-error', error: blockedError('captcha') };
  if (reply === 'network' || reply === 'quota')
    return {
      kind: 'list-error',
      error: new ProviderError({
        kind: reply,
        retryable: false,
        providerId: 'camoufox',
        message: `camoufox /v1/flights: synthetic ${reply}`,
      }),
    };
  // why: the stub answers a return read only to a request that asked for one, as the worker does
  return { ...listAnswer(T0), returns: q.returnLimits === undefined ? null : reply };
}

async function start(e: CamoufoxEngine): Promise<string> {
  const r = await e.orch.start(e.definition.id, {
    trigger: 'manual',
    confirmCostPence: 1_000_000,
    confirmCalls: 1_000_000,
  });
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r.executionId;
}

/**
 * A camoufox-only engine whose worker reads returns (no booking read unless `flags` says so) over `ranked`, answering
 * the n-th read of the pair at place i with `reply(n, i)`.
 */
function confirming(o: {
  ranked: RankedDatePair[];
  reply: (n: number, i: number) => Reply;
  flags?: Record<string, boolean> | null;
  env?: Record<string, string>;
  flights?: Omit<FlightStubOptions, 'answer'>;
}) {
  const cam = stubCamoufox({
    cells: 15,
    flights: { ...o.flights, answer: (q, n) => answerOf(o.reply(n, placeOf(q)), q) },
  });
  const e = engineWith([cam], { rankedDatePairs: () => o.ranked, env: o.env ?? {} });
  if (o.flags !== null) e.ctx.workerFlags.set('camoufox', o.flags ?? RETURNS_ONLY);
  return { e, cam };
}

/** The places in the ranking the step read, in the order it asked. */
const placesRead = (cam: { flightCalls: Array<{ query: FlightListQuery }> }) =>
  cam.flightCalls.map((c) => placeOf(c.query));

/** Stores a list for the pair at `p`, of no execution, read at `fetchedAt` with `returns`. */
function storeList(e: CamoufoxEngine, p: RankedDatePair, fetchedAt: IsoDateTime, returns: ReturnRead): void {
  e.ctx.repos.flightLists.insert(
    readRowOf(
      {
        definitionId: e.definition.id,
        executionId: null,
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        cabin: 'economy',
        origin: p.origin,
        destination: p.destination,
        departureDate: p.departureDate,
        returnDate: p.returnDate,
      },
      { ...listAnswer(fetchedAt), returns },
    ),
  );
}
const hoursAgo = (h: number): IsoDateTime =>
  asIsoDateTime(new Date(Date.parse(T0) - h * 3_600_000).toISOString());

/** Resolves `then` once the step stores a rule-A stop (the step's own write: an event, never a wait). */
function onStop(e: CamoufoxEngine, then: () => void): void {
  const patch = e.ctx.repos.executions.patch.bind(e.ctx.repos.executions);
  e.ctx.repos.executions.patch = (id, p) => {
    const r = patch(id, p);
    if (p.flightLists?.confirm?.stop != null) then();
    return r;
  };
}

describe('rule A ends the step (design 2026-11-08 §4.4)', () => {
  it('the worked example: 6 reads confirm, 12 do not improve the 5th (£371): exactly 18 reads, then the step stops', async () => {
    // reads 1–6 confirm £352, £371, £349, £360, £398, £356; 7–18 come out between £372 and £420, two with no trip
    const confirms = [35_200, 37_100, 34_900, 36_000, 39_800, 35_600];
    const after = [
      37_200,
      38_000,
      null,
      39_000,
      40_000,
      41_000,
      42_000,
      null,
      37_500,
      38_500,
      39_500,
      42_000,
    ];
    const ranked = pairs(40, (i) => 30_000 + 100 * i);
    const { e, cam } = confirming({
      ranked,
      reply: (n) => {
        const price = n <= 6 ? confirms[n - 1] : n <= 18 ? after[n - 7] : 30_000;
        return price === null ? NO_OUTBOUND : returnsAt(price ?? 30_000);
      },
    });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(18);
    expect(placesRead(cam)).toEqual(Array.from({ length: 18 }, (_, i) => i));
    const plan = done.flightLists;
    expect(plan?.cells).toHaveLength(18);
    // why: the queue's pairs after the 18th are priced £318–£339 on the calendar, all below the 5th confirmed (£371)
    expect(plan).toMatchObject({
      planned: 18,
      reused: 0,
      ended: null,
      returns: true,
      confirm: { mode: 'confirm', confirmed: 16, unread: 0, uncheckedCheaper: 22, stop: 'patience' },
    });
    expect(flightRows(e, done.id)).toHaveLength(18);
    // why: 18 requests of 2 pages each (out and back), against no allowance
    expect(flightLedger(e, done.id)).toBe(18);
    expect(
      e.ctx.budget.usage({ kind: 'provider-execution', executionId: done.id, providerId: 'camoufox' })
        .flightLists,
    ).toEqual({ calls: 36 });
    expect(done.status).toBe('completed');
  }, 15_000);

  /**
   * Reads that finish one at a time, 4 at once, as the design's finishing-order case has them: read 1 is held until the
   * step stops (or a 16th read starts, which a correct step never does); read 2 finishes at once; each later read finishes
   * once the read two after it has started, so each finish starts the next read before the next finish lands.
   */
  function oneAtATime(e: CamoufoxEngine) {
    const gates = new Map<number, ReturnType<typeof deferred<void>>>();
    const gate = (n: number) => {
      const g = gates.get(n) ?? deferred<void>();
      gates.set(n, g);
      return g;
    };
    const releaseAll = () => {
      for (let n = 1; n <= 40; n++) gate(n).resolve();
    };
    onStop(e, releaseAll);
    return {
      holdUntil: (n: number) => (n === 1 || n >= 3 ? gate(n).promise : undefined),
      onStart: (n: number) => {
        if (n >= 5) gate(n - 2).resolve();
        if (n >= 16) releaseAll();
      },
    };
  }

  it('finishing order: patience counts reads as they finish, 4 at once; the held first read still counts when it lands', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    let hold: ReturnType<typeof oneAtATime> | null = null;
    const { e, cam } = confirming({
      ranked,
      env: AT_ONCE,
      // why: read 1 confirms a trip but is held; every other read has no trip
      reply: (n) => (n === 1 ? returnsAt(35_000) : NO_OUTBOUND),
      flights: { holdUntil: (n) => hold?.holdUntil(n), onStart: (n) => hold?.onStart(n) },
    });
    hold = oneAtATime(e);
    const id = await start(e);
    const done = await e.settled(id);
    // why: when read 13 (the 12th non-improving finish) lands, reads 1–15 have started and patience is spent: no read
    // 16. Counting read 1 first (queue order) would have reset patience and started more
    expect(cam.flightCalls).toHaveLength(15);
    expect(done.flightLists?.cells).toHaveLength(15);
    expect(done.flightLists?.confirm).toEqual({
      mode: 'confirm',
      confirmed: 1,
      unread: 0,
      // why: fewer than 5 confirmed, so every pair not started could still have made it
      uncheckedCheaper: 25,
      stop: 'patience',
    });
    const first = flightRows(e, id).find((r) => r.departureDate === ranked[0]?.departureDate);
    expect(first?.status).toBe('read');
  }, 15_000);

  it('a stop met first decides: an ending error in flight after patience writes its own row and changes neither end nor stop', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    let hold: ReturnType<typeof oneAtATime> | null = null;
    const { e, cam } = confirming({
      ranked,
      env: AT_ONCE,
      reply: (n) => (n === 1 ? 'quota' : NO_OUTBOUND),
      flights: { holdUntil: (n) => hold?.holdUntil(n), onStart: (n) => hold?.onStart(n) },
    });
    hold = oneAtATime(e);
    const id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(15);
    expect(done.flightLists?.ended).toBeNull();
    expect(done.flightLists?.confirm).toMatchObject({ stop: 'patience', confirmed: 0, unread: 0 });
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(15);
    expect(rows.find((r) => r.departureDate === ranked[0]?.departureDate)).toMatchObject({
      status: 'failed',
      reason: 'quota',
    });
  }, 15_000);

  it('no trip can be read: every read has no outbound; 12 reads, none confirmed, stopped at patience', async () => {
    const { e, cam } = confirming({ ranked: pairs(40, (i) => 30_000 + i), reply: () => NO_OUTBOUND });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(12);
    expect(done.flightLists?.confirm).toEqual({
      mode: 'confirm',
      confirmed: 0,
      unread: 0,
      uncheckedCheaper: 28,
      stop: 'patience',
    });
  }, 15_000);

  it('equal prices: 80 pairs at one calendar price are read in the ranking order and stop at patience', async () => {
    const { e, cam } = confirming({ ranked: pairs(80, () => 45_000), reply: () => returnsAt(50_000) });
    const done = await e.settled(await start(e));
    // why: the first 5 equal trips improve (fewer than 5 before each); an equal 6th does not, so 5 + 12 reads
    expect(placesRead(cam)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(done.flightLists?.confirm).toMatchObject({ confirmed: 17, stop: 'patience' });
  }, 15_000);

  it('the queue empties: 7 pairs, all confirming, stop queue-empty', async () => {
    const { e, cam } = confirming({
      ranked: pairs(7, (i) => 30_000 + i),
      reply: (n) => returnsAt(35_000 + n),
    });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(7);
    expect(done.flightLists).toMatchObject({
      planned: 7,
      reused: 0,
      ended: null,
      confirm: { mode: 'confirm', confirmed: 7, unread: 0, uncheckedCheaper: 0, stop: 'queue-empty' },
    });
  }, 15_000);

  it('unread reads spend patience: 12 failed reads in a row that do not end the step stop it, the rows failed', async () => {
    const { e, cam } = confirming({ ranked: pairs(40, (i) => 30_000 + i), reply: () => 'network' });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(12);
    expect(done.flightLists?.confirm).toMatchObject({ confirmed: 0, unread: 12, stop: 'patience' });
    expect(flightRows(e, done.id).map((r) => [r.status, r.reason])).toEqual(
      Array(12).fill(['failed', 'network']),
    );
  }, 15_000);

  it("a read whose booking ended transient is a trip at Google's price: it counts in confirmed", async () => {
    const transient = {
      status: 'expand-failed' as const,
      rule: 'more-options:not-settled',
      attempt: 0,
      returnIndex: 0,
      expanded: false,
      moreControl: false,
      grouped: 0,
      offers: [],
      unparsed: 0,
      nonGbp: 0,
      offersStated: null,
    };
    const { e } = confirming({
      ranked: pairs(3, (i) => 30_000 + i),
      flags: BOTH,
      reply: (n) => returnsAt(35_000 + n, n === 1 ? transient : null),
    });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({
      bookingStopped: 'more-options:not-settled',
      confirm: { confirmed: 3, unread: 0, stop: 'queue-empty' },
    });
  }, 15_000);
});

describe('what the standings hold before the queue is read (design 2026-11-08 §4.2, §4.3)', () => {
  it('reuse does not spend patience: 18 reusable lists at the head of the queue send no request; 12 reads follow', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    const { e, cam } = confirming({ ranked, reply: () => returnsAt(50_000) });
    // the first 5 confirm (improving), the next 13 have no trip: all read with returns moments ago by another run
    ranked.slice(0, 18).forEach((p, i) => {
      storeList(e, p, T0, i < 5 ? returnsAt(31_000 + 100 * i) : NO_OUTBOUND);
    });
    const done = await e.settled(await start(e));
    expect(placesRead(cam)).toEqual(Array.from({ length: 12 }, (_, i) => 18 + i));
    expect(done.flightLists).toMatchObject({
      planned: 30,
      reused: 18,
      // why: 5 reused trips and 12 read ones; the 10 pairs left (£300.30–£300.39) are below the 5th, £314
      confirm: { confirmed: 17, unread: 0, uncheckedCheaper: 10, stop: 'patience' },
    });
    expect(done.flightLists?.cells).toHaveLength(12);
  }, 15_000);

  it('fresh, current verified figures are confirmed trips: not queued, counted reused, setting the 5th price', async () => {
    const verified = { basis: 'verified', providerId: 'searchapi', sourceKind: 'scraped-search' } as const;
    const ranked = [
      pairAt(0, 20_000, verified),
      pairAt(1, 20_100, verified),
      // why: a verified figure the latest search did not see is not current: no trip, not queued
      pairAt(2, 19_000, { ...verified, current: false }),
      // why: a superseded calendar price is not current: not queued, not counted unchecked however cheap
      pairAt(3, 10_000, { current: false }),
      ...Array.from({ length: 40 }, (_, k) => pairAt(4 + k, 30_000 + 300 * k)),
    ];
    const { e, cam } = confirming({
      ranked,
      reply: (n) => returnsAt(n <= 3 ? 34_900 + 100 * n : 50_000),
    });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(15);
    expect(placesRead(cam).every((i) => i >= 4)).toBe(true);
    // why: the standings are £200, £201 (verified), £350, £351, £352 (read): the 5th is £352, and of the 25 calendar
    // pairs left only £345, £348 and £351 are below it
    expect(done.flightLists).toMatchObject({
      reused: 2,
      confirm: { confirmed: 17, uncheckedCheaper: 3, stop: 'patience' },
    });
  }, 15_000);

  it('a pair read within the refresh but too long ago to reuse, not reached, counts as checked, not unchecked', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    const { e, cam } = confirming({ ranked, reply: (n) => returnsAt(n <= 5 ? 35_000 + n : 50_000) });
    e.ctx.repos.definitions.update(e.definition.id, {
      providers: { ...e.definition.providers, discoveryRefreshHours: { camoufox: 24 } },
    });
    const late = ranked[30];
    if (late === undefined) throw new Error('fixture');
    // why: 22 h under a 24 h refresh: older than 0.9 × 24 h (not reusable), within the refresh (it still leads)
    storeList(e, late, hoursAgo(22), returnsAt(40_000));
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(17);
    expect(done.flightLists).toMatchObject({
      reused: 1,
      planned: 18,
      // why: 23 pairs were not started; the one read 22 h ago is checked, so 22 are left below the 5th (£350.05)
      confirm: { confirmed: 18, uncheckedCheaper: 22, stop: 'patience' },
    });
  }, 15_000);
});

describe('returns, the window and other stops in confirm mode (design 2026-11-08 §4.4–§4.6)', () => {
  it('returns lost part-way: no read starts after the transient end; reads in flight finish; a later pass reads nothing', async () => {
    const held = deferred();
    const startedAfterStop: number[] = [];
    let id = '';
    const { e, cam } = confirming({
      ranked: pairs(40, (i) => 30_000 + i),
      env: AT_ONCE,
      reply: (n) => (n === 3 ? NOT_SETTLED : returnsAt(35_000 + n)),
      flights: {
        holdCall: { call: 4, until: held.promise },
        onStart: (n) => {
          if (e.ctx.repos.executions.get(id)?.flightLists?.returnsStopped != null) startedAfterStop.push(n);
          if (n >= 12) held.resolve();
        },
      },
    });
    onStop(e, () => held.resolve());
    id = await start(e);
    const done = await e.settled(id);
    expect(startedAfterStop).toEqual([]);
    expect(cam.flightCalls.length).toBeLessThan(10);
    expect(cam.flightCalls.every((c) => c.query.returnLimits !== undefined)).toBe(true);
    expect(flightRows(e, id)).toHaveLength(cam.flightCalls.length);
    expect(done.flightLists).toMatchObject({
      returnsStopped: 'select-outbound:not-settled',
      ended: null,
      confirm: { stop: 'returns-stopped' },
    });
    const calls = cam.flightCalls.length;
    await runFlightLists(e.ctx, newRun(e.ctx, done, { manual: false, fresh: false, blocked: new Set() }));
    expect(cam.flightCalls).toHaveLength(calls);
  }, 15_000);

  it('returns off on this machine: the first 10 pairs outbound-only, as before; mode outbound-only, or flags-unread', async () => {
    for (const [flags, mode] of [
      [{ RETURN_SELECT_VERIFIED: false }, 'outbound-only'],
      [null, 'flags-unread'],
    ] as const) {
      const { e, cam } = confirming({
        ranked: pairs(40, (i) => 30_000 + i),
        flags,
        reply: () => NO_OUTBOUND,
      });
      const done = await e.settled(await start(e));
      expect(placesRead(cam)).toEqual(Array.from({ length: 10 }, (_, i) => i));
      expect(cam.flightCalls.every((c) => c.query.returnLimits === undefined)).toBe(true);
      expect(done.flightLists).toMatchObject({
        planned: 10,
        returns: false,
        confirm: { mode, confirmed: 0, unread: 0, uncheckedCheaper: 0, stop: null },
      });
    }
  }, 15_000);

  it('a blocked page mid-step: rows only for pages sent; an older trip of a pair not started still stands', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    const { e, cam } = confirming({ ranked, reply: (n) => (n === 3 ? 'blocked' : returnsAt(35_000 + n)) });
    const older = ranked[10];
    if (older === undefined) throw new Error('fixture');
    // why: read 200 h ago under a 168 h refresh: not reusable, so queued; its pairing led before the run (an older read)
    storeList(e, older, hoursAgo(200), returnsAt(31_000));
    const id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(3);
    expect(flightRows(e, id).map((r) => [r.status, r.reason])).toEqual([
      ['read', null],
      ['read', null],
      ['failed', 'blocked'],
    ]);
    const [newest] = e.ctx.repos.flightLists.newestPerCell(e.definition.id, [older], 'economy', 'GB');
    expect(newest).toMatchObject({ status: 'read', executionId: null });
    expect(done.flightLists).toMatchObject({
      ended: 'stopped',
      confirm: { confirmed: 2, stop: null, uncheckedCheaper: 37 },
    });
    expect(done.status).toBe('completed');
    // why: §4.7: an ending error finished the step, so a later pass of the run reads nothing
    await runFlightLists(e.ctx, newRun(e.ctx, done, { manual: false, fresh: false, blocked: new Set() }));
    expect(cam.flightCalls).toHaveLength(3);
  }, 15_000);

  // Design 2026-11-08 §5.5: the stop's reason is the ending page's own detail, never a later failure of a read in flight
  it("an ending page followed by an in-flight non-ending failure stores the ending page's detail", async () => {
    const { e } = confirming({
      ranked: pairs(40, (i) => 30_000 + i),
      env: AT_ONCE,
      // why: four pages at once; the second ends the step (a quota), the third and fourth were already in flight and fail
      // after it with the network, which does not end a step
      reply: (n) => (n === 2 ? 'quota' : 'network'),
    });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({ ended: 'stopped', endedReason: 'quota' });
  }, 15_000);

  it('a step nothing ended stores no reason', async () => {
    const { e } = confirming({ ranked: pairs(40, (i) => 30_000 + i), reply: (n) => returnsAt(35_000 + n) });
    const done = await e.settled(await start(e));
    expect(done.flightLists?.endedReason).toBeNull();
  }, 15_000);

  it("the window closing mid-step: ended 'window', no stop of rule A, and the counts so far", async () => {
    let id = '';
    const { e, cam } = confirming({
      ranked: pairs(40, (i) => 30_000 + i),
      reply: (n) => returnsAt(35_000 + n),
      flights: {
        // why: the gate re-reads the stored browser window before every page, so a window that ends mid-step stops it
        onStart: (n) => {
          if (n !== 4) return;
          const end = e.ctx.repos.executions.get(id)?.browserWindowEnd ?? null;
          if (end !== null) e.clock.set(asIsoDateTime(new Date(Date.parse(end) + 1_000).toISOString()));
        },
      },
    });
    id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightRequests()).toBe(3);
    expect(flightRows(e, id)).toHaveLength(3);
    // why: the refused fourth pair sent no page: it is not among the pairs read, and counts unchecked
    expect(done.flightLists?.cells).toHaveLength(3);
    expect(done.flightLists).toMatchObject({
      planned: 3,
      ended: 'window',
      confirm: { confirmed: 3, unread: 0, uncheckedCheaper: 37, stop: null },
    });
  }, 15_000);

  it('a window too short for a return-phase read ends the step window, sending no outbound-only read', async () => {
    const ranked = pairs(40, (i) => 30_000 + i);
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e: CamoufoxEngine = engineWith([cam], {
      rankedDatePairs: (q) => {
        const run = e.ctx.repos.executions.activeParent(q.definitionId);
        // why: 700 s holds an outbound-only read (210 s) but not one with returns and the booking read (780 s)
        if (run !== null)
          e.ctx.repos.executions.patch(run.id, {
            browserWindowEnd: asIsoDateTime(new Date(Date.parse(e.clock.now()) + 700_000).toISOString()),
          });
        return ranked;
      },
    });
    e.ctx.workerFlags.set('camoufox', BOTH);
    const id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightRows(e, id)).toHaveLength(0);
    expect(done.flightLists).toMatchObject({ cells: [], ended: 'window', confirm: { stop: null } });
  }, 15_000);

  it('the running counts: read mid-step, the execution holds the pairs started and the counts so far', async () => {
    let id = '';
    const seen: Array<FlightListsState | null> = [];
    const { e } = confirming({
      ranked: pairs(40, (i) => 30_000 + i),
      reply: (n) => returnsAt(n <= 5 ? 35_000 + n : 50_000),
      flights: {
        onStart: (n) => {
          if (n === 6) seen.push(e.ctx.repos.executions.get(id)?.flightLists ?? null);
        },
      },
    });
    id = await start(e);
    await e.settled(id);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.cells).toHaveLength(6);
    expect(seen[0]).toMatchObject({
      planned: 6,
      confirm: { mode: 'confirm', confirmed: 5, unread: 0, stop: null },
    });
  }, 15_000);
});
