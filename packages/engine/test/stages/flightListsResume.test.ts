// Spec revision 55 §8.1 "The flight-list step", resumed passes: a resumed pass keeps `planned` and `cells`, reads only
// planned cells with no row of this execution, skips (no row) one that has since departed, never writes a pair twice;
// a retry-errors resume of a completed run re-reads nothing; a resume past the run's browser window reads no flight
// page and leaves `ended 'window'`; a pass whose preflight disabled camoufox froze no plan, so a manual Resume reads 10.
// Spec rev 56 §8.1: a resumed pass keeps the plan's `returns` and `booking` (a plan stored before WP21 reads as
// outbound-only), and a page cancelled during its return phase writes no row and is read once by the resumed pass.
// Design 2026-11-08 §4.7: a confirm-mode step that was interrupted resumes by rebuilding its queue (this run's lists are
// reads already made, patience starts again at 0) and ends as an uninterrupted one would; one that finished reads
// nothing more; a plan stored before the change resumes the same way and is never refused.
import {
  apiContract,
  asIsoDateTime,
  type FlightLimits,
  type FlightListQuery,
  type FlightListResult,
  ProviderError,
  type ReturnRead,
  returnReadSchema,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import { laneFor, newRun } from '../../src/run.js';
import { runFlightLists } from '../../src/stages/flightLists.js';
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
  type Stub,
  stubCamoufox,
} from '../support/camoufox.js';
import { T0 } from '../support/harness.js';

beforeEach(realTime);
afterEach(realTime);

async function start(e: CamoufoxEngine): Promise<string> {
  const r = await e.orch.start(e.definition.id, {
    trigger: 'manual',
    confirmCostPence: 1_000_000,
    confirmCalls: 1_000_000,
  });
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r.executionId;
}

/** A fresh process over the same database (no in-memory state survives): a new context and orchestrator. */
function restart(e: CamoufoxEngine, stubs: Stub[]) {
  const ctx = buildContext({ ...e.deps, providers: stubs }, { rankedDatePairs: rankedPairs(15) });
  for (const s of stubs) s.bind(() => ctx);
  return { ctx, orch: createOrchestrator(ctx) };
}

/** A scheduled camoufox-only search whose run is stopped by SIGTERM while its `call`-th flight page is in flight. */
async function interruptedAt(
  call: number,
  env: Record<string, string> = {},
  flags: Record<string, boolean> | null = null,
) {
  const inFlight = deferred();
  const cam = stubCamoufox({
    cells: 15,
    flights: {
      holdCall: { call, until: new Promise(() => undefined) },
      onStart: (n) => n === call && inFlight.resolve(),
    },
  });
  const e = engineWith([cam], { rankedDatePairs: rankedPairs(15), scheduleCron: '0 5 * * 1', env });
  if (flags !== null) e.ctx.workerFlags.set('camoufox', flags);
  const id = await start(e);
  await inFlight.promise;
  await e.orch.shutdown();
  const stopped = e.ctx.repos.executions.get(id);
  expect(stopped?.status).toBe('interrupted');
  expect(flightRows(e, id)).toHaveLength(call - 1);
  // why: the held page's own options are its own; later pages answer at once
  const cam2 = stubCamoufox({ cells: 15, flights: {} });
  return { e, id, cam2, plan: stopped?.flightLists ?? null };
}

