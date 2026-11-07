import {
  AbortedError,
  asIsoDate,
  type DefinitionSnapshot,
  type Estimate,
  type FlightProvider,
  type ItineraryQuery,
  ProviderError,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import {
  addPass,
  askedPairs,
  confirmationOf,
  estimateRemainingFor,
  estimateStart,
  flightWindowMarginSeconds,
  withBlocked,
} from '../src/estimate.js';
import { lineKey } from '../src/lines.js';
import { buildSnapshot } from '../src/snapshot.js';
import type { RankedDatePair } from '../src/types.js';
import {
  blockedError,
  type CamoufoxEngine,
  engineWith,
  rankedPairs,
  type Stub,
  stubCamoufox,
  stubSearchApiVerification,
  stubTravelpayouts,
} from './support/camoufox.js';
import {
  baseDefinition,
  createHarness,
  discoveryOf,
  T0,
  verificationOf,
  withVerification,
} from './support/harness.js';

// The estimate's figures and words line by line (spec §8.1 "Estimate"; rev 56 §8.1 for the flight line): each test
// states the whole of what the operator is shown, so a changed figure, a missing or extra assumption, or a line from
// the wrong provider shows up as a difference.

const SEARCHAPI_ENV = { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' };
const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
const RETRY_NOTE = 'every call count includes the retry factor 1.2';
const NO_RETRY_NOTE = 'camoufox never retries: its pages, scrolls and seconds carry no retry factor';
const WORST_CASE_NOTE = 'every cell is planned: no reuse of earlier prices is assumed';
const BLOCKED_NOTE = 'totals leave out the provider lines a budget cap blocks';

/** The start-time estimate of an engine's own definition, over its snapshot (optionally changed) and cells. */
function startOf(
  e: CamoufoxEngine,
  o: { saved?: boolean; snapshot?: (s: DefinitionSnapshot) => DefinitionSnapshot } = {},
): Estimate {
  const b = buildSnapshot(e.ctx, e.definition);
  const snapshot = o.snapshot === undefined ? b.snapshot : o.snapshot(b.snapshot);
  return estimateStart(e.ctx, snapshot, b.cells, o.saved === true ? e.definition.id : null);
}

/** A snapshot whose flight allowance is `pages` (an older snapshot's 10, or none). */
const withFlightPages =
  (pages: number) =>
  (s: DefinitionSnapshot): DefinitionSnapshot => ({ ...s, budget: { ...s.budget, flightListPages: pages } });

/** A camoufox engine with a flight-list capability over `cells` one-page cells, the board ranking 15 date pairs. */
function flightEngine(
  cells: number,
  flags: Record<string, boolean> | null,
  o: Parameters<typeof engineWith>[1] = {},
): CamoufoxEngine {
  const e = engineWith([stubCamoufox({ cells, flights: {} })], { rankedDatePairs: rankedPairs(15), ...o });
  if (flags !== null) e.ctx.workerFlags.set('camoufox', flags);
  return e;
}

/** A SearchApi verification stub whose per-cell estimate carries `notes`. */
function searchApiWithNotes(notes: string[]): Stub {
  const s = stubSearchApiVerification();
  const v = s.verification;
  if (v === undefined) throw new Error('the SearchApi stub verifies');
  return {
    ...s,
    verification: { ...v, estimate: () => ({ calls: 5, costMicroGbp: 0, seconds: 10, notes }) },
  };
}

describe('the discovery line waits for the slowest of the minute window, the hour window and the pool', () => {
  const tpEstimate = (cells: number, env: Record<string, string>) =>
    startOf(engineWith([stubTravelpayouts({ cells })], { env }));

  it('10 calls at 5 an hour wait out one hour (3,600 s, 4,320 s with the factor) and name the hourly window', () => {
    expect(
      tpEstimate(10, {
        TRAVELPAYOUTS_RATE_PER_HOUR: '5',
        TRAVELPAYOUTS_RATE_PER_MINUTE: '600',
        TRAVELPAYOUTS_CONCURRENCY: '1',
      }),
    ).toEqual({
      cells: 10,
      perProvider: [
        {
          providerId: 'travelpayouts',
          stage: 'discovery',
          calls: 12,
          planCalls: 10,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 4320,
          blocked: null,
        },
      ],
      totalCalls: 12,
      totalPlanCalls: 10,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
      seconds: 4320,
      assumptions: [
        RETRY_NOTE,
        'travelpayouts: 10 discovery tiles planned; a tile that pages spends one call a page',
        'travelpayouts: 10 calls exceed its 5 an hour, so the hourly window sets the time',
        WORST_CASE_NOTE,
      ],
      windowClamped: false,
      retryFactor: 1.2,
    });
  });

  it('the minute window: 10 calls at 2 a minute take 300 s (360 s), with no hourly note', () => {
    const est = tpEstimate(10, { TRAVELPAYOUTS_RATE_PER_MINUTE: '2' });
    expect(est.perProvider[0]?.seconds).toBe(360);
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      'travelpayouts: 10 discovery tiles planned; a tile that pages spends one call a page',
      WORST_CASE_NOTE,
    ]);
  });

  it('the pool: 15 one-second calls over 4 at a time take 4 s (5 s)', () => {
    expect(tpEstimate(15, { TRAVELPAYOUTS_RATE_PER_MINUTE: '6000' }).perProvider[0]?.seconds).toBe(5);
  });

  it('an hourly window that only ties the minute window (3,600 s each) is not named', () => {
    const est = tpEstimate(60, {
      TRAVELPAYOUTS_RATE_PER_HOUR: '50',
      TRAVELPAYOUTS_RATE_PER_MINUTE: '1',
    });
    expect(est.perProvider[0]?.seconds).toBe(4320);
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      'travelpayouts: 60 discovery tiles planned; a tile that pages spends one call a page',
      WORST_CASE_NOTE,
    ]);
  });
});

