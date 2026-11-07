// Spec revision 56 §8.1 "The flight-list step" at its edges: the entry predicate's other refusals, a blocked page with
// and without a cool-down, a guard that states no flight allowance, a page that throws, a ranking that
// starts with a departed pair, the early end a pass leaves (or clears) on its stored plan, the pass's log lines, what the
// run counts as read, and the stops recorded during and after the step. Most cases run one pass of the step directly
// (`runFlightLists` over `newRun`) on a run whose discovery is done, through the real guard and database; concurrency
// and stops are driven by the stub's answers, never by timers.
import {
  asIsoDate,
  asIsoDateTime,
  BudgetExceeded,
  type BudgetGuard,
  cooldownNoticeKey,
  type Execution,
  type FlightLimits,
  type FlightListQuery,
  type FlightListResult,
  type FlightListsState,
  ProviderError,
  returnReadSchema,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorText } from '../../src/errors.js';
import { laneFor, newRun, type RunState } from '../../src/run.js';
import { flightStepEntry, returnsStopOf, runFlightLists } from '../../src/stages/flightLists.js';
import type { RankedDatePair, RankedDatePairsReader } from '../../src/types.js';
import {
  blockedError,
  type CamoufoxEngine,
  engineWith,
  type FlightStubOptions,
  flightRows,
  listAnswer,
  rankedPairs,
  realTime,
  stubCamoufox,
} from '../support/camoufox.js';
import { JFK, LHR } from '../support/harness.js';

beforeEach(realTime);
afterEach(realTime);

const NONE: FlightLimits = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };

async function start(e: CamoufoxEngine): Promise<string> {
  const r = await e.orch.start(e.definition.id, {
    trigger: 'manual',
    confirmCostPence: 1_000_000,
    confirmCalls: 1_000_000,
  });
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r.executionId;
}

function row(e: CamoufoxEngine, id: string): Execution {
  const x = e.ctx.repos.executions.get(id);
  if (x === null) throw new Error(`no execution ${id}`);
  return x;
}

/**
 * A camoufox-only run over 15 cells whose discovery is done and whose own step planned nothing (the ranking was empty
 * then); `ranking` is what a later pass reads (default the 15 cheapest pairs), and `pass()` is a fresh pass over the run.
 */
async function discovered(flights: FlightStubOptions = {}, o: Parameters<typeof engineWith>[1] = {}) {
  let ranking: RankedDatePairsReader = () => [];
  const cam = stubCamoufox({ cells: 15, flights });
  const e = engineWith([cam], { ...o, rankedDatePairs: (q) => ranking(q) });
  const done = await e.settled(await start(e));
  expect(done.flightLists).toBeNull();
  ranking = rankedPairs(15);
  return {
    e,
    cam,
    id: done.id,
    rank: (r: RankedDatePairsReader) => {
      ranking = r;
    },
    pass: (): RunState => newRun(e.ctx, row(e, done.id), { manual: false, fresh: false, blocked: new Set() }),
  };
}

/** A camoufox-only run whose own step read its 10 planned pairs; `pass()` is a fresh pass over it. */
async function stepped() {
  const cam = stubCamoufox({ cells: 15, flights: {} });
  const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
  const done = await e.settled(await start(e));
  const plan = done.flightLists;
  if (plan === null) throw new Error('the step planned');
  expect(flightRows(e, done.id)).toHaveLength(10);
  return {
    e,
    cam,
    id: done.id,
    plan,
    store: (p: FlightListsState) => e.ctx.repos.executions.patch(done.id, { flightLists: p }),
    /** Removes the row of the plan's last cell, so that cell is unread. */
    unreadLast: () => {
      const last = plan.cells[plan.cells.length - 1];
      if (last === undefined) throw new Error('a planned cell');
      e.ctx.db.raw
        .prepare('DELETE FROM flight_lists WHERE execution_id = ? AND departure_date = ?')
        .run(done.id, last.departureDate);
    },
    pass: (): RunState => newRun(e.ctx, row(e, done.id), { manual: false, fresh: false, blocked: new Set() }),
  };
}

/** The guard as it is, except that each usage it reports is passed through `over`. */
function guardWith(
  g: BudgetGuard,
  over: (
    s: Parameters<BudgetGuard['usage']>[0],
    u: ReturnType<BudgetGuard['usage']>,
  ) => ReturnType<BudgetGuard['usage']>,
): BudgetGuard {
  return {
    reserve: (p) => g.reserve(p),
    recordCacheHit: (p) => g.recordCacheHit(p),
    usage: (s) => over(s, g.usage(s)),
    recentCalls: (id, since) => g.recentCalls(id, since),
  };
}

