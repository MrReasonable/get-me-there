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

describe('provider-execution and no-page rows (spec §2, §5.3; decision 69)', () => {
  it('the cap comes from the execution snapshot: the 3rd page with a snapshot cap of 2 is refused, whatever config says', () => {
    const g = guardFor({ camoufoxConfigCap: 100, snapshotCaps: { e1: { camoufox: 2 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    g.reserve(r('e1', 1)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(scopeOf(() => g.reserve(r('e1', 2)))).toBe('provider-execution');
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 2,
      cap: 2,
    });
  });
  it('no-page rows count toward neither page cap', () => {
    const g = guardFor({ camoufoxConfigCap: 100, monthlyCap: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    for (let i = 0; i < 5; i++)
      g.reserve(r('e1', i)).finalise({
        outcome: 'error',
        httpStatus: 429,
        durationMs: 1,
        pageClass: 'no-page',
      });
    expect(() => g.reserve(r('e1', 9))).not.toThrow();
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(1);
  });
  it('provider-execution is checked before execution-free-calls: one reserve that breaches both names provider-execution', () => {
    const g = guardFor({ camoufoxConfigCap: 100, maxFreeCalls: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(scopeOf(() => g.reserve(r('e1', 1)))).toBe('provider-execution');
  });
  it('provider-month is checked before provider-execution', () => {
    const g = guardFor({ monthlyCap: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(scopeOf(() => g.reserve(r('e1', 1)))).toBe('provider-month');
  });
  it('camoufox rows are never billable and cost 0', () => {
    const g = guardFor({ camoufoxConfigCap: 100, snapshotCaps: { e1: { camoufox: 10 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'error', httpStatus: 423, durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' })).toMatchObject({
      calls: 1,
      costMicroGbp: 0,
    });
  });
  it('an execution whose snapshot sets no cap for the provider has no provider-execution scope (arch-007)', () => {
    const g = guardFor({ snapshotCaps: { e1: {} } });
    for (let i = 0; i < 3; i++)
      g.reserve(r('e1', i)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 3,
      cap: null,
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
    const g = guardFor({ snapshotCaps: { e1: { camoufox: 1 }, e2: { camoufox: 1 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(() => g.reserve(r('e2', 0))).not.toThrow();
  });
});
