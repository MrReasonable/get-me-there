import { apiContract, asIsoDate, asIsoDateTime, asIsoMonth, cellKeyString, type ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { countCachedCells, coverageCheckFor, coverageCheckWith } from '../src/coverageCheck.js';
import { runMaintenanceJob, runSystemJob } from '../src/maintenance.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_RULES,
  HOUR,
  JFK,
  LGW,
  LHR,
  tileRule,
} from './support/harness.js';
import { mapPrices, mapTiles } from './support/wrappers.js';

const req = {
  origins: [LHR, LGW],
  destinations: [JFK],
  window: { kind: 'absolute' as const, from: asIsoDate('2026-11-23'), to: asIsoDate('2026-12-06') },
  minNights: 7,
  maxNights: 8,
};
const c = (departureDate: string, returnDate: string) => ({
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate(departureDate),
  returnDate: asIsoDate(returnDate),
});

describe('countCachedCells (prov-wp07-008, po-007)', () => {
  it('counts distinct in-band cells with a price per departure month; duplicates and out-of-band rows do not count; failed months are null', () => {
    const months = [asIsoMonth('2026-11'), asIsoMonth('2026-12'), asIsoMonth('2027-01')];
    const cells = [
      c('2026-11-05', '2026-11-12'),
      c('2026-11-30', '2026-12-07'),
      c('2026-12-01', '2026-12-08'),
      c('2027-01-02', '2027-01-09'),
    ];
    const priced = [
      c('2026-11-05', '2026-11-12'),
      c('2026-11-05', '2026-11-12'),
      c('2026-11-05', '2026-11-30'),
      c('2026-12-01', '2026-12-08'),
    ];
    expect(countCachedCells(priced, [c('2027-01-02', '2027-01-09')], months, cells)).toEqual([
      { month: '2026-11', cachedRows: 1, cellsInBand: 2 },
      { month: '2026-12', cachedRows: 1, cellsInBand: 1 },
      { month: '2027-01', cachedRows: null, cellsInBand: 1 },
    ]);
  });
});

describe('coverage check (spec §10 "runs Travelpayouts month tiles (free, ledgered, subject to the free-call caps); never calls a billed provider")', () => {
  it('without Travelpayouts it calls nothing and says why', async () => {
    const h = createHarness();
    const r = await coverageCheckFor(buildContext(h.deps, h.options), req);
    expect(r).toEqual({
      pairs: [],
      calls: 0,
      notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'],
    });
    expect(h.requests).toHaveLength(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(apiContract.coverageCheckResponseSchema.safeParse(r).success).toBe(true);
  });

  it('runs one pass of a provider’s tiles per pair outside any execution and counts distinct cached cells per month', async () => {
    // why: the provider used by the check is passed in; the fixture stands in for Travelpayouts (ruling 1)
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => x) });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs.map((p) => `${p.origin}-${p.destination}`)).toEqual(['LHR-JFK', 'LGW-JFK']);
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: 16, cellsInBand: 16 }, // 23–30 November × 2 nights
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.calls).toBe(4);
    expect(r.notes).toEqual([
      'cached prices are counted for economy; the check does not look at other cabins',
    ]);
    expect(
      h.db.raw
        .prepare<[], { e: string | null }>('SELECT DISTINCT execution_id AS e FROM provider_requests')
        .all(),
    ).toEqual([{ e: null }]);
    expect(apiContract.coverageCheckResponseSchema.safeParse(r).success).toBe(true);
  });

  it('a failed tile reports its months as null (not checked), never as 0, and names the failure (decision 25)', async () => {
    const h = createHarness({ fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-23', FIXTURE_RULES.upstream, 3)]);
    const r = await h.drive(
      coverageCheckWith(buildContext(h.deps, h.options), 'fixture', discoveryOf(h.fixture), req),
    );
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: null, cellsInBand: 16 },
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.notes).toContain('LHR→JFK: a fixture tile failed (upstream); its months are not checked');
  });

  it('cells a page cap left unread are not checked: their months are null with a note, never a low count (arch-r2-001)', async () => {
    // why: the November LHR tile stops at its page cap after reading one row; the adapter reports the rest as unread
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) => {
          if (
            r.kind !== 'tile' ||
            r.coveredCells[0]?.origin !== LHR ||
            r.coveredCells[0].departureDate !== '2026-11-23'
          )
            return r;
          const [kept] = r.prices;
          const read = new Set(kept === undefined ? [] : [cellKeyString(kept)]);
          return {
            ...r,
            truncated: true,
            prices: kept === undefined ? [] : [kept],
            cellIssues: r.coveredCells
              .filter((cell) => !read.has(cellKeyString(cell)))
              .map((cell) => ({
                cell,
                reason: 'upstream' as const,
                offersDropped: 0,
                detail: 'pagination truncated at 3 pages',
              })),
          };
        }),
    });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: null, cellsInBand: 16 },
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.pairs[1]?.months.map((m) => m.cachedRows)).toEqual([16, 12]);
    expect(r.notes).toContain(
      'LHR→JFK: a fixture tile stopped at its page cap; its months are not fully checked',
    );
    expect(r.calls).toBe(4); // tiles requested
  });

  it('a cell named in cellIssues without a price is not checked even when the tile was read to the end', async () => {
    const dropped = c('2026-12-01', '2026-12-08');
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile' || !r.coveredCells.some((x) => cellKeyString(x) === cellKeyString(dropped))
            ? r
            : {
                ...r,
                prices: r.prices.filter((x) => cellKeyString(x) !== cellKeyString(dropped)),
                cellIssues: [
                  { cell: dropped, reason: 'parse', offersDropped: 1, detail: 'a row without a price' },
                ],
              },
        ),
    });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs[0]?.months.find((m) => m.month === '2026-12')?.cachedRows).toBeNull();
    expect(r.notes).toContain(
      'LHR→JFK: a fixture tile could not read every row; its months are not fully checked',
    );
  });
});

