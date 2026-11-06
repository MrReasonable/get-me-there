// Spec revision 55 §8.1 "Reading one date pair's flights" (WP20 Task 20.9; Review Focus 2): refusals come before any
// worker call or ledger row; the busy query and the lease are taken in one synchronous turn; the read runs camoufox's
// discovery preflight first, ignores the browser window, writes one row with no execution; a run that goes pending
// while a read is in flight waits for the lease before its first browser page; shutdown aborts a read and awaits it.
// Event-driven throughout: deferred promises, never timers.
import {
  AbortedError,
  asIsoDate,
  asIsoDateTime,
  type BookingRead,
  type FlightLimits,
  type FlightListQuery,
  type FlightListResult,
  type IsoDate,
  ProviderError,
  type ReturnRead,
  returnReadSchema,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createEngine } from '../src/engine.js';
import { createFlightReader, flightListFresh, flightReadUnavailable } from '../src/flightRead.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { buildSnapshot } from '../src/snapshot.js';
import { readRowOf } from '../src/stages/flightLists.js';
import type { RankedDatePair, RankedDatePairsReader } from '../src/types.js';
import {
  type CamoufoxEngine,
  deferred,
  engineWith,
  type FlightStubOptions,
  flightLedger,
  flightRows,
  listAnswer,
  rankedPairs,
  realTime,
  stubCamoufox,
  stubTravelpayouts,
} from './support/camoufox.js';
import { baseDefinition, JFK, LHR } from './support/harness.js';

beforeEach(realTime);
afterEach(realTime);

/** The first ranked pair of `rankedPairs` (2 Nov to 12 Nov 2026, Heathrow to JFK). */
const PAIR = { departureDate: asIsoDate('2026-11-02'), returnDate: asIsoDate('2026-11-12') };
const pairAt = (i: number): { departureDate: IsoDate; returnDate: IsoDate } => {
  const dep = Date.parse('2026-11-02T00:00:00.000Z') + i * 86_400_000;
  return {
    departureDate: asIsoDate(new Date(dep).toISOString().slice(0, 10)),
    returnDate: asIsoDate(new Date(dep + 10 * 86_400_000).toISOString().slice(0, 10)),
  };
};

function setup(flights: FlightStubOptions = {}, o: Parameters<typeof engineWith>[1] = {}, camoufox = {}) {
  const cam = stubCamoufox({ cells: 15, flights, ...camoufox });
  const e = engineWith([cam, stubTravelpayouts({ cells: 15 })], { rankedDatePairs: rankedPairs(5), ...o });
  return { e, cam, reader: createFlightReader(e.ctx) };
}

/** A parent row of `definitionId` in `status`, its snapshot built from the definition as it stands. */
function parentRow(e: CamoufoxEngine, definitionId: string, status: 'pending' | 'running'): string {
  const def = e.ctx.repos.definitions.get(definitionId);
  if (def === null) throw new Error('no definition');
  const built = buildSnapshot(e.ctx, def);
  return e.ctx.repos.executions.create({
    definitionId,
    isChild: false,
    cell: null,
    snapshot: built.snapshot,
    estimate: null,
    trigger: 'manual',
    status,
  }).id;
}

const listErrorOf = (kind: 'upstream'): FlightListResult => ({
  kind: 'list-error',
  error: new ProviderError({ kind, retryable: false, providerId: 'camoufox', message: 'synthetic' }),
});

const ledgerTotal = (e: CamoufoxEngine): number =>
  e.ctx.db.raw.prepare<[], { n: number }>('SELECT count(*) AS n FROM provider_requests').get()?.n ?? 0;