describe('a resumed flight-list step', () => {
  it('after a SIGTERM at 4 of 10, the automatic resume keeps the plan and reads the 6 planned cells without a row', async () => {
    const { e, id, cam2, plan } = await interruptedAt(5);
    expect(plan?.planned).toBe(10);
    const p = restart(e, [cam2]);
    const r = await p.orch.resume(id, { manual: false });
    expect(r.ok).toBe(true);
    const done = await e.settled(id);
    expect(done.status).toBe('completed');
    expect(cam2.flightCalls.map((c) => c.query.cell)).toEqual(plan?.cells.slice(4));
    expect(done.flightLists).toEqual(plan);
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r2) => r2.departureDate)).size).toBe(10);
    // why: 4 requests before the SIGTERM, the held one (cut off before any answer, ledgered at its plan as http-kit
    // does, 21.6 review I2) and 6 after
    expect(flightLedger(e, id)).toBe(11);
    const counts = p.ctx.repos.flightLists.forExecution(id, done.flightLists?.cells ?? []);
    expect(counts.read + counts.failed + (done.flightLists?.reused ?? 0)).toBeLessThanOrEqual(10);
    expect(apiContract.flightListsStateSchema.parse(done.flightLists)).toBeTruthy();
    await p.orch.shutdown();
  });

  it('skips (no row) a planned cell that has departed by the resume', async () => {
    // why: the browser window is unbounded here, so moving the clock days on does not leave the browser cells
    const { e, id, cam2, plan } = await interruptedAt(5, { CAMOUFOX_BROWSER_WINDOW: 'any' });
    // the fifth planned cell departs on 6 Nov 2026; on 6 Nov it has departed (on or before today in London)
    e.clock.set(asIsoDateTime('2026-11-06T09:00:00.000Z'));
    const p = restart(e, [cam2]);
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    expect(cam2.flightCalls.map((c) => c.query.cell)).toEqual(plan?.cells.slice(5));
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(9);
    // why: 4 requests before the SIGTERM, the held one, 5 after it (the departed fifth cell sends none)
    expect(flightLedger(e, id)).toBe(10);
    expect(rows.some((r) => r.departureDate === plan?.cells[4]?.departureDate)).toBe(false);
    const counts = p.ctx.repos.flightLists.forExecution(id, done.flightLists?.cells ?? []);
    expect(counts.read + counts.failed + (done.flightLists?.reused ?? 0)).toBeLessThanOrEqual(
      done.flightLists?.planned ?? 0,
    );
    await p.orch.shutdown();
  });

  it('a resume past the run browser window reads no flight page and leaves ended window', async () => {
    const { e, id, cam2 } = await interruptedAt(3);
    const end = e.ctx.repos.executions.get(id)?.browserWindowEnd ?? null;
    if (end === null) throw new Error('the run has a browser window');
    e.clock.set(asIsoDateTime(new Date(Date.parse(end) + 60_000).toISOString()));
    const p = restart(e, [cam2]);
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    expect(cam2.flightCalls).toHaveLength(0);
    expect(done.flightLists?.ended).toBe('window');
    expect(flightRows(e, id)).toHaveLength(2);
    await p.orch.shutdown();
  });

  it('a retry-errors resume of a completed run re-reads nothing', async () => {
    const cam = stubCamoufox({
      cells: 15,
      flights: {},
      failTile: 14,
      error: new (await import('@gmt/core')).ProviderError({
        kind: 'upstream',
        retryable: true,
        providerId: 'camoufox',
        message: 'camoufox /v1/page: synthetic upstream',
      }),
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(10) });
    const id = await start(e);
    const first = await e.settled(id);
    expect(first.status).toBe('completed');
    expect(cam.flightCalls).toHaveLength(10);
    const r = await e.orch.resume(id, { manual: true });
    expect(r.ok).toBe(true);
    await e.settled(id);
    expect(cam.flightCalls).toHaveLength(10);
    expect(flightRows(e, id)).toHaveLength(10);
  });

  it('a pass whose preflight disabled camoufox froze no plan: a manual Resume with the worker up reads 10', async () => {
    const cam = stubCamoufox({
      cells: 15,
      flights: {},
      preflights: [
        { ok: false, skip: 'provider_unavailable', detail: 'the worker is not answering' },
        { ok: true },
      ],
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
    const id = await start(e);
    const first = await e.settled(id);
    expect(first.status).toBe('paused_error');
    expect(first.flightLists).toBeNull();
    expect((await e.orch.resume(id, { manual: true })).ok).toBe(true);
    const done = await e.settled(id);
    expect(done.status).toBe('completed');
    expect(cam.calls).toHaveLength(15);
    expect(cam.flightCalls).toHaveLength(10);
    expect(done.flightLists?.planned).toBe(10);
  });

  it('spec rev 56: a pre-WP21 plan (no returns key) resumes outbound-only whatever the worker now reports', async () => {
    const { e, id, cam2, plan } = await interruptedAt(5);
    if (plan === null) throw new Error('a plan was stored');
    const { returns: _r, booking: _b, returnsStopped: _s, bookingStopped: _t, ...older } = plan;
    e.ctx.db.raw
      .prepare('UPDATE search_executions SET flight_lists_json = ? WHERE id = ?')
      .run(JSON.stringify(older), id);
    const p = restart(e, [cam2]);
    p.ctx.workerFlags.set('camoufox', { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true });
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    expect(cam2.flightCalls).toHaveLength(6);
    expect(cam2.flightCalls.every((c) => c.query.returnLimits === undefined)).toBe(true);
    expect(done.flightLists).toMatchObject({ returns: false, booking: false });
    await p.orch.shutdown();
  });

  // why: design 2026-11-08 §4.7: with returns the step is in confirm mode; a crash leaves the pairs it started (with a
  // row) and the counts so far, and the resumed pass rebuilds the queue, keeping the stored returns and booking
  it('spec rev 56: a page cancelled in its return phase writes no row; the resumed pass reads that pair once, with returns', async () => {
    const both = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
    const { e, id, plan } = await interruptedAt(5, {}, both);
    // why: a plan interrupted by a crash still carries its summary: the four pairs read (each unread: the stub's lists
    // hold no return read), the held fifth left out (no page answered)
    expect(plan).toMatchObject({
      returns: true,
      booking: true,
      planned: 4,
      confirm: { mode: 'confirm', confirmed: 0, unread: 4, stop: null },
    });
    expect(plan?.cells).toHaveLength(4);
    // why: 21.6 review I2, the worst case: every request loads its 2 pages (the four before the SIGTERM did too, at their
    // plan) and the cancelled one is ledgered at its planned 2; no pair is refused
    const cam2 = stubCamoufox({ cells: 15, flights: { pagesLoaded: () => 2 } });
    // why: the new process has read no worker yet; the stored plan, not the flags, decides the resumed pass
    const p = restart(e, [cam2]);
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    const queue = rankedCells(e, id);
    expect(cam2.flightCalls.map((c) => c.query.cell)).toEqual(queue.slice(4));
    expect(
      cam2.flightCalls.every((c) => c.query.returnLimits !== undefined && c.query.booking === true),
    ).toBe(true);
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(15);
    expect(rows.filter((r) => r.departureDate === queue[4]?.departureDate)).toHaveLength(1);
    expect(rows.every((r) => r.status === 'read')).toBe(true);
    // why: 15 pairs read, none reused; 11 unread reads after the resume (patience at 0 again) leave the queue empty
    expect(done.flightLists).toMatchObject({
      planned: 15,
      reused: 0,
      returns: true,
      booking: true,
      ended: null,
      confirm: { mode: 'confirm', confirmed: 0, unread: 15, uncheckedCheaper: 0, stop: 'queue-empty' },
    });
    expect(done.flightLists?.cells).toEqual(queue);
    // the month counts all 16 requests at 2 pages (32); the run's flight pages leave out the cancelled one (30)
    expect(
      e.ctx.budget.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls,
    ).toBeGreaterThanOrEqual(32);
    expect(
      e.ctx.budget.usage({ kind: 'provider-execution', executionId: id, providerId: 'camoufox' }).flightLists
        ?.calls,
    ).toBe(30);
    await p.orch.shutdown();
  });
});