describe('an estimate over several providers', () => {
  it('camoufox, Travelpayouts and SearchApi: each line, its words, and a flight line that just fits the free calls', () => {
    // why: the free calls (43) less the free lines (15 camoufox + 18 Travelpayouts; SearchApi is billed) leave 10
    // requests, one a pair. No cap binds.
    const e = engineWith(
      [
        stubCamoufox({ cells: 15, flights: {} }),
        stubTravelpayouts({ cells: 15 }),
        stubSearchApiVerification(),
      ],
      {
        env: SEARCHAPI_ENV,
        verification: ['searchapi'],
        rankedDatePairs: rankedPairs(15),
        maxFreeCalls: 43,
      },
    );
    e.ctx.workerFlags.set('camoufox', BOTH);
    expect(startOf(e)).toEqual({
      cells: 15,
      perProvider: [
        {
          providerId: 'camoufox',
          stage: 'discovery',
          calls: 15,
          planCalls: 15,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 1050,
          blocked: null,
        },
        {
          providerId: 'travelpayouts',
          stage: 'discovery',
          calls: 18,
          planCalls: 15,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 6,
          blocked: null,
        },
        {
          providerId: 'searchapi',
          stage: 'verification',
          calls: 12,
          planCalls: 10,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 72,
          blocked: null,
        },
      ],
      totalCalls: 45,
      totalPlanCalls: 40,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
      seconds: 1050 + 6 + 72 + 2450,
      assumptions: [
        RETRY_NOTE,
        NO_RETRY_NOTE,
        'camoufox: 15 discovery tiles planned; a tile that pages spends one call a page',
        'travelpayouts: 15 discovery tiles planned; a tile that pages spends one call a page',
        'searchapi: verification of up to 2 cells at 5 calls each',
        WORST_CASE_NOTE,
        '+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at most 20 pages and 50 minutes',
      ],
      windowClamped: false,
      retryFactor: 1.2,
      flightLists: { pairs: 10, pages: 15, seconds: 2450, pagesMax: 20, secondsMax: 3000, returns: true },
    });
  });

  it("a verification estimate's own notes follow its line, joined by semicolons", () => {
    const e = engineWith(
      [stubTravelpayouts({ cells: 3 }), searchApiWithNotes(['two steps', 'one expansion'])],
      {
        env: SEARCHAPI_ENV,
        verification: ['searchapi'],
      },
    );
    expect(startOf(e).assumptions).toContain(
      'searchapi: verification of up to 2 cells at 5 calls each (two steps; one expansion)',
    );
  });

  it('a provider that does not sell the cabin plans no call in either stage, and discovery says why', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 }), stubSearchApiVerification()], {
      env: SEARCHAPI_ENV,
      verification: ['searchapi'],
      cabin: 'business',
    });
    const zero = { calls: 0, planCalls: 0, costMicroGbp: 0, costPence: 0, seconds: 0, blocked: null };
    expect(startOf(e)).toEqual({
      cells: 3,
      perProvider: [
        { providerId: 'travelpayouts', stage: 'discovery', ...zero },
        { providerId: 'searchapi', stage: 'verification', ...zero },
      ],
      totalCalls: 0,
      totalPlanCalls: 0,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
      seconds: 0,
      assumptions: [
        RETRY_NOTE,
        'travelpayouts: does not offer business; no calls (cabin-not-offered)',
        WORST_CASE_NOTE,
      ],
      windowClamped: false,
      retryFactor: 1.2,
    });
  });

  it('a provider named in the snapshot that is not registered, or has no such capability, adds no line and no date pair', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 }), stubSearchApiVerification()], {
      env: SEARCHAPI_ENV,
      verification: ['searchapi'],
    });
    const b = buildSnapshot(e.ctx, e.definition);
    // why: camoufox is configured but not registered here; SearchApi only verifies and Travelpayouts only discovers
    const odd: DefinitionSnapshot = {
      ...b.snapshot,
      providers: {
        ...b.snapshot.providers,
        discovery: ['searchapi', 'camoufox', 'travelpayouts'],
        verification: ['travelpayouts', 'camoufox', 'searchapi'],
      },
    };
    expect(estimateStart(e.ctx, odd, b.cells, null)).toEqual(estimateStart(e.ctx, b.snapshot, b.cells, null));
    expect(askedPairs(e.ctx, odd, b.cells, null, new Set())).toEqual({
      datePairs: 3,
      datePairsCovered: 3,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
  });

  it('a page cap on a provider with no page spacing neither cuts its line nor the date pairs it asks', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 })]);
    const b = buildSnapshot(e.ctx, e.definition);
    const capped: DefinitionSnapshot = {
      ...b.snapshot,
      budget: { ...b.snapshot.budget, providerMaxCalls: { travelpayouts: 1 } },
    };
    expect(estimateStart(e.ctx, capped, b.cells, null)).toEqual(
      estimateStart(e.ctx, b.snapshot, b.cells, null),
    );
    expect(askedPairs(e.ctx, capped, b.cells, null, new Set()).datePairsCovered).toBe(3);
  });

  // why: spec rev 65: a run stored earlier may carry the withdrawn page cap; it neither cuts the line nor its date pairs
  it('a camoufox snapshot carrying the withdrawn page cap plans as one without: every cell, a paced line, no retry factor', () => {
    const e = engineWith([stubCamoufox({ cells: 15 })]);
    const b = buildSnapshot(e.ctx, e.definition);
    const capped: DefinitionSnapshot = {
      ...b.snapshot,
      budget: { ...b.snapshot.budget, providerMaxCalls: { camoufox: 1 } },
    };
    const est = estimateStart(e.ctx, capped, b.cells, null);
    expect(est).toEqual(estimateStart(e.ctx, b.snapshot, b.cells, null));
    // why: 15 pages at the 30 s spacing + 40 s, never multiplied by the retry factor (ruling 13)
    expect(est.perProvider).toEqual([
      {
        providerId: 'camoufox',
        stage: 'discovery',
        calls: 15,
        planCalls: 15,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 1050,
        blocked: null,
      },
    ]);
    expect(askedPairs(e.ctx, capped, b.cells, null, new Set()).datePairsCovered).toBe(15);
  });

  it('a clamped window and a saved search are said so: no worst-case note, the clamp named', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 })]);
    const est = startOf(e, { saved: true, snapshot: (s) => ({ ...s, windowClamped: true }) });
    expect(est.windowClamped).toBe(true);
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      'travelpayouts: 3 discovery tiles planned; a tile that pages spends one call a page',
      'window clamped to start tomorrow',
    ]);
  });

  it('a saved search whose cells are all reusable plans no page or tile and says only that they are reused', async () => {
    const e = engineWith([stubCamoufox({ cells: 15 }), stubTravelpayouts({ cells: 15 })]);
    await e.runToEnd();
    const b = buildSnapshot(e.ctx, e.definition);
    const keep = new Map();
    const est = estimateStart(e.ctx, b.snapshot, b.cells, e.definition.id, keep);
    expect(est.perProvider.map((p) => [p.providerId, p.calls, p.seconds])).toEqual([
      ['camoufox', 0, 0],
      ['travelpayouts', 0, 0],
    ]);
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      NO_RETRY_NOTE,
      'camoufox: 15 cells reuse earlier prices and are not planned',
      'travelpayouts: 15 cells reuse earlier prices and are not planned',
    ]);
    // why: only a plan over every cell is kept for the date pairs it asks about; this one reused them all
    expect([...keep.keys()]).toEqual([]);
  });
});