describe('readFlightList refusals (before any worker call or ledger row)', () => {
  it.each(['pending', 'running'] as const)(
    'busy while a parent run naming camoufox is %s',
    async (status) => {
      const { e, cam, reader } = setup();
      parentRow(e, e.definition.id, status);
      const before = ledgerTotal(e);
      expect(await reader.read(e.definition.id, PAIR)).toEqual({ ok: false, code: 'busy' });
      expect(cam.flightCalls).toHaveLength(0);
      expect(ledgerTotal(e)).toBe(before);
    },
  );

  it('never busy for a Travelpayouts-only run', async () => {
    const { e, reader } = setup();
    const tpOnly = e.ctx.repos.definitions.create({
      ...baseDefinition(),
      name: 'Travelpayouts only',
      providers: { ...e.definition.providers, discovery: ['travelpayouts'] },
    });
    parentRow(e, tpOnly.id, 'running');
    const r = await reader.read(e.definition.id, PAIR);
    expect(r.ok).toBe(true);
    if (r.ok) await r.done;
  });

  it('busy while another read is in flight, and the lease is taken in the same turn as the check', async () => {
    const release = deferred();
    const { e, cam, reader } = setup({ holdCall: { call: 1, until: release.promise } });
    const first = reader.read(e.definition.id, PAIR);
    // why: nothing before the lease is awaited, so a start admitted in this same turn already sees it held
    expect(e.ctx.lease.inFlight()).toBe(true);
    expect(reader.inFlight()).toEqual({ definitionId: e.definition.id, ...PAIR });
    expect(await reader.read(e.definition.id, pairAt(1))).toEqual({ ok: false, code: 'busy' });
    release.resolve();
    const r = await first;
    if (!r.ok) throw new Error('the first read started');
    await r.done;
    expect(reader.inFlight()).toBeNull();
    expect(e.ctx.lease.inFlight()).toBe(false);
    expect(cam.flightCalls).toHaveLength(1);
  });

  it('not_available: not named, not configured, or not economy', async () => {
    const { e, reader } = setup();
    const tpOnly = e.ctx.repos.definitions.create({
      ...baseDefinition(),
      window: e.definition.window,
      minNights: 10,
      maxNights: 10,
      providers: { ...e.definition.providers, discovery: ['travelpayouts'] },
    });
    expect(await reader.read(tpOnly.id, PAIR)).toEqual({
      ok: false,
      code: 'not_available',
      reason: 'not-named',
    });
    const bare = engineWith([stubCamoufox({ cells: 15 })], { rankedDatePairs: rankedPairs(5) });
    expect(await createFlightReader(bare.ctx).read(bare.definition.id, PAIR)).toEqual({
      ok: false,
      code: 'not_available',
      reason: 'not-configured',
    });
    const business = engineWith([stubCamoufox({ cells: 15, flights: {}, cabins: ['economy', 'business'] })], {
      rankedDatePairs: rankedPairs(5),
      cabin: 'business',
    });
    expect(await createFlightReader(business.ctx).read(business.definition.id, PAIR)).toEqual({
      ok: false,
      code: 'not_available',
      reason: 'cabin',
    });
  });

  it('fresh when the newest list for the figure cell is read and younger than 0.9 × refresh', async () => {
    // why: the worker's preflight states its flags (none verified here), so the second read is judged by them; with
    // the flags unread a young outbound-only list is read again (21.6 re-review N2, the return-leg block below)
    const { e, cam, reader } = setup({}, {}, { preflight: { ok: true, flags: {} } });
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await r.done;
    expect(await reader.read(e.definition.id, PAIR)).toEqual({ ok: false, code: 'fresh' });
    expect(cam.flightCalls).toHaveLength(1);
  });

  it('outside_space for a departed or out-of-space pair; no_price for a pair without a figure; not_found', async () => {
    const { e, reader } = setup();
    expect(
      await reader.read(e.definition.id, {
        departureDate: asIsoDate('2027-06-01'),
        returnDate: asIsoDate('2027-06-11'),
      }),
    ).toEqual({ ok: false, code: 'outside_space' });
    expect(
      await reader.read(e.definition.id, {
        departureDate: asIsoDate('2026-11-02'),
        returnDate: asIsoDate('2026-11-05'),
      }),
    ).toEqual({ ok: false, code: 'outside_space' });
    e.clock.set(asIsoDateTime('2026-11-02T09:00:00.000Z'));
    expect(await reader.read(e.definition.id, PAIR)).toEqual({ ok: false, code: 'outside_space' });
    expect(await reader.read(e.definition.id, pairAt(8))).toEqual({ ok: false, code: 'no_price' });
    expect(await reader.read('no-such-search', PAIR)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('readFlightList reads', () => {
  it('runs the preflight first, ignores the browser window and writes one row with no execution', async () => {
    const { e, cam, reader } = setup({}, { env: { CAMOUFOX_BROWSER_WINDOW: 'scheduled' } });
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await r.done;
    expect(cam.flightCalls).toHaveLength(1);
    expect(cam.flightCalls[0]?.executionId).toBeNull();
    expect(cam.flightCalls[0]?.gated).toBe(false);
    expect(cam.flightCalls[0]?.recordFixtures).toBe(false);
    expect(cam.flightCalls[0]?.query.airportNames).toEqual({
      origin: ['London Heathrow Airport'],
      destination: ['John F Kennedy International Airport'],
      otherOrigins: [],
      otherDestinations: [],
    });
    expect(flightRows(e, null)).toEqual([
      {
        status: 'read',
        reason: null,
        departureDate: PAIR.departureDate,
        executionId: null,
        listed: 'flights',
      },
    ]);
    expect(flightLedger(e, null)).toBe(1);
  });

  it('a preflight refusal records failed with its class word and sends no page', async () => {
    const { e, cam, reader } = setup(
      {},
      {},
      {
        preflight: { ok: false, skip: 'provider_unavailable', detail: 'the worker is not answering' },
      },
    );
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await r.done;
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([
      ['failed', 'provider-unavailable'],
    ]);
  });

  it('a throw inside the read records failed fatal and clears the mark', async () => {
    const { e, reader } = setup({
      answer: () => {
        throw new Error('synthetic failure inside the read');
      },
    });
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await r.done;
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([['failed', 'fatal']]);
    expect(reader.inFlight()).toBeNull();
    expect(e.logs.filter((l) => l.level === 'error')).toEqual([
      {
        level: 'error',
        bindings: { definitionId: e.definition.id, providerId: 'camoufox', step: 'flight-read' },
        fields: { err: 'synthetic failure inside the read' },
        msg: 'flight read: failed',
      },
    ]);
  });

  it('a failing insert in a failure branch never rejects done: the failure is logged and recorded as fatal', async () => {
    const { e, reader } = setup({
      answer: () => {
        throw new ProviderError({
          kind: 'upstream',
          retryable: false,
          providerId: 'camoufox',
          message: 'synthetic',
        });
      },
    });
    const insert = e.ctx.repos.flightLists.insert.bind(e.ctx.repos.flightLists);
    let n = 0;
    e.ctx.repos.flightLists.insert = (row) => {
      n += 1;
      if (n === 1) throw new Error('SQLITE_BUSY: database is locked (synthetic)');
      return insert(row);
    };
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await expect(r.done).resolves.toBeUndefined();
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([['failed', 'fatal']]);
    expect(e.logs.filter((l) => l.level === 'error').map((l) => [l.msg, l.fields])).toEqual([
      [
        'flight read: its failure could not be recorded',
        { err: 'SQLITE_BUSY: database is locked (synthetic)', reason: 'upstream' },
      ],
    ]);
    expect(reader.inFlight()).toBeNull();
  });

  it('an insert that always fails still never rejects done, and frees the lease', async () => {
    const { e, reader } = setup({ answer: () => listErrorOf('upstream') });
    e.ctx.repos.flightLists.insert = () => {
      throw new Error('SQLITE_IOERR: disk I/O error (synthetic)');
    };
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    await expect(r.done).resolves.toBeUndefined();
    expect(flightRows(e, null)).toEqual([]);
    expect(e.ctx.lease.inFlight()).toBe(false);
  });

  it('a run that goes pending while a read is in flight waits for the lease before its first browser page', async () => {
    const release = deferred();
    const events: string[] = [];
    const { e, cam, reader } = setup(
      { holdCall: { call: 1, until: release.promise }, onEnd: (n) => events.push(`read-end:${n}`) },
      {},
      { onTile: (n: number) => events.push(`grid:${n}`) },
    );
    const r = await reader.read(e.definition.id, PAIR);
    if (!r.ok) throw new Error('started');
    const waiting = deferred();
    const whenFree = e.ctx.lease.whenFree;
    e.ctx.lease.whenFree = (signal) => {
      waiting.resolve();
      return whenFree(signal);
    };
    const started = await e.orch.start(e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!started.ok) throw new Error(started.message);
    await waiting.promise;
    expect(cam.calls).toHaveLength(0);
    release.resolve();
    await r.done;
    const done = await e.settled(started.executionId);
    expect(done.status).toBe('completed');
    expect(cam.calls).toHaveLength(15);
    // why: the read's page settled before the run's first browser page started (the order, not only a count)
    expect(events.slice(0, 2)).toEqual(['read-end:1', 'grid:1']);
  });

  it('a Resume whose grid has no cells left waits the same way before the flight step first page', async () => {
    const inFlight = deferred();
    const cam = stubCamoufox({
      cells: 15,
      flights: {
        holdCall: { call: 3, until: new Promise(() => undefined) },
        onStart: (n) => n === 3 && inFlight.resolve(),
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(10), scheduleCron: '0 5 * * 1' });
    const started = await e.orch.start(e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!started.ok) throw new Error(started.message);
    await inFlight.promise;
    // why: a cancel ends the run with its grid done and 2 flight lists read; a manual Resume then has only flights left
    await e.orch.cancel(started.executionId, { kind: 'cancelled' });
    const release = deferred();
    const events: string[] = [];
    const cam2 = stubCamoufox({
      cells: 15,
      flights: {
        holdCall: { call: 1, until: release.promise },
        onStart: (n) => events.push(`start:${n}`),
        onEnd: (n) => events.push(`end:${n}`),
      },
    });
    const ctx = buildContext({ ...e.deps, providers: [cam2] }, { rankedDatePairs: rankedPairs(10) });
    cam2.bind(() => ctx);
    const reader = createFlightReader(ctx);
    const orch = createOrchestrator(ctx);
    const read = await reader.read(e.definition.id, pairAt(9));
    if (!read.ok) throw new Error(`the read started: ${read.code}`);
    const waiting = deferred();
    const whenFree = ctx.lease.whenFree;
    ctx.lease.whenFree = (signal) => {
      waiting.resolve();
      return whenFree(signal);
    };
    expect((await orch.resume(started.executionId, { manual: true })).ok).toBe(true);
    await waiting.promise;
    // why: only the on-demand read's page so far; the resumed step's first page waits for the lease
    expect(cam2.flightCalls).toHaveLength(1);
    release.resolve();
    await read.done;
    const done = await e.settled(started.executionId);
    expect(done.status).toBe('completed');
    expect(cam2.flightCalls.filter((c) => c.executionId === started.executionId)).toHaveLength(8);
    // why: the on-demand read's page (1) settled before the resumed step's first page (2) started
    expect(events.slice(0, 3)).toEqual(['start:1', 'end:1', 'start:2']);
    await orch.shutdown();
  });

  it('shutdown aborts a read in flight, awaits it within the drain and writes nothing after closed', async () => {
    const reached = deferred();
    const cam = stubCamoufox({
      cells: 15,
      flights: {
        holdCall: { call: 1, until: new Promise(() => undefined) },
        onStart: () => reached.resolve(),
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(5) });
    const engine = createEngine({ ...e.deps, providers: [cam] }, { rankedDatePairs: rankedPairs(5) });
    const r = await engine.readFlightList(e.definition.id, PAIR);
    if (!r.ok) throw new Error(`started: ${r.code}`);
    await reached.promise;
    expect(engine.flightReadInFlight()).toEqual({ definitionId: e.definition.id, ...PAIR });
    let settled = false;
    void r.done.then(() => {
      settled = true;
    });
    await engine.shutdown();
    // why: the drain waits for the read: it has settled by the time shutdown returns, not after
    expect(settled).toBe(true);
    expect(engine.flightReadInFlight()).toBeNull();
    expect(flightRows(e, null)).toHaveLength(0);
    expect(await engine.readFlightList(e.definition.id, PAIR)).toEqual({ ok: false, code: 'shutting-down' });
  });
});

// Spec rev 56 §8.1 "Reading one date pair's flights" (WP21 Task 21.6): the read's preflight sets the worker's flags; the
// read sends the definition's limits and the booking ask as they say; it stores the return read on its row (failed: none, data-005); `fresh` is the step's reuse rule.
describe('readFlightList with the return leg (spec rev 56 §8.1)', () => {
  const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
  const LIMITS: FlightLimits = {
    maxJourneyMinutes: 1500,
    maxStops: 1,
    departureWindowLocal: null,
    arrivalWindowLocal: null,
  };
  /** A return read of the stub's one flight, its booking `booking` (null: none asked). */
  const returnsOf = (over: Partial<ReturnRead> = {}, booking: Partial<BookingRead> = {}): ReturnRead =>
    returnReadSchema.parse({
      limits: LIMITS,
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
              fromMinor: 118_000,
            },
          ],
          optionsUnparsed: 0,
          optionsOtherCell: 0,
          resultsStated: null,
        },
      ],
      triedAll: true,
      booking: {
        status: 'read',
        rule: null,
        attempt: 0,
        returnIndex: 0,
        expanded: true,
        moreControl: false,
        grouped: 0,
        offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 118_000 }],
        unparsed: 0,
        nonGbp: 0,
        offersStated: null,
        ...booking,
      },
      ...over,
    });
  const withReturns =
    (r: ReturnRead) =>
    (q: FlightListQuery): FlightListResult => ({
      ...listAnswerAt(),
      returns: q.returnLimits === undefined ? null : r,
    });
  const listAnswerAt = () => listAnswer(asIsoDateTime('2026-10-15T09:00:00.000Z'));

  /** A camoufox engine whose preflight reports `flags`, over a definition limited to 25 h and 1 stop. */
  function flagged(flags: Record<string, boolean> | null, flights: FlightStubOptions = {}, o = {}) {
    const s = setup(flights, o, flags === null ? {} : { preflight: { ok: true, flags } });
    s.e.ctx.repos.definitions.update(s.e.definition.id, {
      constraints: { maxJourneyMinutes: 1500, maxStops: 1 },
    });
    return s;
  }
  const readOnce = async (s: ReturnType<typeof flagged>) => {
    const r = await s.reader.read(s.e.definition.id, PAIR);
    if (!r.ok) throw new Error(`refused: ${r.code}`);
    await r.done;
  };
  const stored = (e: CamoufoxEngine) =>
    e.ctx.repos.flightLists
      .newestPerCell(e.definition.id, [{ origin: LHR, destination: JFK, ...PAIR }], 'economy', 'GB')
      .at(0);
  const pageCounts = (e: CamoufoxEngine) =>
    e.ctx.db.raw
      .prepare<[], { n: number | null }>(
        "SELECT page_count AS n FROM provider_requests WHERE endpoint_path = '/v1/flights' ORDER BY id",
      )
      .all()
      .map((r) => r.n);

  it('runs the preflight first and sets the flags; sends the limits and booking as they say, none otherwise', async () => {
    const both = flagged(BOTH, { answer: withReturns(returnsOf()) });
    expect(both.e.ctx.workerFlags.get('camoufox')).toBeNull();
    await readOnce(both);
    expect(both.e.ctx.workerFlags.get('camoufox')).toEqual(BOTH);
    expect(both.cam.flightCalls[0]?.query).toMatchObject({ returnLimits: LIMITS, booking: true });
    const noBooking = flagged({ RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false });
    await readOnce(noBooking);
    expect(noBooking.cam.flightCalls[0]?.query).toMatchObject({ returnLimits: LIMITS, booking: false });
    for (const flags of [null, { RETURN_SELECT_VERIFIED: false, BOOKING_SELECT_VERIFIED: true }]) {
      const off = flagged(flags);
      await readOnce(off);
      expect('returnLimits' in (off.cam.flightCalls[0]?.query ?? {})).toBe(false);
      expect('booking' in (off.cam.flightCalls[0]?.query ?? {})).toBe(false);
    }
  });

  it('stores the return read with its booking, and the ledger row the pages it loaded; a failed read stores none', async () => {
    const ok = flagged(BOTH, { answer: withReturns(returnsOf()) });
    await readOnce(ok);
    expect(stored(ok.e)?.returns).toEqual(returnsOf());
    expect(pageCounts(ok.e)).toEqual([2]);
    const failed = flagged(BOTH, { answer: () => listErrorOf('upstream') });
    await readOnce(failed);
    expect(stored(failed.e)).toMatchObject({ status: 'failed', returns: null });
  });

  it('21.6 review M12: a preflight that states no flags leaves the flags as they were; the read still carries the limits', async () => {
    const s = setup({}, {}, { preflight: { ok: true } });
    s.e.ctx.repos.definitions.update(s.e.definition.id, {
      constraints: { maxJourneyMinutes: 1500, maxStops: 1 },
    });
    s.e.ctx.workerFlags.set('camoufox', BOTH);
    await readOnce(s);
    expect(s.e.ctx.workerFlags.get('camoufox')).toEqual(BOTH);
    expect(s.cam.flightCalls[0]?.query).toMatchObject({ returnLimits: LIMITS, booking: true });
  });

  /** Seeds the cell's newest lists (oldest first), each `hoursAgo` old with return read `returns`. */
  function seed(e: CamoufoxEngine, lists: Array<{ hoursAgo: number; returns: ReturnRead | null }>) {
    for (const l of lists)
      e.ctx.repos.flightLists.insert(
        readRowOf(
          {
            definitionId: e.definition.id,
            executionId: null,
            providerId: 'camoufox',
            sourceKind: 'scraped-self',
            cabin: 'economy',
            origin: LHR,
            destination: JFK,
            ...PAIR,
          },
          {
            ...listAnswerAt(),
            fetchedAt: asIsoDateTime(
              new Date(Date.parse(e.clock.now()) - l.hoursAgo * 3_600_000).toISOString(),
            ),
            returns: l.returns,
          },
        ),
      );
  }
  const askWith = async (
    flags: Record<string, boolean> | null,
    lists: Array<{ hoursAgo: number; returns: ReturnRead | null }>,
  ) => {
    const s = flagged(flags);
    if (flags !== null) s.e.ctx.workerFlags.set('camoufox', flags);
    seed(s.e, lists);
    // why: final review B-I3: the api's readNow reads the same rule as the read's own refusal, before the read
    const def = s.e.ctx.repos.definitions.get(s.e.definition.id);
    const newest = stored(s.e);
    if (def === null || newest === undefined) throw new Error('seeded');
    const freshBefore = flightListFresh(s.e.ctx, def, newest);
    const r = await s.reader.read(s.e.definition.id, PAIR);
    if (r.ok) await r.done;
    expect(freshBefore).toBe(!r.ok && r.code === 'fresh');
    return r.ok ? 'read' : r.code;
  };
  const notSettled = () =>
    returnReadSchema.parse({
      limits: LIMITS,
      status: 'not-settled',
      rule: 'select-outbound:not-settled',
      attempts: [],
      triedAll: false,
      booking: null,
    });

  it('fresh: a young finished list under the same limits with a finished booking, or a streak of 2', async () => {
    expect(await askWith(BOTH, [{ hoursAgo: 150, returns: returnsOf() }])).toBe('fresh');
    expect(
      await askWith(BOTH, [
        {
          hoursAgo: 1,
          returns: returnsOf(
            {},
            { status: 'no-pairing', attempt: null, returnIndex: null, offers: [], expanded: false },
          ),
        },
      ]),
    ).toBe('fresh');
    expect(
      await askWith(BOTH, [
        { hoursAgo: 3, returns: notSettled() },
        { hoursAgo: 2, returns: notSettled() },
      ]),
    ).toBe('fresh');
    // no return phase planned for this worker (its flags read, the return flag off): any young read list, not-verified
    // or phase-less included
    expect(await askWith({ RETURN_SELECT_VERIFIED: false }, [{ hoursAgo: 1, returns: notSettled() }])).toBe(
      'fresh',
    );
  });

  it('read again: a young transient (streak 1), not-verified, expand-failed, other-limit or phase-less list', async () => {
    expect(await askWith(BOTH, [{ hoursAgo: 2, returns: notSettled() }])).toBe('read');
    const notVerified = returnReadSchema.parse({
      limits: LIMITS,
      status: 'not-verified',
      rule: null,
      attempts: [],
      triedAll: false,
      booking: null,
    });
    expect(await askWith(BOTH, [{ hoursAgo: 1, returns: notVerified }])).toBe('read');
    expect(
      await askWith(BOTH, [
        {
          hoursAgo: 1,
          returns: returnsOf(
            {},
            { status: 'expand-failed', rule: 'more-options:not-settled', expanded: false },
          ),
        },
      ]),
    ).toBe('read');
    expect(
      await askWith(BOTH, [{ hoursAgo: 1, returns: returnsOf({ limits: { ...LIMITS, maxStops: 0 } }) }]),
    ).toBe('read');
    expect(await askWith(BOTH, [{ hoursAgo: 1, returns: null }])).toBe('read');
  });

  it('with no booking read planned (the booking flag off) a read return with an expand-failed booking is fresh', async () => {
    const expandFailed = returnsOf(
      {},
      { status: 'expand-failed', rule: 'more-options:not-settled', expanded: false },
    );
    expect(
      await askWith({ RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false }, [
        { hoursAgo: 1, returns: expandFailed },
      ]),
    ).toBe('fresh');
    expect(await askWith(BOTH, [{ hoursAgo: 1, returns: expandFailed }])).toBe('read');
  });

  it('21.6 re-review N2: with the flags unread (no preflight since the app started) a young outbound-only list is read', async () => {
    // why: the read's own preflight may report the return flags, so it is judged as planning the whole return phase,
    // as the read button states 2 pages then (prov-008)
    expect(await askWith(null, [{ hoursAgo: 1, returns: null }])).toBe('read');
    expect(await askWith(null, [{ hoursAgo: 1, returns: returnsOf() }])).toBe('fresh');
  });

  it('with the flags unread the booking read is planned too: a young list whose booking expand failed is read again', async () => {
    const expandFailed = returnsOf(
      {},
      { status: 'expand-failed', rule: 'more-options:not-settled', expanded: false },
    );
    expect(await askWith(null, [{ hoursAgo: 1, returns: expandFailed }])).toBe('read');
  });

  it('the boundary: a finished list exactly 0.9 × refresh old (151.2 h) is read; one just younger is fresh', async () => {
    expect(await askWith(BOTH, [{ hoursAgo: 151.2, returns: returnsOf() }])).toBe('read');
    expect(await askWith(BOTH, [{ hoursAgo: 151.1, returns: returnsOf() }])).toBe('fresh');
  });
});

describe('the engine contract: setWorkerFlags and flightPagesPlanned (spec rev 56 §10, ruling D3)', () => {
  it('plans 2 pages before any read (prov-008: the read may set the flag and load 2), 1 with the flag off, 2 with it on', () => {
    const { e } = setup();
    const engine = createEngine(e.deps, { rankedDatePairs: rankedPairs(5) });
    expect(engine.flightPagesPlanned()).toBe(2);
    engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: false });
    expect(engine.flightPagesPlanned()).toBe(1);
    engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: true });
    expect(engine.flightPagesPlanned()).toBe(2);
    engine.markClosed();
  });
  it('final review B-I3: flightListFresh is the read’s fresh rule over the engine’s own flags', () => {
    const { e } = setup();
    const engine = createEngine(e.deps, { rankedDatePairs: rankedPairs(5) });
    e.ctx.repos.definitions.update(e.definition.id, {
      constraints: { maxJourneyMinutes: 1500, maxStops: 1 },
    });
    e.ctx.repos.flightLists.insert(
      readRowOf(
        {
          definitionId: e.definition.id,
          executionId: null,
          providerId: 'camoufox',
          sourceKind: 'scraped-self',
          cabin: 'economy',
          origin: LHR,
          destination: JFK,
          ...PAIR,
        },
        { ...listAnswer(asIsoDateTime('2026-10-15T09:00:00.000Z')), fetchedAt: e.clock.now(), returns: null },
      ),
    );
    const def = e.ctx.repos.definitions.get(e.definition.id);
    const [newest] = e.ctx.repos.flightLists.newestPerCell(
      e.definition.id,
      [{ origin: LHR, destination: JFK, ...PAIR }],
      'economy',
      'GB',
    );
    if (def === null || newest === undefined) throw new Error('seeded');
    // why: a young outbound-only list: read again while the flags are unread or plan returns, fresh once they do not
    expect(engine.flightListFresh(def, newest)).toBe(false);
    engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: false });
    expect(engine.flightListFresh(def, newest)).toBe(true);
    engine.markClosed();
  });
});

