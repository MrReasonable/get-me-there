// WP15 Task 15.8 (fix round 1, TS 4): the real camoufox adapter in grid mode through the engine: a page that ended
// before its last block leaves only its unread cells for the resume (decision 50), and a blocked grid page disables the
// provider as in list mode. Synthetic worker answers; no page is loaded.
import { addDays, asIsoDate, asIsoDateTime, type IsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { engineWith, outcomes, realCamoufox } from './support/camoufox.js';
import { T0 } from './support/harness.js';

const B = asIsoDateTime('2026-10-23T05:00:00.000Z');
const versions = {
  selectors: 's',
  grammar: 'g',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
  gridGrammar: '2026-10-18',
};
const days = (from: string): IsoDate[] => Array.from({ length: 7 }, (_v, i) => addDays(asIsoDate(from), i));
/** A whole read view: departures from `dep`, returns from `ret`, every pair at £451. */
const view = (index: number, dep: string, ret: string) => ({
  index,
  departures: days(dep),
  returns: days(ret),
  cells: days(dep).flatMap((d) =>
    days(ret).map((r) => ({
      status: 'price' as const,
      departureDate: d,
      returnDate: r,
      amountMinor: 45_100,
      mark: 'none' as const,
    })),
  ),
  unparsed: 0,
  structural: 'ok' as const,
  offPlan: null,
});
const grid = (views: unknown[], ended: string, scrolls: number) => ({
  status: 200,
  body: {
    kind: 'grid',
    fetchedAt: T0,
    currency: 'GBP',
    pointOfSale: 'GB',
    views,
    scrolls,
    ended,
    notes: [],
    versions,
  },
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('camoufox grid mode through the engine (Task 15.8)', () => {
  it.each([
    ['scroll-not-settled', 'page-not-ready'],
    ['off-plan', 'off-plan-view'],
  ])(
    'a page that ended %s leaves its unread block for the resume, which plans only those cells',
    async (ended, code) => {
      // why: 14 departures of one 10-night stay are two blocks; a page cap of 1 joins them on one page by 14 scrolls
      const cf = realCamoufox(
        [
          grid([view(0, '2026-11-02', '2026-11-12')], ended, 1),
          grid([view(0, '2026-11-09', '2026-11-19')], 'complete', 0),
        ],
        14,
        { executionPageCap: 1, executionScrollCap: 600 },
      );
      // why: the planner splits a page allowance of 1 (one page a run); the execution's cap of 2 leaves a page to resume
      const e = engineWith([cf], { camoufoxConfigCap: 2 });
      const ex = await e.runToEnd();
      const first = outcomes(e, ex.id, 'camoufox');
      expect(first.filter((o) => o.status === 'priced')).toHaveLength(7);
      const unread = first.filter((o) => o.status === 'error');
      expect(unread).toHaveLength(7);
      for (const o of unread) expect(o.lastError ?? '').toMatch(new RegExp(`^${code} `));
      expect(cf.calls[0]?.request).toMatchObject({ kind: 'grid-path', moves: expect.any(Array) });
      const resumed = await e.resume(ex.id, { manual: true });
      const second = cf.calls[1];
      if (second?.request.kind !== 'grid-path') throw new Error(`no second page (${resumed.status})`);
      expect(second.coveredCells.map((c) => c.departureDate).sort()).toEqual(days('2026-11-09'));
      expect(second.request.start).toEqual({ departureDate: '2026-11-12', returnDate: '2026-11-22' });
      expect(outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'priced')).toHaveLength(14);
    },
  );
  it('a blocked grid page disables the provider for the run: its cells error/blocked, the next page’s skipped', async () => {
    const cf = realCamoufox(
      [{ status: 423, body: { kind: 'blocked', page: 'captcha', cooldownUntil: B, scrolls: 2 } }],
      14,
      { executionPageCap: 100, executionScrollCap: 600 },
    );
    const e = engineWith([cf]);
    const ex = await e.runToEnd();
    const o = outcomes(e, ex.id, 'camoufox');
    expect(o.filter((x) => x.status === 'error' && x.reason === 'blocked')).toHaveLength(7);
    expect(o.filter((x) => x.status === 'skipped' && x.reason === 'provider_disabled')).toHaveLength(7);
    expect(cf.calls).toHaveLength(1);
    expect(e.ledgerRows('camoufox')).toHaveLength(1);
  });
});