describe('the camoufox grid line (spec §2 rev 34)', () => {
  /** camoufox over `cells` one-page cells whose every page states 60 s and 1 scroll. */
  function gridEngine(cells: number, env: Record<string, string> = {}) {
    const base = stubCamoufox({ cells });
    const cam: Stub = {
      ...base,
      discovery: { ...discoveryOf(base), estimateTile: () => ({ seconds: 60, scrolls: 1 }) },
    };
    return engineWith([cam], { env: { STUCK_AFTER_HOURS: '1', ...env } });
  }

  it('60 pages of 60 s: one hour exactly, which is not past STUCK_AFTER_HOURS (1 h), with no retry factor', () => {
    expect(startOf(gridEngine(60))).toEqual({
      cells: 60,
      perProvider: [
        {
          providerId: 'camoufox',
          stage: 'discovery',
          calls: 60,
          planCalls: 60,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 3600,
          blocked: null,
          scrolls: 60,
        },
      ],
      totalCalls: 60,
      totalPlanCalls: 60,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
      seconds: 3600,
      assumptions: [
        RETRY_NOTE,
        NO_RETRY_NOTE,
        'camoufox: 60 discovery tiles planned; a tile that pages spends one call a page',
        'camoufox grid mode reads 60 cells in 60 pages and 60 scrolls',
        WORST_CASE_NOTE,
      ],
      windowClamped: false,
      retryFactor: 1.2,
    });
  });

  it('120 pages: every one runs, no page cap a run (7,200 s, past 1 h)', () => {
    const est = startOf(gridEngine(120));
    expect(est.perProvider).toEqual([
      {
        providerId: 'camoufox',
        stage: 'discovery',
        calls: 120,
        planCalls: 120,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 7200,
        blocked: null,
        scrolls: 120,
      },
    ]);
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      NO_RETRY_NOTE,
      'camoufox: 120 discovery tiles planned; a tile that pages spends one call a page',
      'camoufox grid mode reads 120 cells in 120 pages and 120 scrolls',
      'camoufox: this run takes about 2.0 h, past STUCK_AFTER_HOURS (1 h), so /health reports it stuck while it runs',
      WORST_CASE_NOTE,
    ]);
  });
});