describe('readFlightList at its edges (refusals, the provider’s answers and the rows they leave)', () => {
  const ask = async (r: ReturnType<typeof setup>['reader'], definitionId: string, pair = PAIR) => {
    const started = await r.read(definitionId, pair);
    if (!started.ok) return started.code;
    await started.done;
    return 'read';
  };

  it('a search naming camoufox on an install that registers no camoufox at all: not-configured', () => {
    const { e } = setup();
    expect(flightReadUnavailable({ providers: new Map() }, e.definition)).toBe('not-configured');
  });

  it('not_found for a deleted search', async () => {
    const { e, cam, reader } = setup();
    e.ctx.repos.definitions.softDelete(e.definition.id);
    expect(await reader.read(e.definition.id, PAIR)).toEqual({ ok: false, code: 'not_found' });
    expect(cam.flightCalls).toHaveLength(0);
  });

  it('a one-day window holds its own date pairs: the read goes ahead', async () => {
    const { e, cam, reader } = setup();
    e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: PAIR.departureDate, to: PAIR.departureDate },
    });
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(cam.flightCalls).toHaveLength(1);
  });

  it('no_price without the board’s ranking', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e = engineWith([cam, stubTravelpayouts({ cells: 15 })]);
    expect(await createFlightReader(e.ctx).read(e.definition.id, PAIR)).toEqual({
      ok: false,
      code: 'no_price',
    });
    expect(cam.flightCalls).toHaveLength(0);
  });

  it('asks the ranking for the search’s current space, cabin, journey limit and now', async () => {
    const calls: Array<Parameters<RankedDatePairsReader>[0]> = [];
    const { e, reader } = setup({}, { rankedDatePairs: rankedPairs(5, calls) });
    e.ctx.repos.definitions.update(e.definition.id, { constraints: { maxJourneyMinutes: 1500 } });
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(calls).toEqual([
      {
        definitionId: e.definition.id,
        space: {
          origins: [LHR],
          destinations: [JFK],
          departureFrom: '2026-11-02',
          departureTo: '2026-11-16',
          minNights: 10,
          maxNights: 10,
        },
        cabin: 'economy',
        maxJourneyMinutes: 1500,
        now: e.clock.now(),
      },
    ]);
  });

  it('the figure is the ranked pair with both dates: one sharing only its departure or only its return is no price', async () => {
    // why: stays of 10 to 12 nights, and a ranking holding only 2 Nov to 13 Nov (11 nights)
    const ranked: RankedDatePair = {
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-13'),
      origin: LHR,
      destination: JFK,
      pricePence: 40_000,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
    };
    const { e, cam, reader } = setup({}, { rankedDatePairs: () => [ranked] });
    e.ctx.repos.definitions.update(e.definition.id, { minNights: 10, maxNights: 12 });
    const pair = (d: string, r: string) => ({ departureDate: asIsoDate(d), returnDate: asIsoDate(r) });
    expect(await ask(reader, e.definition.id, pair('2026-11-02', '2026-11-14'))).toBe('no_price');
    expect(await ask(reader, e.definition.id, pair('2026-11-03', '2026-11-13'))).toBe('no_price');
    expect(cam.flightCalls).toHaveLength(0);
    expect(await ask(reader, e.definition.id, pair('2026-11-02', '2026-11-13'))).toBe('read');
  });

  it('busy while another reader of the same engine holds the browser lease', async () => {
    const release = deferred();
    const { e, cam, reader } = setup({ holdCall: { call: 1, until: release.promise } });
    const first = await reader.read(e.definition.id, PAIR);
    if (!first.ok) throw new Error('the first read started');
    expect(await createFlightReader(e.ctx).read(e.definition.id, pairAt(1))).toEqual({
      ok: false,
      code: 'busy',
    });
    release.resolve();
    await first.done;
    expect(cam.flightCalls).toHaveLength(1);
  });

  it('a preflight refusal with no class word is blocked unless the worker is unreachable, and it is logged with the search', async () => {
    const { e, cam, reader } = setup(
      {},
      {},
      {
        preflight: { ok: false, skip: 'provider_disabled', detail: 'the consent record is missing' },
      },
    );
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([['failed', 'blocked']]);
    expect(e.logs.filter((l) => l.msg?.startsWith('flight read'))).toEqual([
      {
        level: 'warn',
        bindings: { definitionId: e.definition.id, providerId: 'camoufox', step: 'flight-read' },
        fields: { skip: 'provider_disabled', detail: 'the consent record is missing' },
        msg: 'flight read: preflight refused',
      },
    ]);
  });

  it('runs the preflight with no execution, the read’s own signal and no fixture recording', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const discovery = cam.discovery;
    if (discovery === undefined) throw new Error('no discovery');
    const seen: Array<{ executionId: string | null; aborted: boolean; recordFixtures: boolean }> = [];
    const recording = {
      ...cam,
      discovery: {
        ...discovery,
        preflight: async (p: {
          executionId: string | null;
          signal: AbortSignal;
          recordFixtures: boolean;
        }) => {
          seen.push({
            executionId: p.executionId,
            aborted: p.signal.aborted,
            recordFixtures: p.recordFixtures,
          });
          return { ok: true as const };
        },
      },
    };
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(5) });
    const ctx = buildContext({ ...e.deps, providers: [recording] }, { rankedDatePairs: rankedPairs(5) });
    cam.bind(() => ctx);
    const r = await createFlightReader(ctx).read(e.definition.id, PAIR);
    if (!r.ok) throw new Error(`refused: ${r.code}`);
    await r.done;
    expect(seen).toEqual([{ executionId: null, aborted: false, recordFixtures: false }]);
    expect(flightRows(e, null).map((x) => x.status)).toEqual(['read']);
  });

  it('a browser provider with a flight-list capability and no discovery capability reads without a preflight', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const { discovery: _none, ...flightsOnly } = cam;
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(5) });
    const ctx = buildContext({ ...e.deps, providers: [flightsOnly] }, { rankedDatePairs: rankedPairs(5) });
    cam.bind(() => ctx);
    const r = await createFlightReader(ctx).read(e.definition.id, PAIR);
    if (!r.ok) throw new Error(`refused: ${r.code}`);
    await r.done;
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([['read', null]]);
  });

  it('a read stopped while its page is out writes nothing, even when the page answers', async () => {
    let stop: () => void = () => undefined;
    const s = setup({ onStart: () => stop() });
    stop = () => {
      void s.reader.stop();
    };
    expect(await ask(s.reader, s.e.definition.id)).toBe('read');
    expect(s.cam.flightCalls).toHaveLength(1);
    expect(flightRows(s.e, null)).toEqual([]);
  });

  it.each<[string, () => FlightListResult, string]>([
    [
      'a list error with its own class word stores that word',
      () => ({
        kind: 'list-error',
        error: new ProviderError({
          kind: 'parse',
          retryable: false,
          providerId: 'camoufox',
          message: 'synthetic',
          reason: 'no-airport-names',
        }),
      }),
      'no-airport-names',
    ],
    ['a list error without one stores its kind', () => listErrorOf('upstream'), 'upstream'],
    [
      'a thrown provider error with a class word stores that word',
      () => {
        throw new ProviderError({
          kind: 'parse',
          retryable: false,
          providerId: 'camoufox',
          message: 'synthetic',
          reason: 'no-airport-names',
        });
      },
      'no-airport-names',
    ],
    [
      'a thrown provider error without a class word stores its kind',
      () => {
        throw new ProviderError({
          kind: 'upstream',
          retryable: false,
          providerId: 'camoufox',
          message: 'synthetic',
        });
      },
      'upstream',
    ],
  ])('%s, and logs no error', async (_n, answer, reason) => {
    const { e, reader } = setup({ answer });
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(flightRows(e, null).map((x) => [x.status, x.reason])).toEqual([['failed', reason]]);
    expect(e.logs.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('a read the provider gives up on (AbortedError) with the read not stopped writes nothing and logs no error', async () => {
    const { e, reader } = setup({
      answer: () => {
        throw new AbortedError();
      },
    });
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(flightRows(e, null)).toEqual([]);
    expect(e.logs.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('a fatal failure whose row cannot be written is logged and not written again', async () => {
    const { e, reader } = setup({
      answer: () => {
        throw new Error('synthetic failure inside the read');
      },
    });
    const insert = e.ctx.repos.flightLists.insert.bind(e.ctx.repos.flightLists);
    let n = 0;
    e.ctx.repos.flightLists.insert = (row) => {
      n += 1;
      if (n === 1) throw new Error('SQLITE_BUSY: database is locked (synthetic)');
      return insert(row);
    };
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(n).toBe(1);
    expect(flightRows(e, null)).toEqual([]);
    expect(e.logs.filter((l) => l.level === 'error').map((l) => [l.msg, l.fields])).toEqual([
      ['flight read: failed', { err: 'synthetic failure inside the read' }],
      [
        'flight read: its failure could not be recorded',
        { err: 'SQLITE_BUSY: database is locked (synthetic)', reason: 'fatal' },
      ],
    ]);
  });

  it('when neither its failure row nor the fatal one can be written, both are logged and done still resolves', async () => {
    const { e, reader } = setup({
      answer: () => {
        throw new ProviderError({
          kind: 'upstream',
          retryable: false,
          providerId: 'camoufox',
          message: 'synthetic',
        });
      },
    });
    e.ctx.repos.flightLists.insert = () => {
      throw new Error('SQLITE_IOERR: disk I/O error (synthetic)');
    };
    expect(await ask(reader, e.definition.id)).toBe('read');
    expect(e.logs.filter((l) => l.level === 'error').map((l) => [l.msg, l.fields])).toEqual([
      [
        'flight read: its failure could not be recorded',
        { err: 'SQLITE_IOERR: disk I/O error (synthetic)', reason: 'upstream' },
      ],
      ['flight read: no failure row could be written', { err: 'SQLITE_IOERR: disk I/O error (synthetic)' }],
    ]);
  });
});
