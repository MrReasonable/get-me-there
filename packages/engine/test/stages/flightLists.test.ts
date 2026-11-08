// Spec revision 55 §8.1 "The flight-list step" (WP20 Task 20.9): after discovery (ruling 20.0 concern 1: before
// verification), camoufox only, the 10 cheapest date pairs on the board, one page each on the step's own allowance,
// behind its own gate and the browser lease; its error table never touches a discovery outcome, the run's status or a
// notice except where the table says so. Stub providers through the real engine, guard and database
// (test/support/camoufox.ts); concurrency is held with deferred promises, never with timers.
import {
  asIsoDateTime,
  type BookingRead,
  BudgetExceeded,
  type FlightLimits,
  type FlightListQuery,
  type FlightListResult,
  ProviderError,
  type ProviderErrorKind,
  type ReturnRead,
  returnReadSchema,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { laneFor, newRun, type RunState } from '../../src/run.js';
import { buildSnapshot, snapshotBudget } from '../../src/snapshot.js';
import { flightStepEntry, readRowOf } from '../../src/stages/flightLists.js';
import type { RankedDatePairsReader } from '../../src/types.js';
import {
  blockedError,
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
} from '../support/camoufox.js';

beforeEach(realTime);
afterEach(realTime);

const listError = (kind: ProviderErrorKind, reason?: string): FlightListResult => ({
  kind: 'list-error',
  error: new ProviderError({
    kind,
    retryable: false,
    providerId: 'camoufox',
    message: `camoufox /v1/flights: synthetic ${kind}`,
    ...(reason === undefined ? {} : { reason }),
  }),
});

/** Starts the definition by hand with a covering confirmation and returns the execution id. */
async function start(e: CamoufoxEngine): Promise<string> {
  const r = await e.orch.start(e.definition.id, {
    trigger: 'manual',
    confirmCostPence: 1_000_000,
    confirmCalls: 1_000_000,
  });
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r.executionId;
}

/** A camoufox-only engine over `cells` one-page cells with a flight capability and a ranking of `ranked` pairs. */
function camoufoxOnly(
  o: { cells?: number; ranked?: number; flights?: FlightStubOptions } & Parameters<typeof engineWith>[1] = {},
) {
  const calls: Array<Parameters<RankedDatePairsReader>[0]> = [];
  const cam = stubCamoufox({ cells: o.cells ?? 15, flights: o.flights ?? {} });
  const e = engineWith([cam], { rankedDatePairs: rankedPairs(o.ranked ?? 15, calls), ...o });
  return { e, cam, calls };
}

describe('the flight-list step after discovery', () => {
  it('reads the 10 cheapest pairs one at a time with the run signal, the gate, the figure cells and airport names', async () => {
    const seenPlan: Array<unknown> = [];
    let id = '';
    const { e, cam, calls } = camoufoxOnly({
      flights: {
        onStart: (n) => {
          if (n === 1) seenPlan.push(e.ctx.repos.executions.get(id)?.flightLists ?? null);
        },
      },
    });
    id = await start(e);
    const done = await e.settled(id);
    expect(done.status).toBe('completed');
    // why: the start's estimate reads the ranking too (the reusable pairs); the step's own read is the last
    expect(calls).toHaveLength(2);
    const ask = calls[calls.length - 1];
    expect(ask?.definitionId).toBe(e.definition.id);
    expect(ask?.space).toEqual(done.snapshot.resolved);
    expect(ask?.cabin).toBe('economy');
    expect(ask?.maxJourneyMinutes).toBeNull();
    expect(cam.flightCalls).toHaveLength(10);
    const ranked = rankedPairs(15)({
      definitionId: e.definition.id,
      space: done.snapshot.resolved,
      cabin: 'economy',
      maxJourneyMinutes: null,
      now: e.clock.now(),
    });
    cam.flightCalls.forEach((c, i) => {
      const p = ranked[i];
      expect(c.query.cell).toEqual({
        origin: p?.origin,
        destination: p?.destination,
        departureDate: p?.departureDate,
        returnDate: p?.returnDate,
      });
      expect(c.query.airportNames).toEqual({
        origin: ['London Heathrow Airport'],
        destination: ['John F Kennedy International Airport'],
        otherOrigins: [],
        otherDestinations: [],
      });
      expect(c.executionId).toBe(id);
      expect(c.signalAborted).toBe(false);
      expect(c.gated).toBe(true);
    });
    // why: the plan is written once, before the first page, and the 10 cells are the selected ones
    // why: spec rev 56 §7: until Task 21.6 plans returns from the worker's flags every plan is outbound-only
    const outboundOnly = { returns: false, booking: false, returnsStopped: null, bookingStopped: null };
    expect(seenPlan).toEqual([
      {
        planned: 10,
        cells: cam.flightCalls.map((c) => c.query.cell),
        reused: 0,
        ended: null,
        ...outboundOnly,
      },
    ]);
    expect(done.flightLists).toEqual({
      planned: 10,
      cells: cam.flightCalls.map((c) => c.query.cell),
      reused: 0,
      ended: null,
      ...outboundOnly,
    });
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === 'read' && r.listed === 'flights' && r.reason === null)).toBe(true);
    expect(e.ctx.repos.flightLists.forExecution(id, done.flightLists?.cells ?? [])).toEqual({
      read: 10,
      failed: 0,
    });
  });

  it('writes no plan when nothing was selected (an empty ranking)', async () => {
    const { e, cam } = camoufoxOnly({ ranked: 0 });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toBeNull();
    expect(cam.flightCalls).toHaveLength(0);
  });

  it('reuses a read list younger than 0.9 × refresh: counted in the 10, no page', async () => {
    const { e, cam } = camoufoxOnly();
    const first = await e.settled(await start(e));
    expect(first.flightLists?.reused).toBe(0);
    // a second run at once: every one of the 10 is reused, none read
    const second = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(10);
    expect(second.flightLists).toEqual({
      planned: 10,
      cells: [],
      reused: 10,
      ended: null,
      returns: false,
      booking: false,
      returnsStopped: null,
      bookingStopped: null,
    });
  });

  // why: spec rev 65: no page cap a run, so a browser run reads every cell before its flight lists
  it('a camoufox + Travelpayouts run reads all 120 cells, then its 10 flight pages, and ends completed', async () => {
    const cam = stubCamoufox({ cells: 120, flights: {} });
    const tp = stubTravelpayouts({ cells: 120 });
    const e = engineWith([cam, tp], { rankedDatePairs: rankedPairs(15) });
    const done = await e.settled(await start(e));
    expect(cam.calls).toHaveLength(120);
    expect(done.status).toBe('completed');
    expect(done.stopCause).toBeNull();
    expect(cam.flightCalls).toHaveLength(10);
  });

  it('a camoufox-only run reads all 120 cells, then its 10 flight pages on an unaborted signal, and completes', async () => {
    const { e, cam } = camoufoxOnly({ cells: 120 });
    const done = await e.settled(await start(e));
    expect(cam.calls).toHaveLength(120);
    expect(done.status).toBe('completed');
    expect(cam.flightCalls).toHaveLength(10);
    expect(cam.flightCalls.every((c) => !c.signalAborted)).toBe(true);
    expect(flightLedger(e, done.id)).toBe(10);
  });

  it('with the 20 flight pages already spent, the next is refused at provider-execution before any call', async () => {
    let id = '';
    const cam = stubCamoufox({ cells: 120, flights: {} });
    // why: the ranking is read as the step starts; seed the allowance's 10 rows for this execution there
    const ranking = rankedPairs(15);
    const seeded = engineWith([cam], {
      rankedDatePairs: (q) => {
        // why: the start's estimate reads the ranking before the run exists; the step reads it once the run is active
        const run = seeded.ctx.repos.executions.activeParent(q.definitionId);
        if (run === null) return ranking(q);
        id = run.id;
        const at = seeded.clock.now();
        const insert = seeded.ctx.db.raw.prepare(
          `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at,
             duration_ms, http_status, outcome, billable, cost_micro_gbp, http_attempt, page_class)
           VALUES ('camoufox', ?, '/v1/flights', NULL, ?, ?, 1, 200, 'ok', 0, 0, 1, 'page')`,
        );
        for (let i = 0; i < 20; i++) insert.run(id, at, at);
        return ranking(q);
      },
    });
    id = await start(seeded);
    const done = await seeded.settled(id);
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightLedger(seeded, id)).toBe(20);
    const rows = flightRows(seeded, id);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === 'failed' && r.reason === 'execution-cap')).toBe(true);
    expect(done.flightLists?.ended).toBe('stopped');
    expect(done.status).toBe('completed');
  });

  it('a Cancel during the step ends the run cancelled', async () => {
    const inFlight = deferred();
    const { e } = camoufoxOnly({
      cells: 120,
      flights: {
        holdCall: { call: 3, until: new Promise(() => undefined) },
        onStart: (n) => n === 3 && inFlight.resolve(),
      },
    });
    const id = await start(e);
    await inFlight.promise;
    expect(await e.orch.cancel(id, { kind: 'cancelled' })).toBe(true);
    const done = await e.settled(id);
    expect(done.status).toBe('cancelled');
    expect(done.stopCause).toEqual({ kind: 'cancelled' });
    // why: an aborted page writes no row, as an aborted tile writes no outcome
    expect(flightRows(e, id)).toHaveLength(2);
  });

  it('a SIGTERM during the step ends the run interrupted', async () => {
    const inFlight = deferred();
    const { e } = camoufoxOnly({
      cells: 120,
      flights: {
        holdCall: { call: 2, until: new Promise(() => undefined) },
        onStart: (n) => n === 2 && inFlight.resolve(),
      },
    });
    const id = await start(e);
    await inFlight.promise;
    await e.orch.shutdown();
    const done = e.ctx.repos.executions.get(id);
    expect(done?.status).toBe('interrupted');
    expect(done?.stopCause).toEqual({ kind: 'interrupted' });
    expect(flightRows(e, id)).toHaveLength(1);
  });

  // why: spec rev 65: the browser's pages count against no per-run call cap; only the flight allowance bounds the step
  it('counts no page toward execution-free-calls: maxFreeCalls 5 after 100 grid pages still reads all 10', async () => {
    const { e, cam } = camoufoxOnly({ cells: 100, maxFreeCalls: 5 });
    const done = await e.settled(await start(e));
    expect(cam.calls).toHaveLength(100);
    expect(cam.flightRequests()).toBe(10);
    expect(flightRows(e, done.id).filter((r) => r.status === 'read')).toHaveLength(10);
    expect(done.flightLists?.ended).toBeNull();
    expect(done.status).toBe('completed');
    expect(e.ctx.budget.usage({ kind: 'execution-free-calls', executionId: done.id }).calls).toBe(0);
  });

  it('a run whose preflight disabled camoufox stores no plan and reads no flights', async () => {
    const cam = stubCamoufox({
      cells: 15,
      flights: {},
      preflight: { ok: false, skip: 'provider_unavailable', detail: 'the worker is not answering' },
    });
    const tp = stubTravelpayouts({ cells: 15 });
    const e = engineWith([cam, tp], { rankedDatePairs: rankedPairs(15) });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toBeNull();
    expect(cam.flightCalls).toHaveLength(0);
  });

  it('a flight capability on a provider other than camoufox is never read', async () => {
    const cam = stubCamoufox({ cells: 15 });
    const tp = stubTravelpayouts({ cells: 15, flights: {} });
    const e = engineWith([cam, tp], { rankedDatePairs: rankedPairs(15) });
    const done = await e.settled(await start(e));
    expect(done.status).toBe('completed');
    expect(tp.flightCalls).toHaveLength(0);
    expect(done.flightLists).toBeNull();
  });
});

