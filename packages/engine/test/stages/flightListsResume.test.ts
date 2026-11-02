// Spec revision 55 §8.1 "The flight-list step", resumed passes: a resumed pass keeps `planned` and `cells`, reads only
// planned cells with no row of this execution, skips (no row) one that has since departed, never writes a pair twice;
// a retry-errors resume of a completed run re-reads nothing; a resume past the run's browser window reads no flight
// page and leaves `ended 'window'`; a pass whose preflight disabled camoufox froze no plan, so a manual Resume reads 10.
// Spec rev 56 §8.1: a resumed pass keeps the plan's `returns` and `booking` (a plan stored before WP21 reads as
// outbound-only), and a page cancelled during its return phase writes no row and is read once by the resumed pass.
import { apiContract, asIsoDateTime } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import {
  type CamoufoxEngine,
  deferred,
  engineWith,
  flightLedger,
  flightRows,
  rankedPairs,
  realTime,
  type Stub,
  stubCamoufox,
} from '../support/camoufox.js';

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

  it('spec rev 56: a page cancelled in its return phase writes no row; the resumed pass reads that pair once, with returns', async () => {
    const both = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
    const { e, id, plan } = await interruptedAt(5, {}, both);
    expect(plan).toMatchObject({ returns: true, booking: true });
    // why: 21.6 review I2, the worst case: every request loads its 2 pages (the four before the SIGTERM did too, at their
    // plan) and the cancelled one is ledgered at its planned 2; the tenth pair is still read, never refused
    const cam2 = stubCamoufox({ cells: 15, flights: { pagesLoaded: () => 2 } });
    // why: the new process has read no worker yet; the stored plan, not the flags, decides the resumed pass
    const p = restart(e, [cam2]);
    expect((await p.orch.resume(id, { manual: false })).ok).toBe(true);
    const done = await e.settled(id);
    expect(cam2.flightCalls.map((c) => c.query.cell)).toEqual(plan?.cells.slice(4));
    expect(
      cam2.flightCalls.every((c) => c.query.returnLimits !== undefined && c.query.booking === true),
    ).toBe(true);
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.departureDate === plan?.cells[4]?.departureDate)).toHaveLength(1);
    expect(rows.every((r) => r.status === 'read')).toBe(true);
    expect(rows.some((r) => r.reason === 'execution-cap')).toBe(false);
    expect(done.flightLists).toEqual(plan);
    // the month counts all 11 requests at 2 pages (22); the run's flight allowance leaves out the cancelled one (20)
    expect(
      e.ctx.budget.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls,
    ).toBeGreaterThanOrEqual(22);
    expect(
      e.ctx.budget.usage({ kind: 'provider-execution', executionId: id, providerId: 'camoufox' }).flightLists
        ?.calls,
    ).toBe(20);
    await p.orch.shutdown();
  });
});
