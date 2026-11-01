import { BudgetExceeded } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { guardFor } from './helpers/guard.js';

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
const done = { outcome: 'ok', durationMs: 1, pageClass: 'page' } as const;

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
