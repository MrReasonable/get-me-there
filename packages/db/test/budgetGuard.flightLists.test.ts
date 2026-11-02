import { BudgetExceeded, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import type { Db } from '../src/client.js';
import { freshDb, T0 } from './helpers/db.js';
import { budgetConfig, limits } from './helpers/factories.js';
import { guardFor, guardWithLedger } from './helpers/guard.js';

// Spec revision 55 §8.1 (ruling A32): a flight-list page (`/v1/flights`) is a browser page with an allowance of its own
// in the run (`budget.flightListPages`, outside CAMOUFOX_EXECUTION_PAGE_CAP) and inside the provider's monthly cap.

const page = (executionId: string | null, endpointPath: string, tileIndex: number | null = null) => ({
  providerId: 'camoufox' as const,
  executionId,
  tileIndex,
  costMicroGbp: 0,
  httpAttempt: 1,
  endpointPath,
});
const grid = (executionId: string | null, i: number) => page(executionId, '/v1/page', i);
const flights = (executionId: string | null) => page(executionId, '/v1/flights');
// why: an answer always carries its status (http-kit finalises `ok` with it); a row with none is a response-less attempt
const done = { outcome: 'ok', httpStatus: 200, durationMs: 1, pageClass: 'page' } as const;

function scopeOf(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof BudgetExceeded ? e.scope : 'other';
  }
  return undefined;
}
beforeEach(() => {
  expect.hasAssertions();
});

describe('flight-list pages and the guard (spec rev 55 §8.1)', () => {
  it('flightListPages 10: ten /v1/flights pages pass and the eleventh is refused at provider-execution', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      snapshotCaps: { e1: { camoufox: 100 } },
      snapshotFlightPages: { e1: 10 },
    });
    for (let i = 0; i < 10; i++) g.reserve(flights('e1')).finalise(done);
    const e = (() => {
      try {
        g.reserve(flights('e1'));
      } catch (err) {
        return err;
      }
      return undefined;
    })();
    expect(e).toBeInstanceOf(BudgetExceeded);
    expect(e).toMatchObject({ scope: 'provider-execution', cap: 10, current: 10, providerId: 'camoufox' });
  });

  it('100 grid pages and no flight page: a /v1/flights reserve still passes (the page cap is not the flight cap)', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      monthlyCap: 1500,
      snapshotCaps: { e1: { camoufox: 100 } },
      snapshotFlightPages: { e1: 10 },
    });
    for (let i = 0; i < 100; i++) g.reserve(grid('e1', i)).finalise(done);
    expect(scopeOf(() => g.reserve(grid('e1', 100)))).toBe('provider-execution');
    expect(() => g.reserve(flights('e1'))).not.toThrow();
  });

  it('the /v1/page cap ignores /v1/flights rows', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      snapshotCaps: { e1: { camoufox: 2 } },
      snapshotFlightPages: { e1: 10 },
    });
    for (let i = 0; i < 5; i++) g.reserve(flights('e1')).finalise(done);
    g.reserve(grid('e1', 0)).finalise(done);
    expect(() => g.reserve(grid('e1', 1))).not.toThrow();
    expect(scopeOf(() => g.reserve(grid('e1', 2)))).toBe('provider-execution');
  });

  it('usage(provider-execution) reports grid pages against the page cap and, as a second entry, flight pages against the flight allowance', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      snapshotCaps: { e1: { camoufox: 7 } },
      snapshotFlightPages: { e1: 10 },
    });
    for (let i = 0; i < 3; i++) g.reserve(grid('e1', i)).finalise(done);
    for (let i = 0; i < 4; i++) g.reserve(flights('e1')).finalise(done);
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 3,
      cap: 7,
      flightLists: { calls: 4, cap: 10 },
    });
  });

  it('a no-page flight row counts toward neither allowance', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      snapshotCaps: { e1: { camoufox: 100 } },
      snapshotFlightPages: { e1: 1 },
    });
    for (let i = 0; i < 3; i++)
      g.reserve(flights('e1')).finalise({
        outcome: 'error',
        httpStatus: 429,
        durationMs: 1,
        pageClass: 'no-page',
      });
    expect(() => g.reserve(flights('e1'))).not.toThrow();
  });

  it('a snapshot without flightListPages refuses the first /v1/flights reserve (cap 0, fail closed)', () => {
    const g = guardFor({ camoufoxConfigCap: 100, snapshotCaps: { e1: { camoufox: 100 } } });
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      flightLists: { calls: 0, cap: 0 },
    });
    expect(scopeOf(() => g.reserve(flights('e1')))).toBe('provider-execution');
    expect(() => g.reserve(grid('e1', 0))).not.toThrow();
  });

  it('a reserve with no execution and /v1/flights is checked at provider-month only', () => {
    const g = guardFor({ camoufoxConfigCap: 100, monthlyCap: 2, snapshotCaps: { e1: { camoufox: 100 } } });
    expect(() => g.reserve(flights(null))).not.toThrow();
    expect(() => g.reserve(flights(null))).not.toThrow();
    expect(scopeOf(() => g.reserve(flights(null)))).toBe('provider-month');
  });

  it('flight pages count toward the monthly cap beside grid pages', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      monthlyCap: 3,
      snapshotCaps: { e1: { camoufox: 100 } },
      snapshotFlightPages: { e1: 10 },
    });
    g.reserve(grid('e1', 0)).finalise(done);
    g.reserve(flights('e1')).finalise(done);
    g.reserve(flights('e1')).finalise(done);
    expect(scopeOf(() => g.reserve(flights('e1')))).toBe('provider-month');
  });

  it('flight pages count against execution-free-calls', () => {
    const g = guardFor({
      camoufoxConfigCap: 100,
      maxFreeCalls: 3,
      snapshotCaps: { e1: { camoufox: 100 } },
      snapshotFlightPages: { e1: 10 },
    });
    g.reserve(grid('e1', 0)).finalise(done);
    g.reserve(flights('e1')).finalise(done);
    g.reserve(flights('e1')).finalise(done);
    expect(scopeOf(() => g.reserve(flights('e1')))).toBe('execution-free-calls');
    expect(g.usage({ kind: 'execution-free-calls', executionId: 'e1' }).calls).toBe(3);
  });
});