const budgetStop = (providerId: 'camoufox' | 'travelpayouts'): RunState['stop'] => ({
  kind: 'budget',
  error: new BudgetExceeded({
    scope: 'provider-execution',
    providerId,
    cap: 100,
    current: 100,
    requested: 1,
  }),
  resumeAfter: null,
  resetsAt: null,
});

describe('flightStepEntry: the refusals before the plan', () => {
  it('an install with no camoufox registered, a stopped run, or a snapshot without camoufox: no step', async () => {
    const { e, pass } = await discovered();
    const run = pass();
    expect(flightStepEntry(e.ctx, run)).toBe(true);
    expect(flightStepEntry({ ...e.ctx, providers: new Map() }, run)).toBe(false);
    expect(flightStepEntry(e.ctx, { ...run, stop: { kind: 'cancel', cause: { kind: 'cancelled' } } })).toBe(
      false,
    );
    const providers = { ...run.snapshot.providers, discovery: ['travelpayouts' as const] };
    expect(flightStepEntry(e.ctx, { ...run, snapshot: { ...run.snapshot, providers } })).toBe(false);
  });

  // why: spec rev 65: the browser has no page cap, so no budget stop leaves the step to run after it
  it('an allowance of one page is an allowance; a run stopped at any budget cap runs no step', async () => {
    const { e, pass } = await discovered();
    const run = pass();
    const budget = { ...run.snapshot.budget, flightListPages: 1 };
    expect(flightStepEntry(e.ctx, { ...run, snapshot: { ...run.snapshot, budget } })).toBe(true);
    for (const id of ['travelpayouts', 'camoufox'] as const)
      expect(flightStepEntry(e.ctx, { ...run, stop: budgetStop(id) })).toBe(false);
  });
});

describe('one pass of the step, its plan and its pages', () => {
  it('logs its plan, a transient end once and its end, each with the run and the step; sends no fixture recording', async () => {
    const notSettled = returnReadSchema.parse({
      limits: NONE,
      status: 'not-settled',
      rule: 'select-outbound:not-settled',
      attempts: [],
      triedAll: false,
      booking: null,
    });
    const { e, cam, id, pass } = await discovered({
      answer: (q: FlightListQuery, n: number): FlightListResult => ({
        ...listAnswer(asIsoDateTime('2026-10-14T09:00:00.000Z')),
        returns: q.returnLimits === undefined ? null : n === 2 ? notSettled : null,
      }),
    });
    e.ctx.workerFlags.set('camoufox', BOTH);
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.stop).toBeNull();
    expect(cam.flightCalls.every((c) => !c.recordFixtures)).toBe(true);
    const lines = e.logs.filter((l) => l.msg?.startsWith('flight lists:'));
    expect(lines.map((l) => [l.msg, l.fields])).toEqual([
      ['flight lists: planned', { planned: 10, reused: 0, toRead: 10, returns: true, booking: true }],
      [
        'flight lists: a transient end stops the rest of the pass',
        { returnsStopped: 'select-outbound:not-settled', bookingStopped: null },
      ],
      ['flight lists: step done', { read: 10, failed: 0, reused: 0, ended: null }],
    ]);
    for (const l of lines)
      expect(l.bindings).toEqual({
        executionId: id,
        definitionId: e.definition.id,
        providerId: 'camoufox',
        step: 'flight-lists',
      });
  });

  it('a ranking whose first pair departs today plans the 10 after it, none departing today', async () => {
    const today: RankedDatePair = {
      departureDate: asIsoDate('2026-10-14'),
      returnDate: asIsoDate('2026-10-24'),
      origin: LHR,
      destination: JFK,
      pricePence: 39_000,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
    };
    const { e, cam, id, rank, pass } = await discovered();
    rank((q) => [today, ...rankedPairs(15)(q)]);
    await runFlightLists(e.ctx, pass());
    expect(row(e, id).flightLists?.planned).toBe(10);
    expect(cam.flightCalls).toHaveLength(10);
    expect(cam.flightCalls.some((c) => c.query.cell.departureDate === '2026-10-14')).toBe(false);
  });

  it('a ranking with nothing to plan leaves the run as it was: no plan, no stop', async () => {
    const { e, id, rank, pass } = await discovered();
    rank(() => []);
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.stop).toBeNull();
    expect(row(e, id).flightLists).toBeNull();
  });

  it('counts reused pairs as read: 5 reused and 5 read are 10 of 10', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    let ranking: RankedDatePairsReader = rankedPairs(15);
    const e = engineWith([cam], { rankedDatePairs: (q) => ranking(q) });
    await e.settled(await start(e)); // its step reads the 10 cheapest
    ranking = () => [];
    const second = await e.settled(await start(e));
    // why: the first five were read by the first run moments ago; the last five of the 15 never were
    ranking = (q) => {
      const all = rankedPairs(15)(q);
      return [...all.slice(0, 5), ...all.slice(10)];
    };
    const run = newRun(e.ctx, second, { manual: false, fresh: false, blocked: new Set() });
    await runFlightLists(e.ctx, run);
    expect(row(e, second.id).flightLists).toMatchObject({ planned: 10, reused: 5 });
    const plan = row(e, second.id).flightLists;
    if (plan === null) throw new Error('no plan');
    // why: what the step counts as read: the pairs it read and the ones it reused
    expect(e.ctx.repos.flightLists.forExecution(second.id, plan.cells).read + plan.reused).toBe(10);
  });

  it('a guard that states no flight allowance gives none: every pair failed execution-cap before any call', async () => {
    const { e, cam, id, pass } = await discovered();
    const ctx = {
      ...e.ctx,
      budget: guardWith(e.ctx.budget, (s, u) => {
        if (s.kind !== 'provider-execution') return u;
        const { flightLists: _none, ...rest } = u;
        return rest;
      }),
    };
    const run = pass();
    await runFlightLists(ctx, run);
    expect(run.stop).toBeNull();
    expect(cam.flightCalls).toHaveLength(0);
    expect(flightRows(e, id).map((r) => [r.status, r.reason])).toEqual(
      Array(10).fill(['failed', 'execution-cap']),
    );
    expect(row(e, id).flightLists?.ended).toBe('stopped');
  });
});