describe('daily system jobs', () => {
  it('maintenance deletes expired cache rows and old cache-hit rows of monthly providers, keeps a lifetime provider’s rows (test-strategy-020)', () => {
    const h = createHarness();
    h.deps.cache.set('a'.repeat(64), { a: 1 }, 60, h.clock.now()); // a 60-second entry, expired an hour later
    const now = h.clock.now();
    h.clock.set(asIsoDateTime('2026-06-01T00:00:00.000Z'));
    h.deps.budget.recordCacheHit({
      providerId: 'fixture',
      executionId: null,
      tileIndex: null,
      endpointPath: '/old',
    });
    h.clock.set(now);
    h.clock.advance(HOUR);
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is the only provider; a lifetime window is set on its limits to show those rows are kept
    const lifetime = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), window: 'lifetime' as const }),
    };
    expect(runMaintenanceJob(lifetime)).toMatchObject({ cacheRowsDeleted: 1, ledgerRowsPruned: 0 });
    expect(h.count('provider_requests')).toBe(1);
    const r = runMaintenanceJob(ctx);
    expect(r).toMatchObject({ cacheRowsDeleted: 0, ledgerRowsPruned: 1 });
    expect(r.dbBytes).toBeGreaterThan(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(h.logs.filter((l) => l.msg === 'maintenance')).toHaveLength(2); // db's own line; the engine adds none (arch-024)
  });

  it('fx-refresh as a system job refreshes rates; a failure is logged, not thrown', async () => {
    // why: the fx limits allow one call every 6 s (10 a minute); fake timers keep the two refreshes instant
    const h = createHarness({ fakeTimers: true });
    let body: unknown = frankfurterBody({ USD: 1.27 });
    stubFrankfurter(() => Response.json(body));
    await h.drive(runSystemJob(buildContext(h.deps, h.options), 'fx-refresh'));
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).not.toBeNull();
    body = { base: 'EUR' };
    await expect(
      h.drive(runSystemJob(buildContext(h.deps, h.options), 'fx-refresh')),
    ).resolves.toBeUndefined();
    expect(h.logs.some((l) => l.msg === 'system job failed' && l.fields.job === 'fx-refresh')).toBe(true);
  });
});
