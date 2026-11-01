// Spec revision 55 §8.1 "Reading one date pair's flights" (WP20 Task 20.9; Review Focus 2): refusals come before any
// worker call or ledger row; the busy query and the lease are taken in one synchronous turn; the read runs camoufox's
// discovery preflight first, ignores the browser window, writes one row with no execution; a run that goes pending
// while a read is in flight waits for the lease before its first browser page; shutdown aborts a read and awaits it.
// Event-driven throughout: deferred promises, never timers.
import { asIsoDate, asIsoDateTime, type IsoDate } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createEngine } from '../src/engine.js';
import { createFlightReader } from '../src/flightRead.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  type CamoufoxEngine,
  deferred,
  engineWith,
  type FlightStubOptions,
  flightLedger,
  flightRows,
  rankedPairs,
  realTime,
  stubCamoufox,
  stubTravelpayouts,
} from './support/camoufox.js';
import { baseDefinition } from './support/harness.js';

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
    const { e, cam, reader } = setup();
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
  });

  it('a run that goes pending while a read is in flight waits for the lease before its first browser page', async () => {
    const release = deferred();
    const { e, cam, reader } = setup({ holdCall: { call: 1, until: release.promise } });
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
    const cam2 = stubCamoufox({ cells: 15, flights: { holdCall: { call: 1, until: release.promise } } });
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