describe('the camoufox list line on a resume', () => {
  it('a run that read every cell has nothing left: no page, no tile', async () => {
    const e = engineWith([stubCamoufox({ cells: 15 })]);
    const done = await e.runToEnd();
    expect(done.status).toBe('completed');
    const est = estimateRemainingFor(e.ctx, done, true);
    expect(est.perProvider.map((p) => [p.providerId, p.calls, p.planCalls, p.seconds])).toEqual([
      ['camoufox', 0, 0, 0],
    ]);
    expect(est.assumptions).toEqual([RETRY_NOTE, NO_RETRY_NOTE]);
  });

  it('a provider blocked before is left out of the resume: no page for it, whatever cells it has left', async () => {
    const e = engineWith([
      stubCamoufox({
        cells: 15,
        failTile: 3,
        error: blockedError('captcha'),
      }),
    ]);
    const done = await e.runToEnd();
    expect(done.status).toBe('paused_error');
    const est = estimateRemainingFor(e.ctx, done, true);
    expect(est.perProvider.map((p) => [p.providerId, p.calls, p.planCalls])).toEqual([['camoufox', 0, 0]]);
    expect(est.assumptions).toEqual([RETRY_NOTE, NO_RETRY_NOTE]);
  });
});

describe('the flight line: when it applies and which date pairs it counts (spec rev 56 §8.1)', () => {
  it('no flight line when camoufox is registered but not in the snapshot discovery, or the allowance is 0 pages', () => {
    const e = engineWith([stubCamoufox({ cells: 15, flights: {} }), stubTravelpayouts({ cells: 15 })], {
      rankedDatePairs: rankedPairs(15),
    });
    const tpOnly = startOf(e, {
      snapshot: (s) => ({ ...s, providers: { ...s.providers, discovery: ['travelpayouts'] } }),
    });
    expect('flightLists' in tpOnly).toBe(false);
    expect('flightLists' in startOf(e, { snapshot: withFlightPages(0) })).toBe(false);
  });

  it("a saved search asks the board's ranking once, with its own space, cabin, journey limit and now; a save-time estimate never asks", () => {
    const calls: Array<Parameters<ReturnType<typeof rankedPairs>>[0]> = [];
    const e = engineWith([stubCamoufox({ cells: 15, flights: {} })], {
      rankedDatePairs: rankedPairs(15, calls),
    });
    startOf(e);
    expect(calls).toEqual([]);
    const b = buildSnapshot(e.ctx, e.definition);
    startOf(e, { saved: true });
    expect(calls).toEqual([
      {
        definitionId: e.definition.id,
        space: b.snapshot.resolved,
        cabin: 'economy',
        maxJourneyMinutes: null,
        now: T0,
      },
    ]);
    calls.length = 0;
    startOf(e, {
      saved: true,
      snapshot: (s) => ({ ...s, constraints: { ...s.constraints, maxJourneyMinutes: 600 } }),
    });
    expect(calls.map((c) => c.maxJourneyMinutes)).toEqual([600]);
  });

  it('flags unread: the return phase is counted when the allowance holds 2 pages for each of the first 10 ranked pairs', () => {
    // why: a ranking of 15: the plan judges its first 10 (20 pages ≥ 10 × 2), never all 15
    const est = startOf(flightEngine(15, null), { saved: true });
    expect(est.flightLists).toMatchObject({ pairs: 10, pagesMax: 20, returns: true });
  });

  it('flags unread: a pair departing today is no candidate, so 8 later pairs fit a 16-page allowance out and back', () => {
    const e = engineWith([stubCamoufox({ cells: 15, flights: {} })], {
      rankedDatePairs: (q) => {
        const [first, ...rest] = rankedPairs(9)(q);
        if (first === undefined) throw new Error('a ranking');
        const today: RankedDatePair = { ...first, departureDate: asIsoDate('2026-10-14') };
        return [today, ...rest];
      },
    });
    expect(startOf(e, { saved: true, snapshot: withFlightPages(16) }).flightLists?.returns).toBe(true);
  });

  it('flags unread: an allowance of 10 pages holds no return phase for 10 pairs, so the line is outbound-only', () => {
    expect(startOf(flightEngine(15, null), { snapshot: withFlightPages(10) }).flightLists).toEqual({
      pairs: 10,
      pages: 10,
      seconds: 700,
      returns: false,
    });
  });

  it('with the return phase, an outbound-only list is not reusable: every ranked pair is still read', () => {
    const e = flightEngine(15, BOTH);
    const b = buildSnapshot(e.ctx, e.definition);
    const pairs = rankedPairs(3)({
      definitionId: e.definition.id,
      space: b.snapshot.resolved,
      cabin: 'economy',
      maxJourneyMinutes: null,
      now: T0,
    });
    for (const p of pairs)
      e.ctx.repos.flightLists.insert({
        definitionId: e.definition.id,
        executionId: null,
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        cabin: 'economy',
        origin: p.origin,
        destination: p.destination,
        departureDate: p.departureDate,
        returnDate: p.returnDate,
        fetchedAt: T0,
        pointOfSale: 'GB',
        status: 'read',
        reason: null,
        listed: 'no-flights',
        minMinor: null,
        tabMinor: null,
        cheapestView: null,
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
        flights: [],
        returns: null,
      });
    expect(startOf(e, { saved: true }).flightLists).toMatchObject({ pairs: 10, returns: true });
  });

  // why: spec rev 64: the browser worker has no monthly cap, so another schedule holds none of its pages
  it("another schedule never cuts a saved search's flight line", () => {
    const e = flightEngine(15, BOTH);
    const d = e.definition;
    e.ctx.repos.definitions.create({
      ...baseDefinition(),
      name: 'weekly',
      window: d.window,
      minNights: d.minNights,
      maxNights: d.maxNights,
      providers: d.providers,
      scheduleCron: '0 5 * * 1',
    });
    expect(startOf(e, { saved: true }).flightLists?.pairs).toBe(10);
    expect(startOf(e).flightLists?.pairs).toBe(10);
  });
});

