// Spec revision 55 §8.1 "The flight-list step" (WP20 Task 20.9): after discovery (ruling 20.0 concern 1: before
// verification), camoufox only, the 10 cheapest date pairs on the board, one page each on the step's own allowance,
// behind its own gate and the browser lease; its error table never touches a discovery outcome, the run's status or a
// notice except where the table says so. Stub providers through the real engine, guard and database
// (test/support/camoufox.ts); concurrency is held with deferred promises, never with timers.
import {
  apiContract,
  asIsoDateTime,
  BudgetExceeded,
  type FlightListResult,
  ProviderError,
  type ProviderErrorKind,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { laneFor, newRun, type RunState } from '../../src/run.js';
import { snapshotBudget } from '../../src/snapshot.js';
import { flightStepEntry } from '../../src/stages/flightLists.js';
import type { RankedDatePairsReader } from '../../src/types.js';
import {
  blockedError,
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

  it('a camoufox + Travelpayouts run whose browser lane hit its page cap still reads 10 and ends completed', async () => {
    const cam = stubCamoufox({ cells: 120, flights: {} });
    const tp = stubTravelpayouts({ cells: 120 });
    const e = engineWith([cam, tp], { rankedDatePairs: rankedPairs(15) });
    const done = await e.settled(await start(e));
    // why: the stub records the 101st tile too, which the guard's reservation refused at provider-execution
    expect(cam.calls).toHaveLength(101);
    expect(done.status).toBe('completed');
    expect(done.stopCause).toBeNull();
    expect(cam.flightCalls).toHaveLength(10);
  });

  it('the same lane stopped at its monthly page cap sends no flight page', async () => {
    const cam = stubCamoufox({ cells: 120, flights: {} });
    const tp = stubTravelpayouts({ cells: 120 });
    // why: the estimate plans the configured 100 pages, under the 110 monthly cap; the snapshot freezes 200, so the
    // guard stops the lane at its 111th page on the month (provider-month), mid-run, with Travelpayouts left
    const e = engineWith([cam, tp], { rankedDatePairs: rankedPairs(15), monthlyCap: 110, snapshotCap: 200 });
    const done = await e.settled(await start(e));
    expect(cam.calls.length).toBeGreaterThan(100);
    expect(done.status).toBe('completed');
    expect(cam.flightCalls).toHaveLength(0);
    expect(done.flightLists).toBeNull();
  });

  it('Review Focus 3: a camoufox-only run stopped at its 100-page cap reads its 10 flight pages and stays paused_budget', async () => {
    const { e, cam } = camoufoxOnly({ cells: 120 });
    const done = await e.settled(await start(e));
    // why: 100 grid pages, then the 101st refused by the guard at provider-execution (the stub records the attempt)
    expect(cam.calls).toHaveLength(101);
    expect(done.status).toBe('paused_budget');
    expect(cam.flightCalls).toHaveLength(10);
    // why: after the budget stop the run's intake and the lane's are aborted; the step's pages carry the run's
    // controller signal only, which a budget stop never aborts
    expect(cam.flightCalls.every((c) => !c.signalAborted)).toBe(true);
    expect(done.stopCause).toMatchObject({
      kind: 'budget',
      scope: 'provider-execution',
      providerId: 'camoufox',
      flights: { read: 10, planned: 10 },
    });
    expect(apiContract.stopCauseSchema.parse(done.stopCause)).toBeTruthy();
    expect(flightLedger(e, done.id)).toBe(10);
  });

  it('with the 10 flight pages already spent, the next is refused at provider-execution before any call', async () => {
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
        for (let i = 0; i < 10; i++) insert.run(id, at, at);
        return ranking(q);
      },
    });
    id = await start(seeded);
    const done = await seeded.settled(id);
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightLedger(seeded, id)).toBe(10);
    const rows = flightRows(seeded, id);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === 'failed' && r.reason === 'execution-cap')).toBe(true);
    expect(done.flightLists?.ended).toBe('stopped');
    expect(done.status).toBe('paused_budget');
  });

  it('a Cancel during the step after the grid-cap stop ends the run cancelled', async () => {
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

  it('a SIGTERM during the step after the grid-cap stop ends the run interrupted', async () => {
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

  it('counts its pages toward execution-free-calls: 105 after 100 grid pages lets 5 through, then free-call-cap', async () => {
    const { e, cam } = camoufoxOnly({ cells: 100, maxFreeCalls: 105 });
    const done = await e.settled(await start(e));
    expect(cam.calls).toHaveLength(100);
    expect(cam.flightRequests()).toBe(5);
    const rows = flightRows(e, done.id);
    expect(rows.filter((r) => r.status === 'read')).toHaveLength(5);
    expect(rows.filter((r) => r.reason === 'free-call-cap')).toHaveLength(5);
    expect(done.flightLists?.ended).toBe('stopped');
    expect(done.status).toBe('completed');
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
    ['the worker monthly cap', 'monthly-cap', 'monthly-cap'],
    ['execution-free-calls', 'free-call-cap', 'stopped'],
    ['provider-execution', 'execution-cap', 'stopped'],
  ] as const)(
    'BudgetExceeded (%s): the pair and the rest failed %s, no request, ended %s',
    async (_n, reason, ended) => {
      const scope =
        reason === 'monthly-cap'
          ? 'provider-month'
          : reason === 'free-call-cap'
            ? 'execution-free-calls'
            : 'provider-execution';
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

  it('the guard-side monthly page cap: failed monthly-cap, ended monthly-cap', async () => {
    // why: 15 grid pages and 2 flight pages fill a 17-page month; the third flight page's reservation is refused
    const { cam, done, rows } = await thirdPage(() => undefined, { monthlyCap: 17 });
    expect(cam.flightRequests()).toBe(2);
    expect(rows.slice(2).every((r) => r.status === 'failed' && r.reason === 'monthly-cap')).toBe(true);
    expect(done.flightLists?.ended).toBe('monthly-cap');
  });

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

  it.each([
    ['a SIGTERM', 'interrupted', { kind: 'interrupted' }],
    ['a Cancel', 'cancelled', { kind: 'cancelled' }],
  ] as const)(
    '%s after the grid-cap stop and before the step starts ends the run %s and the step writes no plan',
    async (_name, status, cause) => {
      const { e, cam } = camoufoxOnly({ cells: 120 });
      const write = e.ctx.repos.cells.setOutcomesForProvider.bind(e.ctx.repos.cells);
      let fired = false;
      // why: the lane's settle marks its remaining cells skipped:budget once its pool drains, after the budget stop and
      // before the flight-list step: the stop arrives there
      e.ctx.repos.cells.setOutcomesForProvider = (executionId, stage, providerId, from, to) => {
        const n = write(executionId, stage, providerId, from, to);
        if (!fired && providerId === 'camoufox' && to.status === 'skipped' && to.reason === 'budget') {
          fired = true;
          if (status === 'interrupted') void e.orch.shutdown();
          else void e.orch.cancel(executionId, { kind: 'cancelled' });
        }
        return n;
      };
      const id = await start(e);
      const done = await e.settled(id);
      expect(fired).toBe(true);
      expect(done.status).toBe(status);
      expect(done.stopCause).toEqual(cause);
      expect(done.flightLists).toBeNull();
      expect(cam.flightCalls).toHaveLength(0);
    },
  );
  it('a fatal after the grid-cap stop and before the step starts is not taken as the flight stop: the run keeps the budget stop (final review ruling)', async () => {
    const { e, cam } = camoufoxOnly({ cells: 120 });
    const write = e.ctx.repos.cells.setOutcomesForProvider.bind(e.ctx.repos.cells);
    let fired = false;
    // why: the same point as above (the lane's settle, after the budget stop and before the step), where the database
    // now fails: the error escapes discovery and execute stops the pass fatal
    e.ctx.repos.cells.setOutcomesForProvider = (executionId, stage, providerId, from, to) => {
      const n = write(executionId, stage, providerId, from, to);
      if (!fired && providerId === 'camoufox' && to.status === 'skipped' && to.reason === 'budget') {
        fired = true;
        throw new Error('SQLITE_IOERR: disk I/O error (synthetic)');
      }
      return n;
    };
    const done = await e.settled(await start(e));
    expect(fired).toBe(true);
    expect(done.status).toBe('paused_budget');
    expect(done.stopCause).toMatchObject({
      kind: 'budget',
      scope: 'provider-execution',
      providerId: 'camoufox',
    });
    expect(done.flightLists).toBeNull();
    expect(cam.flightCalls).toHaveLength(0);
  });
});

describe('snapshotBudget and the flight allowance (spec rev 55 §8.1, the 20.8 note)', () => {
  it('strips a definition-supplied flightListPages and sets 10 with camoufox in discovery; none without', () => {
    const e = engineWith([stubCamoufox({ cells: 3, flights: {} }), stubTravelpayouts({ cells: 3 })]);
    const own = { ...e.definition.budget, flightListPages: 500 };
    expect(snapshotBudget(e.ctx, own, ['camoufox', 'travelpayouts']).flightListPages).toBe(10);
    expect('flightListPages' in snapshotBudget(e.ctx, own, ['travelpayouts'])).toBe(false);
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

  it('runs when the run has not stopped, or its only stop is camoufox own page cap', async () => {
    const { e, run } = await base();
    expect(flightStepEntry(e.ctx, run)).toBe(true);
    expect(flightStepEntry(e.ctx, { ...run, stop: budgetStop('provider-execution') })).toBe(true);
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

  it('never after the browser lane left its window or stopped at a monthly, lifetime or global cap', async () => {
    for (const scope of ['provider-month', 'provider-lifetime', 'global-month'] as const) {
      const { e, run } = await base();
      laneFor(run, 'discovery', 'camoufox').budgetOutScope = scope;
      expect(flightStepEntry(e.ctx, run)).toBe(false);
    }
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