describe('what a page that throws or is blocked leaves', () => {
  it('a thrown provider error fails its pair with its kind and the step goes on', async () => {
    const { e, id, pass } = await discovered({
      answer: (_q, n) => {
        if (n === 3)
          throw new ProviderError({
            kind: 'parse',
            retryable: false,
            providerId: 'camoufox',
            message: 'synthetic',
          });
        return undefined;
      },
    });
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.stop).toBeNull();
    const rows = flightRows(e, id);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.status === 'failed').map((r) => r.reason)).toEqual(['parse']);
  });

  it('anything else thrown stops the run fatal with its message, logged with the step', async () => {
    const { e, id, pass } = await discovered({
      answer: (_q, n) => {
        if (n === 3) throw new Error('synthetic failure inside the page');
        return undefined;
      },
    });
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.stop).toEqual({ kind: 'fatal', message: 'synthetic failure inside the page' });
    expect(flightRows(e, id)).toHaveLength(2);
    expect(e.logs.filter((l) => l.level === 'error').map((l) => [l.msg, l.fields, l.bindings.step])).toEqual([
      [
        'flight lists: step failed; the run stops',
        { err: 'synthetic failure inside the page' },
        'flight-lists',
      ],
    ]);
  });

  it('a blocked page with a cool-down disables camoufox for the run with that cool-down, notified once per cool-down', async () => {
    const block = blockedError('captcha');
    const until = asIsoDateTime('2026-10-16T09:00:00.000Z');
    expect(block.cooldownUntil).toBe(until);
    const { e, id, pass } = await discovered({
      answer: (_q, n) => (n === 2 ? { kind: 'list-error', error: block } : undefined),
    });
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(flightRows(e, id).map((r) => r.reason)).toEqual([null, ...Array(9).fill('blocked')]);
    expect(run.disabledReason.get('camoufox')).toBe('provider_disabled');
    expect(run.disabledDetail.get('camoufox')).toEqual({
      skip: 'provider_disabled',
      detail: 'blocked',
      until,
    });
    expect(run.notices).toEqual([
      {
        kind: 'provider_disabled',
        detail: `camoufox stopped on a flight-list page: ${errorText(block)}. The rest of this run's flight lists are not read, and it is not called again until the cool-down ends.`,
        key: cooldownNoticeKey('camoufox', until),
      },
    ]);
    expect(e.logs.filter((l) => l.msg === 'provider disabled for the run').map((l) => l.fields)).toEqual([
      { providerId: 'camoufox', why: 'a blocked flight-list page' },
    ]);
  });

  it('a blocked page with no cool-down is notified every time, in its own words', async () => {
    const block = new ProviderError({
      kind: 'blocked',
      retryable: false,
      providerId: 'camoufox',
      message: 'camoufox /v1/flights: synthetic blocked',
    });
    const { e, pass } = await discovered({
      answer: (_q, n) => (n === 2 ? { kind: 'list-error', error: block } : undefined),
    });
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.disabledDetail.get('camoufox')).toEqual({
      skip: 'provider_disabled',
      detail: 'blocked',
      until: null,
    });
    expect(run.notices).toEqual([
      {
        kind: 'provider_disabled',
        detail: `camoufox stopped on a flight-list page: ${errorText(block)}. The rest of this run's flight lists are not read.`,
      },
    ]);
  });
});