describe("the flight line's caps and their words", () => {
  it('1 free call left reads 1 pair out and back; blocking drops its notes and zeroes the bound it keeps', () => {
    const est = startOf(flightEngine(15, BOTH, { maxFreeCalls: 16 }));
    expect(est.assumptions.slice(-1)).toEqual(["flights for 1 date pair: the run's free-call limit"]);
    expect(est.flightLists).toMatchObject({ pairs: 1, pagesMax: 2, returns: true });
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]));
    expect(blocked.assumptions.filter((a) => a.includes('flights'))).toEqual([]);
    expect(blocked.flightLists).toEqual({
      pairs: 0,
      pages: 0,
      seconds: 0,
      pagesMax: 0,
      secondsMax: 0,
      returns: false,
    });
  });

  it('blocking keeps every note that is not the flight line’s own, even one that mentions flights later on', () => {
    const est = startOf(flightEngine(15, BOTH, { maxFreeCalls: 16 }));
    const other = 'a note on flights for 3 date pairs from an earlier pass';
    const blocked = withBlocked(
      { ...est, assumptions: [...est.assumptions, other] },
      new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]),
    );
    expect(blocked.assumptions.slice(-2)).toEqual([other, BLOCKED_NOTE]);
  });

  it('no free call left: no "+ flights" clause, only the cap that left none', () => {
    const est = startOf(flightEngine(15, BOTH, { maxFreeCalls: 15 }));
    expect(est.assumptions).toEqual([
      RETRY_NOTE,
      NO_RETRY_NOTE,
      'camoufox: 15 discovery tiles planned; a tile that pages spends one call a page',
      WORST_CASE_NOTE,
      "flights for 0 date pairs: the run's free-call limit",
    ]);
  });

  it('a line marked out and back that reads no pair carries no window margin', () => {
    const e = flightEngine(15, BOTH);
    const none = { pairs: 0, pages: 0, seconds: 0, pagesMax: 0, secondsMax: 0, returns: true };
    expect(flightWindowMarginSeconds(e.ctx, { flightLists: none }, null)).toBe(0);
  });
});

