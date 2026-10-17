import { asIsoDate, asIsoDateTime, cellKeyString, isTruncated } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { newRun } from '../src/run.js';
import { buildSnapshot } from '../src/snapshot.js';
import { commitTile, discoveryQuery } from '../src/stages/discovery.js';
import { applyReuse, reuseCriteriaFor, reuseCutoff, skipBlockedDiscovery } from '../src/stages/reuse.js';
import {
  createHarness,
  discoveryOf,
  expectedTiles,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LHR,
  tileRule,
} from './support/harness.js';
import { mapTiles } from './support/wrappers.js';

/** Every price row of an execution, reused copies included, as (cell, fetched_at, reused_from). */
const allPriceRows = (h: Harness, executionId: string) =>
  h.db.raw
    .prepare<[string], { cell: string; f: string; ru: string | null }>(
      `SELECT origin || '|' || destination || '|' || departure_date || '|' || return_date AS cell, fetched_at AS f, reused_from_execution_id AS ru
         FROM calendar_prices WHERE execution_id = ? ORDER BY cell`,
    )
    .all(executionId);

describe('reuseCutoff (spec §8.2 "reuse iff age < 0.9 × refresh")', () => {
  it('is now minus 0.9 × refresh hours', () => {
    expect(reuseCutoff(asIsoDateTime('2026-10-14T09:00:00.000Z'), 168)).toBe('2026-10-08T01:48:00.000Z'); // 151.2 h earlier
  });
});

