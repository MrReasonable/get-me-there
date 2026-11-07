// The camoufox grid's scrolls on the ledger (spec §2, §7 rev 34; WP15 Task 15.6): a grid page's reservation names its
// planned scrolls, never refused (no scroll cap a run, spec rev 65); the row then holds the scrolls the page made, or
// NULL when the call ended with no answer (CB-4). Pages still count one row each.
import { beforeEach, describe, expect, it } from 'vitest';
import { guardWithDb, guardWithLedger } from './helpers/guard.js';

const r = (executionId: string, tileIndex: number, scrolls?: number) => ({
  providerId: 'camoufox' as const,
  executionId,
  tileIndex,
  costMicroGbp: 0,
  httpAttempt: 1,
  endpointPath: '/v1/page',
  ...(scrolls === undefined ? {} : { scrolls }),
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('scrolls on the ledger (spec §2 rev 34; no scroll cap a run, rev 65)', () => {
  it('a page’s planned scrolls are never refused, however many the run has made; its row holds the scrolls made', () => {
    const { g, rows } = guardWithDb({ snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 600)).finalise({
      outcome: 'ok',
      durationMs: 1,
      pageClass: 'page',
      scrollCount: 598,
    });
    expect(() =>
      g
        .reserve(r('e1', 1, 60))
        .finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page', scrollCount: 60 }),
    ).not.toThrow();
    expect(rows().map((x) => x.scrollCount)).toEqual([598, 60]);
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
    // so the ledger never undercounts
    expect(rows().map((x) => x.scrollCount)).toEqual([3, 10, null]);
    // why: the run's pages still count rows: three pages, with no cap on them
    expect(g.usage({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toMatchObject({
      calls: 3,
      cap: null,
    });
  });
  it('an error with no answer (the worker refused the connection) holds NULL: no page was loaded', () => {
    const { g, rows } = guardWithDb({ snapshotCaps: { e1: { camoufox: 100 } } });
    g.reserve(r('e1', 0, 14)).finalise({ outcome: 'error', durationMs: 1, pageClass: 'no-page' });
    expect(rows().map((x) => x.scrollCount)).toEqual([null]);
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