describe('the flight line on a resume', () => {
  /** A run whose flight step stops after 4 reads (the gate refuses the fifth), and its engine. */
  async function stoppedAfterFour(preflight?: Record<string, boolean>) {
    const e = engineWith(
      [
        stubCamoufox({
          cells: 15,
          ...(preflight === undefined ? {} : { preflight: { ok: true, flags: preflight } }),
          flights: {
            answer: (_q, n) => {
              if (n > 4) throw new AbortedError();
              return undefined;
            },
          },
        }),
      ],
      { rankedDatePairs: rankedPairs(15) },
    );
    return { e, done: await e.runToEnd() };
  }

  it("the free calls this execution has spent count against the run's free-call limit", async () => {
    const { e, done } = await stoppedAfterFour();
    expect(estimateRemainingFor(e.ctx, done, true).flightLists?.pairs).toBe(6);
    // why: every browser page so far (grid and flights) is a free call of this execution; 3 more are allowed
    const spent = e.ledgerRows('camoufox').length;
    const tight = {
      ...done,
      snapshot: { ...done.snapshot, budget: { ...done.snapshot.budget, maxFreeCalls: spent + 3 } },
    };
    const est = estimateRemainingFor(e.ctx, tight, true);
    expect(est.flightLists?.pairs).toBe(3);
    expect(est.assumptions).toContain("flights for 3 date pairs: the run's free-call limit");
  });

  it('a child or a catch-up execution runs no flight-list step, so its remaining estimate has no flight line', async () => {
    const { e, done } = await stoppedAfterFour();
    expect('flightLists' in estimateRemainingFor(e.ctx, { ...done, isChild: true }, true)).toBe(false);
    expect('flightLists' in estimateRemainingFor(e.ctx, { ...done, isCatchUp: true }, true)).toBe(false);
  });

  it('a stored plan without the booking read is estimated without it (165 s a pair, at most 220 s)', async () => {
    const { e, done } = await stoppedAfterFour(BOTH);
    const plan = done.flightLists;
    if (plan === null) throw new Error('a stored plan');
    expect(plan).toMatchObject({ returns: true, booking: true });
    expect(
      estimateRemainingFor(e.ctx, { ...done, flightLists: { ...plan, booking: false } }, true).flightLists,
    ).toEqual({ pairs: 6, pages: 9, seconds: 990, pagesMax: 12, secondsMax: 1320, returns: true });
  });
});