describe("the step's error table", () => {
  /** Runs a camoufox-only engine whose 3rd flight page gives `third`; returns the run and the rows. */
  async function thirdPage(
    third: () => FlightListResult | undefined,
    extra: Parameters<typeof engineWith>[1] = {},
  ) {
    let before: string[] = [];
    let id = '';
    const outcomes = (e: CamoufoxEngine) =>
      e.ctx.repos.cells
        .outcomes(id)
        .map((o) => `${o.stage}|${o.departureDate}|${o.status}|${o.reason ?? ''}`);
    const { e, cam } = camoufoxOnly({
      ...extra,
      flights: {
        answer: (_q, n) => {
          if (n === 1) before = outcomes(e);
          // why: the stub's default answer (one flight read) stands for every page but the third
          return n === 3 ? third() : undefined;
        },
      },
    });
    id = await start(e);
    const done = await e.settled(id);
    // why: no flight page ever calls discovery's failure path or marks a cell
    expect(outcomes(e)).toEqual(before);
    return { e, cam, done, rows: flightRows(e, id) };
  }

  it.each([
    ['execution-free-calls', 'free-call-cap', 'stopped'],
    ['provider-execution', 'execution-cap', 'stopped'],
  ] as const)(
    'BudgetExceeded (%s): the pair and the rest failed %s, no request, ended %s',
    async (scope, reason, ended) => {
      const { cam, done, rows } = await thirdPage(() => {
        throw new BudgetExceeded({ scope, providerId: 'camoufox', cap: 10, current: 10, requested: 1 });
      });
      expect(cam.flightCalls).toHaveLength(3);
      expect(rows.map((r) => r.status)).toEqual([...Array(2).fill('read'), ...Array(8).fill('failed')]);
      expect(rows.slice(2).every((r) => r.reason === reason)).toBe(true);
      expect(done.flightLists?.ended).toBe(ended);
      expect(done.status).toBe('completed');
    },
  );

  it.each(['provider-unavailable', 'auth', 'quota'] as const)(
    'list-error %s: the pair and the rest failed with the kind, no request, the step ends',
    async (kind) => {
      const { e, cam, done, rows } = await thirdPage(() => listError(kind));
      expect(cam.flightCalls).toHaveLength(3);
      expect(rows.slice(2).every((r) => r.status === 'failed' && r.reason === kind)).toBe(true);
      expect(rows).toHaveLength(10);
      expect(done.status).toBe('completed');
      expect(e.notifications.filter((n) => n.kind === 'provider_disabled')).toHaveLength(0);
    },
  );

  it('list-error blocked: failed blocked, the rest failed, camoufox disabled with one cool-down notice', async () => {
    const { e, cam, done, rows } = await thirdPage(() => ({
      kind: 'list-error',
      error: blockedError('captcha'),
    }));
    expect(cam.flightCalls).toHaveLength(3);
    expect(rows.slice(2).every((r) => r.status === 'failed' && r.reason === 'blocked')).toBe(true);
    expect(done.status).toBe('completed');
    const notices = e.notifications.filter((n) => n.kind === 'provider_disabled');
    expect(notices).toHaveLength(1);
  });

  it('list-error limiter-timeout: failed limiter-timeout and the rest, never pausing the run', async () => {
    const { cam, done, rows } = await thirdPage(() => listError('limiter-timeout'));
    expect(cam.flightCalls).toHaveLength(3);
    expect(rows.slice(2).every((r) => r.status === 'failed' && r.reason === 'limiter-timeout')).toBe(true);
    expect(done.status).toBe('completed');
    expect(done.resumeAfter).toBeNull();
  });

  it.each(['parse', 'upstream', 'network', 'rate-limit'] as const)(
    'list-error %s: the pair failed with the kind and the step continues',
    async (kind) => {
      const { cam, done, rows } = await thirdPage(() => listError(kind));
      expect(cam.flightCalls).toHaveLength(10);
      expect(rows.filter((r) => r.status === 'failed').map((r) => r.reason)).toEqual([kind]);
      expect(done.status).toBe('completed');
      expect(done.flightLists?.ended).toBeNull();
    },
  );

  it('a parse with the reason no-airport-names stores that word, and the step continues', async () => {
    const { rows } = await thirdPage(() => listError('parse', 'no-airport-names'));
    expect(rows.filter((r) => r.status === 'failed').map((r) => r.reason)).toEqual(['no-airport-names']);
  });

  it("the gate finds the window closed: no row, ended 'window', status unchanged, no notice", async () => {
    let id = '';
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const ranking = rankedPairs(15);
    const e = engineWith([cam], {
      rankedDatePairs: (q) => {
        // why: the step reads the ranking first (the start's estimate, before the run exists, is let through); the clock
        // then stands past the run's browser window
        const end = e.ctx.repos.executions.activeParent(q.definitionId)?.browserWindowEnd ?? null;
        if (end !== null) e.clock.set(asIsoDateTime(new Date(Date.parse(end) + 60_000).toISOString()));
        return ranking(q);
      },
    });
    id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(1);
    expect(cam.flightRequests()).toBe(0);
    expect(flightRows(e, id)).toHaveLength(0);
    expect(done.flightLists?.ended).toBe('window');
    expect(done.status).toBe('completed');
    expect(done.stopCause).toBeNull();
    expect(e.notifications.filter((n) => n.kind === 'browser_window')).toHaveLength(0);
  });
});

