// WP15 Task 15.8 (fix round 1, TS 4): the real camoufox adapter in grid mode through the engine: a page that ended
// before its last block leaves only its unread cells for the resume (decision 50), and a blocked grid page disables the
// provider as in list mode. Synthetic worker answers; no page is loaded.
import { addDays, asIata, asIsoDate, asIsoDateTime, type IsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/snapshot.js';
import { planTiles } from '../src/stages/discovery.js';
import { engineWith, outcomes, realCamoufox, stubCamoufox } from './support/camoufox.js';
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

// why: spec §2 "Cells by name" (grid/2026-10-26/7 and 8, a sparse route): a view's cell named "no flights" is no
// fares for that pair (`empty`); one named "price unknown" is `no_data` (no price shown, not evidence of no flights);
// neither is priced, neither is an error, and the view's priced cells are kept beside them
describe('camoufox grid pages holding unpriced cells, through the engine', () => {
  it('no flights is no fares, price unknown is no data, and the rest are priced; none is an error', async () => {
    const v = view(0, '2026-11-02', '2026-11-12');
    const cells = v.cells.map((c) =>
      c.departureDate === '2026-11-05'
        ? { status: 'no-flights' as const, departureDate: c.departureDate, returnDate: c.returnDate }
        : c.departureDate === '2026-11-02' && c.returnDate === '2026-11-12'
          ? { status: 'price-unknown' as const, departureDate: c.departureDate, returnDate: c.returnDate }
          : c,
    );
    const cf = realCamoufox([grid([{ ...v, cells }], 'complete', 0)], 7, {
      executionPageCap: 100,
      executionScrollCap: 600,
    });
    const e = engineWith([cf]);
    const ex = await e.runToEnd();
    const o = outcomes(e, ex.id, 'camoufox');
    const of = (status: string) => o.filter((x) => x.status === status).map((x) => x.departureDate);
    expect(of('priced')).toEqual(['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(of('empty')).toEqual(['2026-11-05']);
    expect(of('no_data')).toEqual(['2026-11-02']);
    expect(of('error')).toEqual([]);
    expect(e.ctx.repos.cells.buckets(ex.id, 'discovery', 'camoufox')).toMatchObject({
      priced: 5,
      empty: 1,
      no_data: 1,
      error: 0,
      not_run: 0,
    });
    const rolled = e.ctx.repos.cells.rollUps(ex.id);
    const rollOf = (dep: string) =>
      [...rolled.entries()].find(([k]) => k.includes(dep))?.[1].discovery.status ?? null;
    expect([rollOf('2026-11-05'), rollOf('2026-11-02'), rollOf('2026-11-03')]).toEqual([
      'empty',
      'no_data',
      'priced',
    ]);
  });
});

// why: fix round 2 (ruling 1): a capped camoufox grid run spreads its pages across the pairs, never finishing pair 1
describe('camoufox grid pages across the pairs (fix round 2)', () => {
  function fourPairs(pageCap: number, grid = true) {
    const cf = stubCamoufox({
      cells: 1,
      ...(grid ? { grid: { pageAllowance: pageCap, scrollAllowance: 600 } } : {}),
    });
    const e = engineWith([cf], { camoufoxConfigCap: pageCap });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-01-31') },
      minNights: 10,
      maxNights: 12,
      origins: [asIata('LHR'), asIata('LGW')],
      destinations: [asIata('JFK'), asIata('EWR')],
    });
    return { cf, e, def };
  }
  // why: CodeRabbit: the run polls on real timers, so the test states its own timeout
  it('a run capped at 8 pages loads pages for every one of the four pairs', { timeout: 30_000 }, async () => {
    const { cf, e } = fourPairs(8);
    await e.runToEnd();
    // why: the ninth call is the one the page cap refuses at reserve
    expect(e.ledgerRows('camoufox')).toHaveLength(8);
    expect(new Set(cf.queries.slice(0, 8).map((q) => `${q.origin}-${q.destination}`)).size).toBe(4);
  });
  it('the plan takes the pairs in turn for grid pages; list mode keeps each pair’s cells together', () => {
    const grid = fourPairs(8);
    const cap = grid.e.ctx.providers.get('camoufox')?.discovery;
    if (cap === undefined) throw new Error('camoufox');
    const built = buildSnapshot(grid.e.ctx, grid.def);
    const pairs = planTiles('camoufox', cap, built.snapshot, built.cells).map(
      (t) => `${t.query.origin}-${t.query.destination}`,
    );
    expect(new Set(pairs.slice(0, 4)).size).toBe(4);
    const indexes = planTiles('camoufox', cap, built.snapshot, built.cells).map((t) => t.plan.index);
    expect(indexes).toEqual(indexes.map((_x, i) => i));
    const list = fourPairs(8, false);
    const lcap = list.e.ctx.providers.get('camoufox')?.discovery;
    if (lcap === undefined) throw new Error('camoufox');
    const lb = buildSnapshot(list.e.ctx, list.def);
    const lp = planTiles('camoufox', lcap, lb.snapshot, lb.cells).map(
      (t) => `${t.query.origin}-${t.query.destination}`,
    );
    expect(new Set(lp.slice(0, 4)).size).toBe(1);
  });
});

// why: re-review N2: with the month's scrolls spent, a 0-night page still loads (it drops its lead scroll), so the pass
// keeps its ledger parity and raises no parity notice
describe('camoufox grid pages with no scroll left (re-review N2)', () => {
  it('a fresh run of 0-night pages with the month scroll cap spent loads every page and reports no parity break', async () => {
    const cf = realCamoufox(
      Array.from({ length: 4 }, () => grid([], 'complete', 0)),
      14,
      { executionPageCap: 100, executionScrollCap: 600 },
    );
    const e = engineWith([cf], { env: { CAMOUFOX_MONTHLY_SCROLL_CAP: '0' } });
    e.ctx.repos.definitions.update(e.definition.id, { minNights: 0, maxNights: 0 });
    const ex = await e.runToEnd();
    expect(cf.calls.length).toBeGreaterThan(0);
    expect(e.ledgerRows('camoufox')).toHaveLength(cf.calls.length);
    const notices = e.notifications.map((n) => n.kind);
    expect(notices).not.toContain('parity_break');
    expect(ex.status).not.toBe('failed');
  });
});
