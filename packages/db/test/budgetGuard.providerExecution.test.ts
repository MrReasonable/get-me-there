import { BudgetExceeded } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { guardFor } from './helpers/guard.js';

const r = (executionId: string | null, tileIndex: number) => ({
  providerId: 'camoufox' as const,
  executionId,
  tileIndex,
  costMicroGbp: 0,
  httpAttempt: 1,
  endpointPath: '/v1/page',
});
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

describe('provider-execution and no-page rows (spec §2, §5.3; decision 69; no page cap a run, rev 65)', () => {
  // why: spec rev 65: a run stored earlier may carry the withdrawn page cap in its snapshot; the guard never reads it
  it('a snapshot’s withdrawn page cap is ignored: the 3rd page with a stored cap of 2 is reserved, counted with no cap', () => {
    const g = guardFor({ snapshotCaps: { e1: { camoufox: 2 } } });
    for (let i = 0; i < 3; i++)
      g.reserve(r('e1', i)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 3,
      cap: null,
    });
  });
  it('no-page rows count as no page', () => {
    const g = guardFor({ snapshotCaps: { e1: { camoufox: 1 } } });
    for (let i = 0; i < 5; i++)
      g.reserve(r('e1', i)).finalise({
        outcome: 'error',
        httpStatus: 429,
        durationMs: 1,
        pageClass: 'no-page',
      });
    expect(() => g.reserve(r('e1', 9))).not.toThrow();
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(1);
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' }).calls).toBe(1);
  });
  // why: spec rev 65: browser pages count against no per-run call cap; a free API's calls (Travelpayouts) still do
  it('pages never count as free calls: 156 pass a run whose free-call cap is 150, while Travelpayouts still stops at it', () => {
    const g = guardFor({ maxFreeCalls: 150, travelpayouts: true, snapshotCaps: { e1: { camoufox: 100 } } });
    for (let i = 0; i < 156; i++)
      g.reserve(r('e1', i)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'execution-free-calls', executionId: 'e1' }).calls).toBe(0);
    const tp = (i: number) => ({
      ...r('e1', i),
      providerId: 'travelpayouts' as const,
      endpointPath: '/v3/prices',
    });
    for (let i = 0; i < 150; i++) g.reserve(tp(i)).finalise({ outcome: 'ok', durationMs: 1 });
    expect(scopeOf(() => g.reserve(tp(150)))).toBe('execution-free-calls');
  });
  // why: spec rev 64: no monthly page cap; pages outside any run are never refused however many the month holds
  it('the month never refuses a page: 2,000 pages outside any run all pass, counted with no cap', () => {
    const g = guardFor({ snapshotCaps: {} });
    for (let i = 0; i < 2000; i++)
      g.reserve(r(null, i)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' })).toMatchObject({
      calls: 2000,
      cap: null,
    });
  });
  it('camoufox rows are never billable and cost 0', () => {
    const g = guardFor({ snapshotCaps: { e1: { camoufox: 10 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'error', httpStatus: 423, durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' })).toMatchObject({
      calls: 1,
      costMicroGbp: 0,
    });
  });
  it('a reserve outside any execution checks no execution scope; a missing execution is refused', () => {
    const g = guardFor({ snapshotCaps: {} });
    expect(() => g.reserve(r(null, 0)).finalise({ outcome: 'ok', durationMs: 1 })).not.toThrow();
    expect(() => g.reserve(r('nope', 0))).toThrow(/does not exist/);
    expect(() =>
      g.usage({ kind: 'provider-execution', executionId: 'nope', providerId: 'camoufox' }),
    ).toThrow(/does not exist/);
  });
  it('rows of another execution do not count toward this one', () => {
    const g = guardFor({ snapshotCaps: { e1: {}, e2: {} } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-execution', executionId: 'e2', providerId: 'camoufox' }).calls).toBe(0);
  });
});