describe('the step after the review (Task 20.9 fix round 1)', () => {
  it("R-gate: the clock passes the window end after page 2: no page 3, no row for it or later, ended 'window'", async () => {
    let id = '';
    const cam = stubCamoufox({
      cells: 15,
      flights: {
        // why: the gate re-reads the stored browser window before every page, so a window that ends mid-step stops it
        onStart: (n) => {
          if (n !== 3) return;
          const end = e.ctx.repos.executions.get(id)?.browserWindowEnd ?? null;
          if (end !== null) e.clock.set(asIsoDateTime(new Date(Date.parse(end) + 1_000).toISOString()));
        },
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
    id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightRequests()).toBe(2);
    expect(flightRows(e, id)).toHaveLength(2);
    expect(done.flightLists?.ended).toBe('window');
    expect(done.status).toBe('completed');
  });

  it('R-dberror: a database error inside the step stops the run fatal, with its cause', async () => {
    const { e } = camoufoxOnly();
    const insert = e.ctx.repos.flightLists.insert.bind(e.ctx.repos.flightLists);
    let n = 0;
    e.ctx.repos.flightLists.insert = (row) => {
      n += 1;
      if (n === 3) throw new Error('SQLITE_IOERR: disk I/O error (synthetic)');
      return insert(row);
    };
    const done = await e.settled(await start(e));
    expect(done.status).toBe('paused_error');
    expect(done.stopCause).toEqual({ kind: 'fatal' });
    expect(flightRows(e, done.id)).toHaveLength(2);
  });

  it('a blocked flight page with no cool-down is notified in its own words, not as skipped cells', async () => {
    const { e, cam } = camoufoxOnly({
      flights: { answer: (_q, n) => (n === 2 ? listError('blocked') : undefined) },
    });
    const done = await e.settled(await start(e));
    expect(cam.flightCalls).toHaveLength(2);
    const notices = e.notifications.filter((x) => x.kind === 'provider_disabled');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toContain('flight-list page');
    expect(notices[0]?.body).not.toContain('remaining cells are skipped');
    expect(done.status).toBe('completed');
  });
});

describe('snapshotBudget and the flight allowance (spec rev 56 §2, §8.1, the 20.8 note)', () => {
  it('strips a definition-supplied flightListPages and sets 20 (10 pairs × 2 pages) with camoufox; none without', () => {
    const e = engineWith([stubCamoufox({ cells: 3, flights: {} }), stubTravelpayouts({ cells: 3 })]);
    const own = { ...e.definition.budget, flightListPages: 500 };
    expect(snapshotBudget(own, ['camoufox', 'travelpayouts']).flightListPages).toBe(20);
    expect('flightListPages' in snapshotBudget(own, ['travelpayouts'])).toBe(false);
  });
  // why: spec rev 65: the browser's page cap is withdrawn, so no snapshot carries one, even from a stored budget
  it('carries no providerMaxCalls, dropping one a stored budget holds', () => {
    const e = engineWith([stubCamoufox({ cells: 3 })]);
    const own = { ...e.definition.budget, providerMaxCalls: { camoufox: 4 } };
    expect(snapshotBudget(own, ['camoufox'])).not.toHaveProperty('providerMaxCalls');
  });
});

describe('flightStepEntry (the entry predicate)', () => {
  async function base(o: Parameters<typeof engineWith>[1] = {}, cabin?: 'business') {
    const cam = stubCamoufox({ cells: 3, flights: {}, cabins: ['economy', 'business'] });
    const e = engineWith([cam], {
      rankedDatePairs: rankedPairs(3),
      ...o,
      ...(cabin === undefined ? {} : { cabin }),
    });
    const done = await e.settled(await start(e));
    const run = newRun(e.ctx, done, { manual: false, fresh: false, blocked: new Set() });
    return { e, run };
  }
  const budgetStop = (scope: 'provider-execution' | 'execution-calls'): RunState['stop'] => ({
    kind: 'budget',
    error: new BudgetExceeded({ scope, providerId: 'camoufox', cap: 100, current: 100, requested: 1 }),
    resumeAfter: null,
    resetsAt: null,
  });

  it('runs only when the run has not stopped (spec rev 65: no browser page cap to run after)', async () => {
    const { e, run } = await base();
    expect(flightStepEntry(e.ctx, run)).toBe(true);
    expect(flightStepEntry(e.ctx, { ...run, stop: budgetStop('provider-execution') })).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, stop: budgetStop('execution-calls') })).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, stop: { kind: 'cancel', cause: { kind: 'cancelled' } } })).toBe(
      false,
    );
  });

  it('never on a catch-up, a child, camoufox disabled, a blocked browser line or a snapshot without the allowance', async () => {
    const { e, run } = await base();
    expect(flightStepEntry(e.ctx, { ...run, isCatchUp: true })).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, isChild: true })).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, disabled: new Set(['camoufox']) })).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, blocked: new Set(['discovery:camoufox' as const]) })).toBe(false);
    const { flightListPages: _gone, ...budget } = run.snapshot.budget;
    expect(flightStepEntry(e.ctx, { ...run, snapshot: { ...run.snapshot, budget } })).toBe(false);
  });

  it('never after the browser lane left its window; a lane out for its own allowance still reads', async () => {
    const { e, run } = await base();
    laneFor(run, 'discovery', 'camoufox').budgetOutScope = 'provider-execution';
    expect(flightStepEntry(e.ctx, run)).toBe(true);
    laneFor(run, 'discovery', 'camoufox').windowOut = 'outside-browser-window';
    expect(flightStepEntry(e.ctx, run)).toBe(false);
  });

  it('never for a cabin other than economy, nor without the ranking', async () => {
    const business = await base({}, 'business');
    expect(flightStepEntry(business.e.ctx, business.run)).toBe(false);
    const cam = stubCamoufox({ cells: 3, flights: {} });
    const e = engineWith([cam]);
    const done = await e.settled(await start(e));
    expect(
      flightStepEntry(e.ctx, newRun(e.ctx, done, { manual: false, fresh: false, blocked: new Set() })),
    ).toBe(false);
  });
});