describe('reuse per cell (spec §8.1 "reuse, per cell")', () => {
  it('at 151 h every searched cell is copied with its original fetchedAt and the fetching execution; no tile is requested', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(151 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(0);
    const o2 = h.outcomes(two.id, { stage: 'discovery' });
    expect(o2).toHaveLength(28);
    expect(o2.every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    const byCell = new Map(h.outcomes(one.id, { stage: 'discovery' }).map((o) => [cellKeyString(o), o]));
    for (const o of o2) {
      const first = byCell.get(cellKeyString(o));
      expect(o.status).toBe(first?.status);
      expect(o.fetchedAt).toBe(first?.fetchedAt);
      expect(o.minPence).toBe(first?.minPence);
    }
    const p1 = allPriceRows(h, one.id);
    const p2 = allPriceRows(h, two.id);
    expect(p2.map(({ cell, f }) => ({ cell, f }))).toEqual(p1.map(({ cell, f }) => ({ cell, f }))); // same cells, same fetched_at
    expect(p2.every((r) => r.ru === one.id)).toBe(true);
    expect(h.repos.calendarPrices.fetchedBy(two.id)).toEqual([]); // fetchedBy excludes reused rows
  });

  it('never reuses a price from a truncated tile: the next run fetches the cell again and keeps the label (decision 45)', async () => {
    // why: the first tile stops at its page cap; a copy would drop "cheapest of the rows read" (prov-wp07-r3-001)
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) => (r.kind === 'tile' && r.index === 0 ? { ...r, truncated: true } : r)),
    });
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    const truncated = new Set(
      h
        .outcomes(one.id, { stage: 'discovery', status: 'priced' })
        .filter((o) => isTruncated(o.lastError))
        .map(cellKeyString),
    );
    expect(truncated.size).toBe(14);
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(1);
    const o2 = h.outcomes(two.id, { stage: 'discovery' });
    expect(
      o2.filter((o) => truncated.has(cellKeyString(o))).every((o) => o.reusedFromExecutionId === null),
    ).toBe(true);
    expect(
      o2.filter((o) => !truncated.has(cellKeyString(o))).every((o) => o.reusedFromExecutionId === one.id),
    ).toBe(true);
    expect(o2.filter((o) => isTruncated(o.lastError))).toHaveLength(14);
  });

  it('at 152 h nothing is reused and every tile is requested again', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(152 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(expectedTiles(h, def));
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('age is elapsed time, not wall-clock days: across the spring change 150.5 h reuses and 151.5 h does not (test-strategy-007)', async () => {
    // why: 22 → 28 March 2027 crosses the UK spring change; a cutoff taken in London wall-clock time would sit at 150.2
    // elapsed hours and refuse the 150.5 h case, so only millisecond arithmetic passes both
    const start = asIsoDateTime('2027-03-22T05:00:00.000Z');
    for (const [hours, reused] of [
      [150.5, true],
      [151.5, false],
    ] as const) {
      const h = createHarness({ now: start });
      const def = h.createDefinition({
        window: { kind: 'absolute', from: asIsoDate('2027-05-03'), to: asIsoDate('2027-05-05') },
      });
      await h.runToCompletion(h.orch(), def.id);
      h.clock.advance(hours * HOUR);
      const two = await h.runToCompletion(h.orch(), def.id);
      expect(h.outcomes(two.id).every((o) => (o.reusedFromExecutionId !== null) === reused)).toBe(true);
      await h.close();
    }
  });

  it('never copies error outcomes: those cells are fetched again, the rest are reused', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3)]);
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    const errored = new Set(h.outcomes(one.id, { status: 'error' }).map(cellKeyString));
    expect(errored.size).toBe(14);
    h.clock.advance(2 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    for (const o of h.outcomes(two.id, { stage: 'discovery' }))
      expect(o.reusedFromExecutionId).toBe(errored.has(cellKeyString(o)) ? null : one.id);
  });

  it('never copies not_run outcomes of an interrupted run', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const first = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    h.clearHooks();
    const notRun = new Set(h.outcomes(r.executionId, { status: 'not_run' }).map(cellKeyString));
    expect(notRun.size).toBe(14);
    const second = h.orch();
    expect(await second.cancel(r.executionId)).toBe(true); // frees the definition for a new run
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(second, def.id);
    for (const o of h.outcomes(two.id))
      expect(o.reusedFromExecutionId).toBe(notRun.has(cellKeyString(o)) ? null : r.executionId);
  });

  it('refuses on a cabin change', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.repos.definitions.update(def.id, { cabin: 'premium_economy' });
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('refuses another definition’s prices for the same cells', async () => {
    const h = createHarness();
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    h.clock.advance(HOUR);
    const other = await h.runToCompletion(h.orch(), h.createDefinition({ name: 'another' }).id);
    expect(h.outcomes(other.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('refuses on a point of sale or source kind other than the stored rows’ (the criteria reach the repository)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const ctx = buildContext(h.deps, h.options);
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
    const info = discoveryOf(h.fixture).info;
    expect(reuseCriteriaFor(ctx, exec.snapshot, 'fixture', info)).toEqual({
      pointOfSale: 'unknown',
      sourceKind: 'synthetic',
      newerThan: reuseCutoff(h.clock.now(), 168),
    });
    expect(applyReuse({ ...ctx, pointOfSaleOf: () => 'GB' }, run, 'fixture', info)).toBe(0);
    expect(applyReuse(ctx, run, 'fixture', { ...info, sourceKind: 'authorised-cached' })).toBe(0);
    expect(h.outcomes(one.id).length).toBe(28);
    await h.releaseHolds();
  });

  it('a copy of a copy still names the execution that fetched the price', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const three = await h.runToCompletion(h.orch(), def.id);
    expect(h.outcomes(three.id).every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    const firstFetch = new Map(allPriceRows(h, one.id).map((r) => [r.cell, r.f]));
    expect(allPriceRows(h, three.id).every((r) => r.ru === one.id && r.f === firstFetch.get(r.cell))).toBe(
      true,
    );
  });

  it('a fresh price supersedes a reused row in the same transaction (spec §7)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const cap = discoveryOf(h.fixture);
    const q = discoveryQuery(two.snapshot, LHR, JFK, h.outcomes(two.id, { stage: 'discovery' }));
    const tile = cap.plan(q)[0];
    if (tile === undefined) throw new Error('fixture planned no tile');
    const result = await cap.fetchTile(tile, q, {
      executionId: two.id,
      signal: new AbortController().signal,
      recordFixtures: false,
    });
    if (result.kind !== 'tile') throw new Error('expected a tile');
    commitTile(
      ctx,
      newRun(ctx, two, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      cap.info,
      result,
    );
    const pricedNow = new Set(result.prices.map(cellKeyString));
    expect(pricedNow.size).toBe(14);
    const rows = allPriceRows(h, two.id).filter((r) => pricedNow.has(r.cell));
    expect(rows.length).toBe(pricedNow.size); // one row per cell: the reused row is gone, not duplicated
    expect(rows.every((r) => r.ru === null)).toBe(true);
  });
});

describe('the point of sale reuse matches on (arch-r2-013)', () => {
  it('is the one the provider echoes on what it fetched, so a reuse match is never refused for it', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const expected = buildContext(h.deps, h.options).pointOfSaleOf('fixture');
    const priced = h.outcomes(e.id, { status: 'priced' });
    expect(priced).toHaveLength(28);
    expect(priced.every((o) => o.pointOfSale === expected)).toBe(true);
    expect(h.repos.calendarPrices.fetchedBy(e.id).every((r) => r.pointOfSale === expected)).toBe(true);
  });

  it('a blocked discovery line copies its reusable cells before the rest become skipped:budget (ruling 2, ssr I2)', async () => {
    const h = createHarness({ fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-09', FIXTURE_RULES.upstream, 3)]);
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    expect(h.outcomes(one.id, { status: 'priced' })).toHaveLength(14);
    h.clock.advance(HOUR);
    const ctx = buildContext(h.deps, h.options);
    const { snapshot, cells } = buildSnapshot(ctx, def);
    // why: the seeding transaction of a start (or a resume's claim) as the engine runs it, with the line blocked
    const e = ctx.db.immediateTransaction(() => {
      const created = h.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot,
        estimate: null,
        trigger: 'manual',
        status: 'running',
      });
      h.repos.cells.seed(created.id, cells, ['fixture']);
      expect(
        skipBlockedDiscovery(
          ctx,
          { executionId: created.id, definitionId: def.id, snapshot, manual: false },
          'fixture',
        ),
      ).toBe(14);
      return created;
    });
    const after = h.outcomes(e.id, { stage: 'discovery' });
    expect(after.filter((o) => o.reusedFromExecutionId === one.id)).toHaveLength(14);
    expect(after.filter((o) => o.status === 'skipped' && o.reason === 'budget')).toHaveLength(14);
    expect(after.filter((o) => o.status === 'not_run')).toHaveLength(0);
  });
});
