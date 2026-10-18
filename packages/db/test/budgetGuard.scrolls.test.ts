// The camoufox grid's scroll caps (spec §2, §7 rev 34; WP15 ruling 12, Task 15.6): a grid page's reservation names its
// planned scrolls, which must fit what the run's and the month's caps leave; the row then holds the scrolls the page
// made, or NULL when the call ended with no answer (CB-4). Pages still count one row each.
import { BudgetExceeded } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { guardFor, guardWithDb, guardWithLedger } from './helpers/guard.js';

const r = (executionId: string, tileIndex: number, scrolls?: number) => ({
  providerId: 'camoufox' as const,
  executionId,
  tileIndex,
  costMicroGbp: 0,
  httpAttempt: 1,
  endpointPath: '/v1/page',
  ...(scrolls === undefined ? {} : { scrolls }),
});
function scopeOf(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof BudgetExceeded ? `${e.scope}:${e.message}` : 'other';
  }
  return undefined;
}
beforeEach(() => {
  expect.hasAssertions();
});

describe('scroll caps (spec §2 rev 34)', () => {
  it('a page whose planned scrolls pass the run cap is refused; one that fits is reserved and its row holds the scrolls made', () => {
    const g = guardFor({ executionScrollCap: 30, snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 20)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 18 });
    expect(scopeOf(() => g.reserve(r('e1', 1, 13)))).toMatch(
      /^provider-execution:budget exceeded: provider-execution scrolls cap 30, current 18, requested 13/,
    );
    expect(() => g.reserve(r('e1', 2, 12))).not.toThrow();
    expect(g.scrollUsage('camoufox', 'e1')).toEqual({ execution: 30, month: 30 });
  });
  it('the month cap counts every execution', () => {
    const g = guardFor({
      monthlyScrollCap: 25,
      snapshotCaps: { e1: { camoufox: 100 }, e2: { camoufox: 100 } },
    });
    g.reserve(r('e1', 0, 20)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 20 });
    expect(scopeOf(() => g.reserve(r('e2', 0, 6)))).toMatch(
      /^provider-month:budget exceeded: provider-month scrolls cap 25/,
    );
    // why: fix round 1 (TS 7): the boundary: 20 + 5 is the cap itself, and is reserved
    expect(() => g.reserve(r('e2', 1, 5))).not.toThrow();
  });
  it('a page blocked after 3 scrolls holds 3; a call that ended with no answer keeps its planned scrolls; a list page never a count', () => {
    const { g, rows } = guardWithDb({ snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 10)).finalise({
      outcome: 'error',
      httpStatus: 423,
      durationMs: 1,
      pageClass: 'page',
      scrollCount: 3,
    });
    g.reserve(r('e1', 1, 10)).finalise({ outcome: 'unknown', durationMs: 1 });
    g.reserve(r('e1', 2)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    // why: CodeRabbit on PR #9: a timeout or an abort may come after the worker scrolled; the planned count stands,
    // so the scroll caps never undercount
    expect(rows().map((x) => x.scrollCount)).toEqual([3, 10, null]);
    // why: the page caps still count rows: three pages
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' }).calls).toBe(3);
  });
  it('a call that ended with no answer counts its planned scrolls against the caps (CodeRabbit)', () => {
    const g = guardFor({ executionScrollCap: 30, snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 14)).finalise({ outcome: 'unknown', durationMs: 1 });
    expect(g.scrollUsage('camoufox', 'e1')).toEqual({ execution: 14, month: 14 });
  });
  it('an error with no answer (the worker refused the connection) holds NULL: no page was loaded', () => {
    const { g, rows } = guardWithDb({ snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 14)).finalise({ outcome: 'error', durationMs: 1, pageClass: 'no-page' });
    expect(rows().map((x) => x.scrollCount)).toEqual([null]);
  });
  it('scrollsLeft is what the run’s and the month’s caps leave, the lesser, never below 0 (CA 1)', () => {
    const g = guardFor({
      executionScrollCap: 30,
      monthlyScrollCap: 25,
      snapshotCaps: { e1: { camoufox: 100 }, e2: { camoufox: 100 } },
    });
    expect(g.scrollsLeft('camoufox', 'e1')).toBe(25);
    g.reserve(r('e2', 0, 20)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 20 });
    expect(g.scrollsLeft('camoufox', 'e1')).toBe(5);
    g.reserve(r('e1', 0, 5)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 5 });
    expect(g.scrollsLeft('camoufox', 'e1')).toBe(0);
    const run = guardFor({ executionScrollCap: 30, snapshotCaps: { e1: { camoufox: 100 } } });
    run
      .reserve(r('e1', 0, 12))
      .finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 12 });
    expect(run.scrollsLeft('camoufox', 'e1')).toBe(18);
    // why: with no execution only the month cap applies (6,000 by default)
    expect(run.scrollsLeft('camoufox', null)).toBe(6000 - 12);
  });
  it('a pending reservation holds its planned scrolls until it finalises', () => {
    const g = guardFor({ executionScrollCap: 30, snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 25));
    expect(scopeOf(() => g.reserve(r('e1', 1, 6)))).toMatch(/^provider-execution:/);
  });
});

describe('the ledger counts scrolls beside pages (View D, CB-5)', () => {
  it('countsFor sums a provider’s scroll clicks per stage', async () => {
    const { LedgerRepo } = await import('../src/repositories/ledger.js');
    const { g, db } = guardWithLedger({ snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 10)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 7 });
    g.reserve(r('e1', 1, 10)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 5 });
    expect(new LedgerRepo(db).countsFor('e1').perProvider).toEqual([
      expect.objectContaining({ providerId: 'camoufox', stage: 'discovery', calls: 2, scrolls: 12 }),
    ]);
  });
});