// Spec rev 56 §8.1 "The plan" and "Each request" (WP21 Task 21.6): the return phase is planned from the worker's flags;
// each request carries the search's limits and the booking ask while the plan reads returns, an outbound-only request
// when the window cannot hold one, and none after a transient end; the allowance counts each request's pages.
describe('the step plans and sends the return leg (spec rev 56 §8.1)', () => {
  const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
  const LIMITS: FlightLimits = {
    maxJourneyMinutes: 1500,
    maxStops: 1,
    departureWindowLocal: null,
    arrivalWindowLocal: { from: '06:00', to: '23:00' },
  };
  const NONE: FlightLimits = {
    maxJourneyMinutes: null,
    maxStops: null,
    departureWindowLocal: null,
    arrivalWindowLocal: null,
  };

  /** A return read of the stub's one flight: one return, and the booking read `booking` (null: none asked). */
  function returnsOf(over: Partial<ReturnRead> = {}, booking: Partial<BookingRead> | null = {}): ReturnRead {
    return returnReadSchema.parse({
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
      booking:
        booking === null
          ? null
          : {
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
  }
  const transient = (status: 'select-failed' | 'not-settled' | 'unrecognised', rule: string): ReturnRead =>
    returnReadSchema.parse({ limits: LIMITS, status, rule, attempts: [], triedAll: false, booking: null });
  const answering =
    (returns: (n: number) => ReturnRead | null) =>
    (q: FlightListQuery, n: number): FlightListResult => ({
      ...listAnswer(asIsoDateTime('2026-10-15T09:00:00.000Z')),
      // why: the stub answers a return read only to a request that asked for one, as the worker does
      returns: q.returnLimits === undefined ? null : returns(n),
    });

  /** A camoufox-only engine whose worker reported `flags`, over a definition with `limits`' constraints. */
  function withFlags(
    flags: Record<string, boolean> | null,
    o: { flights?: FlightStubOptions; limits?: boolean } & Parameters<typeof engineWith>[1] = {},
  ) {
    const cam = stubCamoufox({ cells: 15, flights: o.flights ?? {} });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15), ...o });
    if (flags !== null) e.ctx.workerFlags.set('camoufox', flags);
    if (o.limits !== false)
      e.ctx.repos.definitions.update(e.definition.id, {
        constraints: {
          maxJourneyMinutes: 1500,
          maxStops: 1,
          arrivalWindowLocal: { from: '06:00', to: '23:00' },
        },
      });
    return { e, cam };
  }

  it('both flags: the plan reads returns and booking; each request carries the limits and booking true', async () => {
    const { e, cam } = withFlags(BOTH);
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({ returns: true, booking: true, returnsStopped: null });
    expect(cam.flightCalls).toHaveLength(10);
    for (const c of cam.flightCalls) {
      expect(c.query.returnLimits).toEqual(LIMITS);
      expect(c.query.booking).toBe(true);
    }
  });

  it('a snapshot without constraints sends every limit null', async () => {
    const { e, cam } = withFlags(BOTH, { limits: false });
    await e.settled(await start(e));
    expect(cam.flightCalls[0]?.query.returnLimits).toEqual(NONE);
  });

  it('BOOKING_SELECT_VERIFIED false: the plan stores booking false and the request says booking: false', async () => {
    const { e, cam } = withFlags({ RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({ returns: true, booking: false });
    expect(
      cam.flightCalls.every((c) => c.query.booking === false && c.query.returnLimits !== undefined),
    ).toBe(true);
  });

  it('RETURN_SELECT_VERIFIED false or unread: the plan stores returns false and no request carries limits', async () => {
    for (const flags of [null, { RETURN_SELECT_VERIFIED: false, BOOKING_SELECT_VERIFIED: true }]) {
      const { e, cam } = withFlags(flags);
      const done = await e.settled(await start(e));
      expect(done.flightLists).toMatchObject({ returns: false, booking: false });
      expect(cam.flightCalls.every((c) => !('returnLimits' in c.query) && !('booking' in c.query))).toBe(
        true,
      );
    }
  });

  it('a list with returns is stored with them, its booking included; a failed page stores none', async () => {
    const { e } = withFlags(BOTH, {
      flights: {
        answer: (q, n) => (n === 2 ? listError('network') : answering(() => returnsOf())(q, n)),
      },
    });
    const id = await start(e);
    await e.settled(id);
    const lists = e.ctx.repos.flightLists.newestPerCell(e.definition.id, cellsOf(e, id), 'economy', 'GB');
    const [first, second] = cellsOf(e, id).map((c) => lists.find((l) => l.departureDate === c.departureDate));
    expect(first?.returns).toEqual(returnsOf());
    expect(second?.status).toBe('failed');
    expect(second?.returns).toBeNull();
  });

  it('an expand-failed booking stops the booking reads; returns are still read', async () => {
    const { e, cam } = withFlags(BOTH, {
      flights: {
        answer: answering((n) =>
          returnsOf(
            {},
            n === 2 ? { status: 'expand-failed', rule: 'more-options:not-settled', expanded: false } : {},
          ),
        ),
      },
    });
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({
      returnsStopped: null,
      bookingStopped: 'more-options:not-settled',
    });
    expect(cam.flightCalls.map((c) => c.query.booking)).toEqual([true, true, ...Array(8).fill(false)]);
    expect(cam.flightCalls.every((c) => c.query.returnLimits !== undefined)).toBe(true);
  });

  it('Review Focus 2: a not-settled return view stops the return phases of the pass; outbound reads go on', async () => {
    const { e, cam } = withFlags(BOTH, {
      flights: {
        answer: answering((n) =>
          n === 3 ? transient('not-settled', 'select-outbound:not-settled') : returnsOf(),
        ),
      },
    });
    const done = await e.settled(await start(e));
    expect(done.flightLists?.returnsStopped).toBe('select-outbound:not-settled');
    expect(cam.flightCalls.map((c) => c.query.returnLimits !== undefined)).toEqual([
      true,
      true,
      true,
      ...Array(7).fill(false),
    ]);
    expect(flightRows(e, done.id)).toHaveLength(10);
  });

  it('a read whose second attempt ended transiently stops them too; skipped, no-outbound and a clean read do not', async () => {
    const secondFailed = returnsOf({ rule: 'select-outbound:select-failed' });
    const stops = withFlags(BOTH, {
      flights: { answer: answering((n) => (n === 1 ? secondFailed : returnsOf())) },
    });
    expect((await stops.e.settled(await start(stops.e))).flightLists?.returnsStopped).toBe(
      'select-outbound:select-failed',
    );
    const quiet = [
      returnReadSchema.parse({
        limits: LIMITS,
        status: 'skipped',
        rule: 'not-cheapest-view',
        attempts: [],
        triedAll: false,
        booking: null,
      }),
      returnReadSchema.parse({
        limits: LIMITS,
        status: 'no-outbound',
        rule: null,
        attempts: [],
        triedAll: true,
        booking: {
          ...returnsOf().booking,
          status: 'no-pairing',
          attempt: null,
          returnIndex: null,
          offers: [],
          expanded: false,
        },
      }),
      returnsOf({ rule: 'spacing' }),
    ];
    const go = withFlags(BOTH, { flights: { answer: answering((n) => quiet[n - 1] ?? returnsOf()) } });
    const done = await go.e.settled(await start(go.e));
    expect(done.flightLists).toMatchObject({ returnsStopped: null, bookingStopped: null });
    expect(go.cam.flightCalls.every((c) => c.query.returnLimits !== undefined)).toBe(true);
  });

  it.each([
    ['select-failed', 'select-outbound:select-failed'],
    ['not-settled', 'select-outbound:not-settled'],
    ['unrecognised', 'select-outbound:unrecognised'],
  ] as const)('a %s first attempt stops the return phases with its rule', async (status, rule) => {
    const { e, cam } = withFlags(BOTH, {
      flights: { answer: answering((n) => (n === 1 ? transient(status, rule) : returnsOf())) },
    });
    const done = await e.settled(await start(e));
    expect(done.flightLists?.returnsStopped).toBe(rule);
    expect(cam.flightCalls.filter((c) => c.query.returnLimits !== undefined)).toHaveLength(1);
  });

  it('with the return leg planned, a young list whose return view did not settle is read again, not reused', async () => {
    const { e, cam } = withFlags(BOTH);
    const [first] = rankedPairs(1)({
      definitionId: e.definition.id,
      space: buildSnapshot(e.ctx, e.definition).snapshot.resolved,
      cabin: 'economy',
      maxJourneyMinutes: null,
      now: e.clock.now(),
    });
    if (first === undefined) throw new Error('a ranked pair');
    e.ctx.repos.flightLists.insert(
      readRowOf(
        {
          definitionId: e.definition.id,
          executionId: null,
          providerId: 'camoufox',
          sourceKind: 'scraped-self',
          cabin: 'economy',
          origin: first.origin,
          destination: first.destination,
          departureDate: first.departureDate,
          returnDate: first.returnDate,
        },
        { ...listAnswer(e.clock.now()), returns: transient('not-settled', 'select-outbound:not-settled') },
      ),
    );
    const done = await e.settled(await start(e));
    expect(done.flightLists).toMatchObject({ planned: 10, reused: 0 });
    expect(cam.flightCalls).toHaveLength(10);
  });

  // why: spec rev 64: pages already loaded this month never send a request outbound-only
  it('with the month holding many pages the request still carries the limits', async () => {
    const w = withFlags(BOTH);
    for (let i = 0; i < 2000; i++)
      w.e.ctx.budget
        .reserve({
          providerId: 'camoufox',
          executionId: null,
          tileIndex: null,
          costMicroGbp: 0,
          httpAttempt: 1,
          endpointPath: '/v1/page',
        })
        .finalise({ outcome: 'ok', httpStatus: 200, durationMs: 1, pageClass: 'page' });
    await w.e.settled(await start(w.e));
    expect(w.cam.flightCalls[0]?.query.returnLimits).toEqual(LIMITS);
  });

  it("the allowance counts each request's pages: 20 holds 10 pairs at 2; 19 refuses the tenth before any call", async () => {
    const full = withFlags(BOTH);
    const fullId = await start(full.e);
    await full.e.settled(fullId);
    expect(full.cam.flightRequests()).toBe(10);
    expect(
      full.e.ctx.budget.usage({ kind: 'provider-execution', executionId: fullId, providerId: 'camoufox' })
        .flightLists,
    ).toEqual({ calls: 20, cap: 20 });
    let id = '';
    const tight = withFlags(BOTH, {
      flights: {
        // why: once the plan (with returns, over a 20-page allowance) is written, the stored allowance shrinks to 19
        onStart: (n) => {
          if (n !== 1) return;
          tight.e.ctx.db.raw
            .prepare(
              `UPDATE search_executions SET definition_snapshot_json =
                 json_set(definition_snapshot_json, '$.budget.flightListPages', 19) WHERE id = ?`,
            )
            .run(id);
        },
      },
    });
    id = await start(tight.e);
    const done = await tight.e.settled(id);
    expect(tight.cam.flightRequests()).toBe(9);
    const rows = flightRows(tight.e, id);
    expect(rows).toHaveLength(10);
    expect(rows[9]).toMatchObject({ status: 'failed', reason: 'execution-cap' });
    expect(done.flightLists?.ended).toBe('stopped');
  });

  it('an older snapshot (flightListPages 10) plans returns false and reads 10 outbound-only pages', async () => {
    const { e, cam } = withFlags(BOTH, { flightListPages: 10 });
    const id = await start(e);
    const done = await e.settled(id);
    expect(done.flightLists).toMatchObject({ returns: false, booking: false });
    expect(cam.flightRequests()).toBe(10);
    expect(cam.flightCalls.every((c) => c.query.returnLimits === undefined)).toBe(true);
    expect(flightLedger(e, id)).toBe(10);
  });

  /** Sets the run's browser window to end `seconds` after now, as the step reads its plan. */
  function windowAt(e: CamoufoxEngine, seconds: number, then?: () => void): RankedDatePairsReader {
    const ranking = rankedPairs(15);
    return (q) => {
      const run = e.ctx.repos.executions.activeParent(q.definitionId);
      if (run !== null) {
        e.ctx.repos.executions.patch(run.id, {
          browserWindowEnd: asIsoDateTime(new Date(Date.parse(e.clock.now()) + seconds * 1000).toISOString()),
        });
        then?.();
      }
      return ranking(q);
    };
  }

  it('R-window: a window holding 700 s sends outbound-only requests (210 s each), not a 780 s return phase', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e: CamoufoxEngine = engineWith([cam], { rankedDatePairs: (q) => reader(q) });
    const reader = windowAt(e, 700);
    e.ctx.workerFlags.set('camoufox', BOTH);
    const id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(10);
    expect(cam.flightCalls.every((c) => c.query.returnLimits === undefined)).toBe(true);
    expect(flightRows(e, id)).toHaveLength(10);
    expect(done.flightLists).toMatchObject({ returns: true, returnsStopped: null, ended: null });
  });

  it('R-window: a window of exactly 780 s holds one return phase (the gate admits it); 779 s sends outbound-only', async () => {
    for (const [seconds, phase] of [
      [780, true],
      [779, false],
    ] as const) {
      const cam = stubCamoufox({ cells: 15, flights: {} });
      const e: CamoufoxEngine = engineWith([cam], { rankedDatePairs: (q) => reader(q) });
      const reader = windowAt(e, seconds);
      e.ctx.workerFlags.set('camoufox', BOTH);
      const id = await start(e);
      await e.settled(id);
      expect(cam.flightCalls[0]?.query.returnLimits !== undefined).toBe(phase);
      expect(flightRows(e, id).length).toBeGreaterThan(0);
    }
  });

  /** A step whose first request waits on a held lease while the clock moves `advanceMs` on (an on-demand read in flight). */
  async function heldLease(windowSeconds: number, advanceMs: number) {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e: CamoufoxEngine = engineWith([cam], { rankedDatePairs: (q) => reader(q) });
    const held = deferred();
    const reader = windowAt(e, windowSeconds, () => {
      e.ctx.lease.hold(held.promise);
      void Promise.resolve().then(() => {
        e.clock.advance(advanceMs);
        held.resolve();
      });
    });
    e.ctx.workerFlags.set('camoufox', BOTH);
    const id = await start(e);
    return { e, cam, id, done: await e.settled(id) };
  }

  it('R-window (21.6 review M1): the request is shaped after a held lease: 800 s less 100 s waited sends outbound-only', async () => {
    // why: at planning 800 s holds a 780 s return phase; after the wait 700 s holds only an outbound-only read
    const { e, cam, id, done } = await heldLease(800, 100_000);
    expect(cam.flightCalls).toHaveLength(10);
    expect(cam.flightCalls.every((c) => c.query.returnLimits === undefined)).toBe(true);
    expect(flightRows(e, id)).toHaveLength(10);
    expect(done.flightLists).toMatchObject({ returns: true, returnsStopped: null, ended: null });
  });

  it('R-window: a window that holds 50 s after a held lease holds no request; the gate refuses it, ended window', async () => {
    const { e, cam, id, done } = await heldLease(800, 750_000);
    expect(cam.flightCalls).toHaveLength(1);
    expect(cam.flightCalls[0]?.query.returnLimits).toBeUndefined();
    expect(cam.flightRequests()).toBe(0);
    expect(flightRows(e, id)).toHaveLength(0);
    expect(done.flightLists?.ended).toBe('window');
  });

  it("the step's gate asks the heartbeat for a suspension before every flight page (check c)", async () => {
    let flightPhase = false;
    let checks = 0;
    const cam = stubCamoufox({
      cells: 15,
      flights: {
        onStart: () => {
          flightPhase = true;
        },
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
    const check = e.ctx.heartbeat.checkBeforePage.bind(e.ctx.heartbeat);
    e.ctx.heartbeat.checkBeforePage = () => {
      if (flightPhase) checks += 1;
      check();
    };
    const done = await e.settled(await start(e));
    expect(cam.flightRequests()).toBe(10);
    expect(checks).toBe(10);
    expect(done.flightLists?.ended).toBeNull();
  });

  it('21.6 review M11: a run row the gate cannot read refuses the request (fail closed): no page, ended window', async () => {
    let unreadable = false;
    const cam = stubCamoufox({
      cells: 15,
      flights: {
        // why: after the request is shaped (a return phase), the gate's own read of the run's row finds none
        onStart: () => {
          unreadable = true;
        },
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
    const executions = e.ctx.repos.executions;
    const get = executions.get.bind(executions);
    executions.get = (id) => {
      if (!unreadable) return get(id);
      unreadable = false;
      return null;
    };
    e.ctx.workerFlags.set('camoufox', BOTH);
    const id = await start(e);
    const done = await e.settled(id);
    expect(cam.flightCalls).toHaveLength(1);
    expect(cam.flightCalls[0]?.query.returnLimits).toBeDefined();
    expect(cam.flightRequests()).toBe(0);
    expect(flightRows(e, id)).toHaveLength(0);
    expect(done.flightLists?.ended).toBe('window');
    expect(done.status).not.toBe('failed');
  });
});

/** The planned cells of an execution, in the plan's order. */
function cellsOf(e: CamoufoxEngine, id: string) {
  return e.ctx.repos.executions.get(id)?.flightLists?.cells ?? [];
}

describe('flight pages at once (CAMOUFOX_PAGES_AT_ONCE)', () => {
  const atOnce = { env: { CAMOUFOX_PAGES_AT_ONCE: '4' } };

  it('with 4 at once, a page held in flight does not hold the others: all 10 start before it ends', async () => {
    const held = deferred();
    const ends: number[] = [];
    const { e, cam } = camoufoxOnly({
      ...atOnce,
      flights: {
        holdCall: { call: 1, until: held.promise },
        // why: one at a time, page 10 never starts while page 1 is held; 4 at once, the other lanes read the rest
        onStart: (n) => {
          if (n === 10) held.resolve();
        },
        onEnd: (n) => ends.push(n),
      },
    });
    const id = await start(e);
    const done = await e.settled(id);
    expect(done.status).toBe('completed');
    expect(cam.flightCalls).toHaveLength(10);
    expect(ends.at(-1)).toBe(1);
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === 'read')).toBe(true);
    expect(done.flightLists?.ended).toBeNull();
  });

  it('an ending error with a page in flight: that page writes its own read, only the pairs never started fail', async () => {
    const held = deferred();
    const ends: number[] = [];
    const { e, cam } = camoufoxOnly({
      ...atOnce,
      flights: {
        holdCall: { call: 1, until: held.promise },
        answer: (_q, n) => {
          if (n !== 2) return undefined;
          held.resolve();
          return listError('quota');
        },
        onEnd: (n) => ends.push(n),
      },
    });
    const id = await start(e);
    const done = await e.settled(id);
    expect(done.status).toBe('completed');
    // why: page 1 was in flight when page 2 ended the step, and ended after it
    expect(ends.indexOf(1)).toBeGreaterThan(ends.indexOf(2));
    const called = cam.flightCalls.map((c) => JSON.stringify(c.query.cell));
    expect(called.length).toBeGreaterThanOrEqual(2);
    expect(called.length).toBeLessThan(10);
    const plan = done.flightLists?.cells ?? [];
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    // why: each planned pair departs on its own day, so the departure date names its row
    const rowOf = (cell: (typeof plan)[number]) => rows.find((r) => r.departureDate === cell.departureDate);
    plan.forEach((cell) => {
      const i = called.indexOf(JSON.stringify(cell));
      const row = rowOf(cell);
      if (i === 1) expect([row?.status, row?.reason]).toEqual(['failed', 'quota']);
      else if (i >= 0) expect([row?.status, row?.reason]).toEqual(['read', null]);
      else expect([row?.status, row?.reason]).toEqual(['failed', 'quota']);
    });
  });
});