// Spec revision 56 §5.1, §5.3, §7 (R-zero, R-reserve): a flights request with a return phase reserves its planned pages
// (`ReserveParams.pages`); the row's page_count holds the plan while pending and the answer's `pagesLoaded` once
// finalised, and the camoufox page scopes sum COALESCE(page_count, 1) over page rows as their `calls`.
describe('page counts on the ledger (spec rev 56 §5.3, §7)', () => {
  const caps = {
    camoufoxConfigCap: 100,
    snapshotCaps: { e1: { camoufox: 100 } },
    snapshotFlightPages: { e1: 20 },
  };
  const pageCounts = (db: Db) =>
    db.raw
      .prepare<[], { pageCount: number | null }>(
        'SELECT page_count AS pageCount FROM provider_requests ORDER BY id',
      )
      .all()
      .map((r) => r.pageCount);

  it('a reserve of 2 pages holds 2 while pending; finalise writes the answer’s count, keeps the plan on an unknown attempt, and NULL otherwise', () => {
    const { g, db } = guardWithLedger(caps);
    const reserve = () => g.reserve({ ...flights('e1'), pages: 2 });
    const pending = reserve();
    expect(pageCounts(db)).toEqual([2]);
    pending.finalise({ ...done, pageCount: 1 });
    reserve().finalise({ ...done, pageCount: 0 });
    reserve().finalise({ outcome: 'unknown', durationMs: 1 });
    reserve().finalise({ outcome: 'unknown', durationMs: 1, pageClass: 'page', pageCount: 1 });
    // why: spec rev 56 §7: an answer that states no page count leaves NULL, which counts 1
    reserve().finalise(done);
    reserve().finalise({ outcome: 'error', httpStatus: 429, durationMs: 1, pageClass: 'no-page' });
    reserve().finalise({
      outcome: 'error',
      httpStatus: 429,
      durationMs: 1,
      pageClass: 'no-page',
      pageCount: 0,
    });
    expect(pageCounts(db)).toEqual([1, 0, 2, 1, null, null, null]);
  });

  // why: spec rev 56 §7 and providers' http-kit (attempt.ts): a socket failure after the worker was reached finalises
  // `error` with no status, no body and `pageClass 'page'`; with no answer it keeps the plan, never the guard's 1
  it('a 2-page request that reached the page and then failed on the socket keeps its plan of 2', () => {
    const { g, db } = guardWithLedger({ ...caps, monthlyCap: 1500 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({
      outcome: 'error',
      durationMs: 1,
      pageClass: 'page',
    });
    expect(pageCounts(db)).toEqual([2]);
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(2);
    expect(
      g.usage({ kind: 'provider-execution', providerId: 'camoufox', executionId: 'e1' }).flightLists?.calls,
    ).toBe(2);
  });

  // why: http-kit marks a refused connection `no-page` (nothing was sent): no page is recorded and none is counted
  it('a 2-page request that never connected records no page', () => {
    const { g, db } = guardWithLedger({ ...caps, monthlyCap: 1500 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({
      outcome: 'error',
      durationMs: 1,
      pageClass: 'no-page',
    });
    expect(pageCounts(db)).toEqual([null]);
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(0);
    expect(
      g.usage({ kind: 'provider-execution', providerId: 'camoufox', executionId: 'e1' }).flightLists?.calls,
    ).toBe(0);
  });

  it('a reserve without pages plans 1 on a camoufox row; a row of another provider holds NULL, pages asked or not', () => {
    const { g, db } = guardWithLedger(caps);
    g.reserve(grid('e1', 0));
    g.reserve(flights(null));
    expect(pageCounts(db)).toEqual([1, 1]);
    const other = freshDb();
    const guard = new SqliteBudgetGuard(
      other,
      budgetConfig({ travelpayouts: limits({ billable: false, monthlyCallCap: 2 }) }),
      fixedClock(T0),
    );
    const tp = {
      providerId: 'travelpayouts',
      executionId: null,
      tileIndex: 0,
      costMicroGbp: 0,
      httpAttempt: 1,
    } as const;
    guard.reserve({ ...tp, endpointPath: '/p', pages: 2 }).finalise({ ...done, pageCount: 2 });
    // the pages ask nothing of another provider's caps: its second request still fits a cap of 2
    expect(() => guard.reserve({ ...tp, endpointPath: '/p', pages: 2 })).not.toThrow();
    expect(pageCounts(other)).toEqual([null, null]);
  });

  it('refuses a page plan below 1 and a page count below 0', () => {
    const { g } = guardWithLedger(caps);
    expect(() => g.reserve({ ...flights('e1'), pages: 0 })).toThrow(/pages must be an integer ≥ 1/);
    expect(() => g.reserve(flights('e1')).finalise({ ...done, pageCount: -1 })).toThrow(
      /pageCount must be an integer ≥ 0/,
    );
  });

  it('flightListPages 20, nine rows finalised at 2: a reserve of 2 passes at 18 and the next, at 20, is refused at provider-execution', () => {
    const g = guardFor(caps);
    for (let i = 0; i < 9; i++) g.reserve({ ...flights('e1'), pages: 2 }).finalise({ ...done, pageCount: 2 });
    expect(() => g.reserve({ ...flights('e1'), pages: 2 })).not.toThrow();
    let refused: unknown;
    try {
      g.reserve({ ...flights('e1'), pages: 2 });
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(BudgetExceeded);
    expect(refused).toMatchObject({ scope: 'provider-execution', cap: 20, current: 20, requested: 2 });
    // one page still fits nowhere: the pending reserve of 2 counts its plan
    expect(scopeOf(() => g.reserve(flights('e1')))).toBe('provider-execution');
  });

  it('the monthly cap checks the planned pages: with 1 page left a reserve of 2 is refused at provider-month, a reserve of 1 passes', () => {
    const g = guardFor({ ...caps, monthlyCap: 3 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({ ...done, pageCount: 2 });
    expect(scopeOf(() => g.reserve({ ...flights('e1'), pages: 2 }))).toBe('provider-month');
    expect(() => g.reserve(flights('e1'))).not.toThrow();
  });

  it('usage reports the page sums: a row of 0 counts 0, of 2 counts 2, NULL counts 1, a no-page row 0', () => {
    const g = guardFor({ ...caps, monthlyCap: 1500 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({ ...done, pageCount: 0 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({ ...done, pageCount: 2 });
    g.reserve({ ...flights('e1'), pages: 2 }).finalise(done);
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({
      outcome: 'error',
      durationMs: 1,
      pageClass: 'no-page',
    });
    g.reserve(grid('e1', 0)).finalise(done);
    g.reserve(grid('e1', 1)).finalise(done);
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 2,
      flightLists: { calls: 3, cap: 20 },
    });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(5);
    // a pending reserve counts its plan in both
    g.reserve({ ...flights('e1'), pages: 2 });
    expect(
      g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' }).flightLists?.calls,
    ).toBe(5);
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(7);
    // execution-free-calls still counts requests, not pages
    expect(g.usage({ kind: 'execution-free-calls', executionId: 'e1' }).calls).toBe(7);
  });

  it('scrollsThisMonth is unchanged by page counts', () => {
    const g = guardFor(caps);
    g.reserve({ ...flights('e1'), pages: 2 }).finalise({ ...done, pageCount: 2 });
    g.reserve({ ...grid('e1', 0), scrolls: 3 }).finalise({ ...done, scrollCount: 3 });
    expect(g.scrollsThisMonth('camoufox')).toBe(3);
  });
});