/** The cells of the default ranking (`rankedPairs(15)`) over the run's space, in its order. */
function rankedCells(e: CamoufoxEngine, id: string) {
  const run = e.ctx.repos.executions.get(id);
  if (run === null) throw new Error(`no execution ${id}`);
  return rankedPairs(15)({
    definitionId: e.definition.id,
    space: run.snapshot.resolved,
    cabin: 'economy',
    maxJourneyMinutes: null,
    now: e.clock.now(),
  }).map((p) => ({
    origin: p.origin,
    destination: p.destination,
    departureDate: p.departureDate,
    returnDate: p.returnDate,
  }));
}

// Design 2026-11-08 §4.7 (suspend and resume): a confirm-mode step interrupted by the run's window, a cool-down or a
// crash resumes by rebuilding its queue from the calendar; one that finished reads nothing on a later pass.
describe('a resumed confirm-mode step (design 2026-11-08 §4.7)', () => {
  const RETURNS_ONLY = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false };
  const NONE: FlightLimits = {
    maxJourneyMinutes: null,
    maxStops: null,
    departureWindowLocal: null,
    arrivalWindowLocal: null,
  };
  const returnsAt = (fromMinor: number): ReturnRead =>
    returnReadSchema.parse({
      limits: NONE,
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
      booking: null,
    });
  const noOutbound = returnReadSchema.parse({
    limits: NONE,
    status: 'no-outbound',
    rule: null,
    attempts: [],
    triedAll: true,
    booking: null,
  });
  const FIRST = Date.parse('2026-11-02T00:00:00.000Z');
  const placeOf = (q: FlightListQuery) => Math.round((Date.parse(q.cell.departureDate) - FIRST) / 86_400_000);
  /**
   * The same worker for every run: by the pair's place in the ranking, the first and third confirm (each improving), the
   * second fails without ending the step (unread), and every later one has no trip.
   */
  const byPlace = (q: FlightListQuery): FlightListResult => {
    const i = placeOf(q);
    if (i === 1)
      return {
        kind: 'list-error',
        error: new ProviderError({
          kind: 'network',
          retryable: false,
          providerId: 'camoufox',
          message: 'camoufox /v1/flights: synthetic network',
        }),
      };
    const returns = i === 0 ? returnsAt(35_000) : i === 2 ? returnsAt(34_000) : noOutbound;
    return { ...listAnswer(T0), returns: q.returnLimits === undefined ? null : returns };
  };
  function confirming(flights: Omit<FlightStubOptions, 'answer'> = {}) {
    const cam = stubCamoufox({ cells: 15, flights: { ...flights, answer: (q) => byPlace(q) } });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(40) });
    e.ctx.workerFlags.set('camoufox', RETURNS_ONLY);
    return { e, cam };
  }
  const pass = (e: CamoufoxEngine, id: string) => {
    const x = e.ctx.repos.executions.get(id);
    if (x === null) throw new Error(`no execution ${id}`);
    return newRun(e.ctx, x, { manual: false, fresh: false, blocked: new Set() });
  };

  it('interrupted by the window just after an improving read, then resumed: the same cells, reused and summary as an uninterrupted run', async () => {
    const whole = confirming();
    const wholeRun = await whole.e.settled(await start(whole.e));
    expect(wholeRun.flightLists).toMatchObject({
      reused: 0,
      ended: null,
      confirm: { mode: 'confirm', confirmed: 2, unread: 1, uncheckedCheaper: 25, stop: 'patience' },
    });
    let id = '';
    const cut = confirming({
      // why: the window closes as the 4th read starts, just after the improving 3rd: the gate refuses it
      onStart: (n) => {
        if (n !== 4) return;
        const end = cut.e.ctx.repos.executions.get(id)?.browserWindowEnd ?? null;
        if (end !== null) cut.e.clock.set(asIsoDateTime(new Date(Date.parse(end) + 1_000).toISOString()));
      },
    });
    id = await start(cut.e);
    const first = await cut.e.settled(id);
    expect(first.flightLists).toMatchObject({
      ended: 'window',
      confirm: { stop: null, confirmed: 2, unread: 1 },
    });
    expect(first.flightLists?.cells).toHaveLength(3);
    // the window opens again, and a later pass of the run carries on
    cut.e.ctx.repos.executions.patch(id, {
      browserWindowEnd: asIsoDateTime(new Date(Date.parse(cut.e.clock.now()) + 86_400_000).toISOString()),
    });
    await runFlightLists(cut.e.ctx, pass(cut.e, id));
    const resumed = cut.e.ctx.repos.executions.get(id)?.flightLists;
    expect(resumed?.cells).toEqual(wholeRun.flightLists?.cells);
    expect(resumed?.reused).toBe(wholeRun.flightLists?.reused);
    expect(resumed?.confirm).toEqual(wholeRun.flightLists?.confirm);
    expect(resumed?.ended).toBeNull();
    // why: the failed second read has a row of this run: it is a read already made, never sent again
    const second = cut.cam.flightCalls.filter((c) => placeOf(c.query) === 1);
    expect(second).toHaveLength(1);
  }, 15_000);

  it('a step that finished at patience reads nothing on a later pass of the run (as after a verification pause)', async () => {
    const { e, cam } = confirming();
    const done = await e.settled(await start(e));
    expect(done.flightLists?.confirm?.stop).toBe('patience');
    const calls = cam.flightCalls.length;
    await runFlightLists(e.ctx, pass(e, done.id));
    expect(cam.flightCalls).toHaveLength(calls);
    expect(e.ctx.repos.executions.get(done.id)?.flightLists).toEqual(done.flightLists);
  }, 15_000);

  it("a resumed confirm-mode pass refused by the window records ended 'window', though every pair started has a row", async () => {
    const both = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
    const { e, id } = await interruptedAt(3, {}, both);
    const run = pass(e, id);
    laneFor(run, 'discovery', 'camoufox').windowOut = 'outside-browser-window';
    await runFlightLists(e.ctx, run);
    const plan = e.ctx.repos.executions.get(id)?.flightLists;
    expect(plan?.cells).toHaveLength(2);
    expect(flightRows(e, id)).toHaveLength(2);
    expect(plan).toMatchObject({ ended: 'window', confirm: { stop: null } });
  });

  it('a plan stored before the change (fixed cells, no summary, a 20-page snapshot) reads with no summary, resumes by rebuilding the queue, and is never refused', async () => {
    const both = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
    const { e, id } = await interruptedAt(5, {}, both);
    const older = {
      planned: 10,
      cells: rankedCells(e, id).slice(0, 10),
      reused: 0,
      ended: null,
      returns: true,
      booking: true,
      returnsStopped: null,
      bookingStopped: null,
    };
    e.ctx.db.raw
      .prepare('UPDATE search_executions SET flight_lists_json = ? WHERE id = ?')
      .run(JSON.stringify(older), id);
    const before = e.ctx.repos.executions.get(id);
    expect(before?.flightLists?.confirm).toBeNull();
    expect(before?.snapshot.budget.flightListPages).toBe(20);
    const cam2 = stubCamoufox({ cells: 15, flights: {} });
    const p = restart(e, [cam2]);
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    // why: the four pairs read before the SIGTERM are reads already made; the queue's other 11 are read, out and back
    expect(cam2.flightCalls.map((c) => c.query.cell)).toEqual(rankedCells(e, id).slice(4));
    expect(cam2.flightCalls.every((c) => c.query.returnLimits !== undefined)).toBe(true);
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(15);
    expect(rows.some((r) => r.reason === 'execution-cap')).toBe(false);
    expect(done.flightLists).toMatchObject({
      planned: 15,
      reused: 0,
      confirm: { mode: 'confirm', unread: 15, stop: 'queue-empty' },
    });
    await p.orch.shutdown();
  }, 15_000);
});