describe('the verification line on a resume', () => {
  /** The fixture with verification, each per-cell estimate's query recorded; every search fails when `fail`. */
  function recording(fail: boolean) {
    const asked: ItineraryQuery[] = [];
    const wrap = (p: FlightProvider): FlightProvider => {
      const v = verificationOf(p);
      return {
        ...p,
        verification: {
          info: v.info,
          estimate: (q) => {
            asked.push(q);
            return v.estimate(q);
          },
          search: async (q, ctx) => {
            if (fail)
              throw new ProviderError({
                kind: 'upstream',
                retryable: true,
                providerId: 'fixture',
                message: 'synthetic upstream error',
              });
            return v.search(q, ctx);
          },
        },
      };
    };
    const h = createHarness({ transformFixture: wrap });
    return { h, asked, def: h.createDefinition({ providers: withVerification() }) };
  }
  const datesOf = (qs: ItineraryQuery[]) => qs.map((q) => [q.departureDate, q.returnDate]);
  const discoveryDone = {
    providerId: 'fixture',
    stage: 'discovery',
    calls: 0,
    planCalls: 0,
    costMicroGbp: 0,
    costPence: 0,
    seconds: 0,
    blocked: null,
  };

  it('seeded: the remaining selected cells are counted, the first of them is the sample', async () => {
    const { h, asked, def } = recording(true);
    const e = await h.runToCompletion(h.orch(), def.id);
    const left = h.repos.cells
      .outcomes(e.id, { stage: 'verification' })
      .filter((o) => o.status === 'error')
      .map((o) => [o.departureDate, o.returnDate]);
    expect(left).toHaveLength(2);
    // why: the first outcome of the execution is a discovery cell, not the first cell left to verify
    expect(h.repos.cells.outcomes(e.id)[0]?.departureDate).not.toBe(left[0]?.[0]);
    asked.length = 0;
    const est = estimateRemainingFor(buildContext(h.deps, h.options), e, false);
    expect(datesOf(asked)).toEqual([left[0]]);
    expect(est.perProvider).toEqual([
      discoveryDone,
      {
        providerId: 'fixture',
        stage: 'verification',
        calls: 8,
        planCalls: 6,
        costMicroGbp: 23_040,
        costPence: 3,
        seconds: 3,
        blocked: null,
      },
    ]);
  });

  it('not seeded (stopped in discovery): up to maxCells of the cells, sampled at the first cell with an outcome', async () => {
    const { h, asked } = recording(false);
    const def = h.createDefinition({ providers: withVerification() });
    const first = h.orch();
    h.onTileCommit((c) => {
      if (c === 1) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(h.repos.cells.hasVerificationOutcomes(e.id)).toBe(false);
    const firstCell = h.repos.cells.outcomes(e.id)[0];
    if (firstCell === undefined) throw new Error('an outcome');
    asked.length = 0;
    const est = estimateRemainingFor(buildContext(h.deps, h.options), e, false);
    expect(asked).toEqual([
      {
        origin: firstCell.origin,
        destination: firstCell.destination,
        departureDate: firstCell.departureDate,
        returnDate: firstCell.returnDate,
        cabin: 'economy',
        adults: 1,
        currency: 'GBP',
        expandTop: 1,
        bookingLinks: true,
      },
    ]);
    expect(est.perProvider.find((p) => p.stage === 'verification')).toMatchObject({ planCalls: 6, calls: 8 });
  });

  it('a completed run, or one never seeded, plans no verification line', async () => {
    const { h, def } = recording(false);
    const ctx = buildContext(h.deps, h.options);
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(estimateRemainingFor(ctx, e, false).perProvider).toEqual([discoveryDone]);
    const b = buildSnapshot(ctx, def);
    const ghost = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: b.snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    expect(estimateRemainingFor(ctx, ghost, false).perProvider).toEqual([discoveryDone]);
  });

  it('a provider in the stored snapshot that is not registered adds no line to the resume', async () => {
    const { h, def } = recording(false);
    const ctx = buildContext(h.deps, h.options);
    const e = await h.runToCompletion(h.orch(), def.id);
    const odd = {
      ...e,
      snapshot: {
        ...e.snapshot,
        providers: {
          ...e.snapshot.providers,
          discovery: [...e.snapshot.providers.discovery, 'travelpayouts' as const],
          verification: [...e.snapshot.providers.verification, 'travelpayouts' as const],
        },
      },
    };
    expect(estimateRemainingFor(ctx, odd, false)).toEqual(estimateRemainingFor(ctx, e, false));
  });
});

describe('addPass, withBlocked and confirmationOf over given estimates', () => {
  type Line = Estimate['perProvider'][number];
  type FlightLine = NonNullable<Estimate['flightLists']>;
  const line = (
    providerId: Line['providerId'],
    stage: Line['stage'],
    calls: number,
    planCalls: number,
    costMicroGbp: number,
    costPence: number,
    seconds: number,
  ): Line => ({ providerId, stage, calls, planCalls, costMicroGbp, costPence, seconds, blocked: null });
  const estimateOf = (perProvider: Line[], assumptions: string[], flightLists?: FlightLine): Estimate => ({
    cells: 28,
    perProvider,
    totalCalls: perProvider.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: perProvider.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp: perProvider.reduce((a, p) => a + p.costMicroGbp, 0),
    totalCostPence: perProvider.reduce((a, p) => a + p.costPence, 0),
    seconds: perProvider.reduce((a, p) => a + p.seconds, 0),
    assumptions,
    windowClamped: false,
    retryFactor: 1.2,
    ...(flightLists === undefined ? {} : { flightLists }),
  });
  const stored = estimateOf(
    [line('fixture', 'discovery', 3, 2, 7680, 1, 2), line('fixture', 'verification', 8, 6, 23_040, 3, 3)],
    ['stored'],
  );
  const pass = estimateOf(
    [line('fixture', 'verification', 4, 3, 11_520, 2, 2), line('travelpayouts', 'discovery', 6, 5, 0, 0, 1)],
    ['pass'],
  );

  it('adds each line to the stored line of the same provider and stage, and appends a new one', () => {
    expect(addPass(stored, pass)).toStrictEqual({
      cells: 28,
      perProvider: [
        line('fixture', 'discovery', 3, 2, 7680, 1, 2),
        line('fixture', 'verification', 12, 9, 34_560, 4, 5),
        line('travelpayouts', 'discovery', 6, 5, 0, 0, 1),
      ],
      totalCalls: 21,
      totalPlanCalls: 16,
      totalCostMicroGbp: 42_240,
      totalCostPence: 5,
      seconds: 8,
      assumptions: ['stored', 'a resumed pass planned 8 more calls'],
      windowClamped: false,
      retryFactor: 1.2,
    });
  });

  it('sums the flight lines of the passes, a missing one counting nothing', () => {
    const flightsOf = (a?: FlightLine, b?: FlightLine) =>
      addPass(estimateOf([], [], a), estimateOf([], [], b)).flightLists;
    const both: FlightLine = {
      pairs: 2,
      pages: 3,
      seconds: 100,
      pagesMax: 4,
      secondsMax: 120,
      returns: true,
    };
    const outbound: FlightLine = { pairs: 1, pages: 1, seconds: 70, returns: false };
    const bounded: FlightLine = {
      pairs: 1,
      pages: 1,
      seconds: 70,
      pagesMax: 1,
      secondsMax: 70,
      returns: false,
    };
    // why: an older stored line: out and back, but no bound recorded
    const unbounded: FlightLine = { pairs: 2, pages: 3, seconds: 100, returns: true };
    expect(flightsOf(both, undefined)).toEqual(both);
    // why: the summed flight seconds count in the total, whichever pass carried them
    expect(addPass(estimateOf([], [], both), estimateOf([], [])).seconds).toBe(100);
    expect(flightsOf(undefined, both)).toEqual(both);
    expect(flightsOf(outbound, undefined)).toEqual(outbound);
    expect(flightsOf(undefined, outbound)).toEqual(outbound);
    expect(flightsOf(bounded, outbound)).toEqual({
      pairs: 2,
      pages: 2,
      seconds: 140,
      pagesMax: 2,
      secondsMax: 140,
      returns: false,
    });
    expect(flightsOf(outbound, bounded)).toEqual({
      pairs: 2,
      pages: 2,
      seconds: 140,
      pagesMax: 2,
      secondsMax: 140,
      returns: false,
    });
    expect(flightsOf(unbounded, outbound)).toEqual({
      pairs: 3,
      pages: 4,
      seconds: 170,
      pagesMax: 4,
      secondsMax: 170,
      returns: true,
    });
    expect(flightsOf(outbound, unbounded)).toEqual({
      pairs: 3,
      pages: 4,
      seconds: 170,
      pagesMax: 4,
      secondsMax: 170,
      returns: true,
    });
    expect('flightLists' in addPass(estimateOf([], []), estimateOf([], []))).toBe(false);
  });

  it('withBlocked: nothing blocked leaves the estimate as it was; a blocked line leaves the totals and says so', () => {
    expect(withBlocked(stored, new Map())).toStrictEqual(stored);
    const blocked = withBlocked(stored, new Map([[lineKey('verification', 'fixture'), 'execution-cost']]));
    expect(blocked).toStrictEqual({
      ...stored,
      perProvider: [
        line('fixture', 'discovery', 3, 2, 7680, 1, 2),
        { ...line('fixture', 'verification', 8, 6, 23_040, 3, 3), blocked: 'execution-cost' },
      ],
      totalCalls: 3,
      totalPlanCalls: 2,
      totalCostMicroGbp: 7680,
      totalCostPence: 1,
      seconds: 2,
      assumptions: ['stored', BLOCKED_NOTE],
    });
    // the stored confirmation is the worst case over every line, the blocked one included
    expect(confirmationOf(blocked)).toEqual({ pence: 4, calls: 11 });
  });

  it('withBlocked zeroes an older out-and-back flight line with no bound to a bounded zero line', () => {
    const cam = line('camoufox', 'discovery', 15, 15, 0, 0, 1050);
    const est = estimateOf([cam], ['+ flights for up to 2 date pairs, about 3 minutes'], {
      pairs: 2,
      pages: 3,
      seconds: 100,
      returns: true,
    });
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]));
    expect(blocked.flightLists).toEqual({
      pairs: 0,
      pages: 0,
      seconds: 0,
      pagesMax: 0,
      secondsMax: 0,
      returns: false,
    });
    expect(blocked.assumptions).toEqual([BLOCKED_NOTE]);
  });

  it("withBlocked keeps every note of an estimate that has no flight line, the flight line's words included", () => {
    const cam = line('camoufox', 'discovery', 15, 15, 0, 0, 1050);
    const words = [
      '+ flights for up to 2 date pairs, about 3 minutes',
      "flights for 2 date pairs: the run's free-call limit",
    ];
    const blocked = withBlocked(
      estimateOf([cam], words),
      new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]),
    );
    expect(blocked.assumptions).toEqual([...words, BLOCKED_NOTE]);
    expect('flightLists' in blocked).toBe(false);
  });
});