describe('a stop during the step (revision 55 §8.1, R-dberror)', () => {
  it('a database failure during the step is the run’s fatal stop', async () => {
    const { e, pass } = await discovered();
    const insert = e.ctx.repos.flightLists.insert.bind(e.ctx.repos.flightLists);
    let n = 0;
    e.ctx.repos.flightLists.insert = (r) => {
      n += 1;
      if (n === 3) throw new Error('SQLITE_IOERR: disk I/O error (synthetic)');
      return insert(r);
    };
    const run = pass();
    await runFlightLists(e.ctx, run);
    expect(run.stop).toEqual({ kind: 'fatal', message: 'SQLITE_IOERR: disk I/O error (synthetic)' });
  });
});

describe('the early end a pass leaves on, or clears from, its stored plan', () => {
  it('a pass that may not run the step for another reason leaves the plan’s end alone, its lane inside the window', async () => {
    const s = await stepped();
    s.unreadLast();
    const run = {
      ...s.pass(),
      stop: { kind: 'cancel' as const, cause: { kind: 'cancelled' as const } },
    };
    laneFor(run, 'discovery', 'camoufox');
    await runFlightLists(s.e.ctx, run);
    expect(row(s.e, s.id).flightLists?.ended).toBeNull();
  });

  it('a lane that left the window marks a plan with an unread cell window, and nothing else', async () => {
    const outside = (s: Awaited<ReturnType<typeof stepped>>) => {
      const run = s.pass();
      laneFor(run, 'discovery', 'camoufox').windowOut = 'outside-browser-window';
      return run;
    };
    // every planned cell read: nothing left by the window
    const all = await stepped();
    await runFlightLists(all.e.ctx, outside(all));
    expect(row(all.e, all.id).flightLists?.ended).toBeNull();
    // an unread cell under an earlier end: the earlier end stands
    const ended = await stepped();
    ended.unreadLast();
    ended.store({ ...ended.plan, ended: 'stopped' });
    await runFlightLists(ended.e.ctx, outside(ended));
    expect(row(ended.e, ended.id).flightLists?.ended).toBe('stopped');
    // an unread cell and no end yet: window
    const left = await stepped();
    left.unreadLast();
    await runFlightLists(left.e.ctx, outside(left));
    expect(row(left.e, left.id).flightLists?.ended).toBe('window');
  });

  it('a pass with nothing left to read keeps the earlier end; one that reads again clears it', async () => {
    const done = await stepped();
    done.store({ ...done.plan, ended: 'window' });
    await runFlightLists(done.e.ctx, done.pass());
    expect(done.cam.flightCalls).toHaveLength(10);
    expect(row(done.e, done.id).flightLists).toEqual({ ...done.plan, ended: 'window' });
    const again = await stepped();
    again.unreadLast();
    again.store({ ...again.plan, ended: 'window' });
    await runFlightLists(again.e.ctx, again.pass());
    expect(again.cam.flightCalls).toHaveLength(11);
    expect(row(again.e, again.id).flightLists).toEqual(again.plan);
  });
});

describe('returnsStopOf', () => {
  const read = (status: string, rule: string | null) =>
    returnReadSchema.parse({ limits: NONE, status, rule, attempts: [], triedAll: false, booking: null });

  it('an unrecognised view stops the phase by its rule, even the spacing rule a read would pass over', () => {
    expect(returnsStopOf(read('unrecognised', 'spacing'))).toBe('spacing');
  });

  it('a skipped, no-outbound or not-verified read stops nothing (null)', () => {
    expect(returnsStopOf(read('skipped', 'not-cheapest-view'))).toBeNull();
    expect(returnsStopOf(read('no-outbound', null))).toBeNull();
    expect(returnsStopOf(read('not-verified', null))).toBeNull();
  });
});
