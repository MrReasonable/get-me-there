import { type CellKey, cellKeyString, generateCells } from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { buildSnapshot } from '../src/snapshot.js';
import { planTiles } from '../src/stages/discovery.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  JFK,
  LGW,
  LHR,
  T0,
  tileRule,
  WINDOW,
} from './support/harness.js';
import { dropPlanCell, mapTiles } from './support/wrappers.js';

const FIRST = '2026-11-02'; // WP4 tiles: 7 departure days from WINDOW.from
const SECOND = '2026-11-09';
const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const keys = (cells: readonly CellKey[]) => cells.map(cellKeyString).sort();

/** The fixture's own tile for `origin` → JFK over WINDOW that starts on `departFrom`: its covered cells. */
function tileCells(h: Harness, origin: typeof LHR, departFrom: string): CellKey[] {
  const cells = generateCells({
    origins: [origin],
    destinations: [JFK],
    departureFrom: WINDOW.from,
    departureTo: WINDOW.to,
    minNights: 7,
    maxNights: 8,
  });
  const tiles = discoveryOf(h.fixture).plan({
    origin,
    destination: JFK,
    departureFrom: WINDOW.from,
    departureTo: WINDOW.to,
    minNights: 7,
    maxNights: 8,
    cabin: 'economy',
    currency: 'GBP',
    cells,
  });
  const t = tiles.find((x) => x.request.kind === 'rectangle' && x.request.departFrom === departFrom);
  if (t === undefined) throw new Error(`no fixture tile starts ${departFrom}`);
  return t.coveredCells;
}
const lhrTile = (h: Harness, departFrom: string) => tileCells(h, LHR, departFrom);

/** LHR and LGW → JFK under WP4 rules; fake timers drive http-kit's backoff; one tile at a time unless `opts` says otherwise. */
async function run(rules: FixtureRule[], opts: HarnessOptions = {}) {
  // why: http-kit serialises fixture calls, so "consecutive" is deterministic for the parse-streak rows
  const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true, ...opts });
  await h.fixtureScenario(rules);
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const e = await h.runToCompletion(
    h.track(createOrchestrator(ctx)),
    h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id,
  );
  return { h, e, scheduleResume };
}

describe('error table, discovery stage: retryable kinds after retries (cell error, attempts+1, continue)', () => {
  it.each([
    ['rate-limit', FIXTURE_RULES.rateLimit],
    ['upstream', FIXTURE_RULES.upstream],
    ['network', FIXTURE_RULES.network],
  ] as const)('%s', async (reason, respond) => {
    const { h, e } = await run([tileRule('LHR', FIRST, respond, 3)]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(
      errors.every(
        (o) => o.reason === reason && o.attempts === 1 && o.lastError !== null && !o.lastError.includes('?'),
      ),
    ).toBe(true);
    expect(h.outcomes(e.id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});

describe('error table, discovery stage: non-retryable kinds', () => {
  it.each([
    ['parse (HTTP 400 with the vendor message)', FIXTURE_RULES.badRequest, 'parse'],
    ['parse (malformed 200 body)', FIXTURE_RULES.malformed, 'parse'],
    ['upstream (HTTP 404)', FIXTURE_RULES.notFound, 'upstream'],
  ] as const)('%s → error once, the run continues', async (_n, respond, reason) => {
    const { h, e } = await run([tileRule('LHR', FIRST, respond, 1)]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(errors.every((o) => o.reason === reason && o.attempts === 1)).toBe(true);
  });

  it('tile-error marks exactly its own cells (the second LHR tile)', async () => {
    const { h, e } = await run([tileRule('LHR', SECOND, FIXTURE_RULES.upstream, 3)]);
    expect(keys(h.outcomes(e.id, { stage: 'discovery', status: 'error' }))).toEqual(keys(lhrTile(h, SECOND)));
  });

  it('two consecutive parse errors disable the provider: remaining cells skipped:provider_disabled, paused_error, notified', async () => {
    const { h, e } = await run([
      tileRule('LHR', FIRST, FIXTURE_RULES.badRequest, 1),
      tileRule('LHR', SECOND, FIXTURE_RULES.badRequest, 1),
    ]);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === 'parse')).toBe(true);
    const skipped = h.outcomes(e.id, { status: 'skipped' });
    expect(skipped.length).toBe(28); // both LGW tiles (14 cells each)
    expect(skipped.every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
  });

  it('a parse error, a success, then a parse error is not "two consecutive"', async () => {
    const { h, e } = await run([
      tileRule('LHR', FIRST, FIXTURE_RULES.badRequest, 1),
      tileRule('LGW', FIRST, FIXTURE_RULES.badRequest, 1),
    ]);
    expect(e.status).toBe('completed');
    // why: both rules matched (test-strategy-reviewer-028): the two parse errors happened, with a success between them
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(keys(errors)).toEqual(keys([...lhrTile(h, FIRST), ...tileCells(h, LGW, FIRST)]));
    expect(errors.every((o) => o.reason === 'parse')).toBe(true);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it.each([
    ['auth', FIXTURE_RULES.auth],
    ['quota', FIXTURE_RULES.quota],
  ] as const)(
    '%s on any call disables the provider for the run; none remain → paused_error + notify',
    async (reason, respond) => {
      const { h, e } = await run([tileRule('LHR', FIRST, respond, 1)]);
      expect(e.status).toBe('paused_error');
      expect(keys(h.outcomes(e.id, { status: 'error' }))).toEqual(keys(lhrTile(h, FIRST)));
      expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === reason)).toBe(true);
      const skipped = h.outcomes(e.id, { status: 'skipped' });
      expect(skipped.length).toBe(42);
      expect(skipped.every((o) => o.reason === 'provider_disabled')).toBe(true);
      expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
    },
  );

  it('a disabled provider stops taking tiles, but a tile already in flight finishes and is written (decision 25)', async () => {
    const h = createHarness({ fixtureConcurrency: 2, fakeTimers: true });
    await h.fixtureScenario([
      tileRule('LGW', FIRST, FIXTURE_RULES.hold, 1),
      tileRule('LHR', FIRST, FIXTURE_RULES.auth, 1),
    ]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LGW, LHR], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.outcomes(r.executionId, { status: 'error' }).length).toBeGreaterThan(0));
    // why: the LGW tile must be held, in flight, before the release; one requested after it would not be in flight
    // when the provider was disabled (test-strategy-reviewer-r3-004)
    await vi.waitFor(() =>
      expect(h.requests.some((q) => q.kind === 'calendar' && q.pair === 'LGW-JFK')).toBe(true),
    );
    await h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_error');
    const lgwFirst = h.outcomes(e.id).filter((o) => o.origin === LGW && o.departureDate < SECOND);
    expect(lgwFirst.length).toBe(14);
    expect(lgwFirst.every((o) => o.status === 'priced')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
  });

  it('limiter-timeout: the cells return to not_run; paused_error with resume_after; a one-shot job is requested', async () => {
    const { h, e, scheduleResume } = await run([tileRule('LHR', FIRST, FIXTURE_RULES.limiterTimeout, 3)]);
    expect(e.status).toBe('paused_error');
    const at = addSeconds(T0, 4000);
    expect(e.resumeAfter).toBe(at);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, at);
    // why: one tile at a time, so the held tile's cells and every tile after it are exactly the not_run set
    const notRun = h.outcomes(e.id, { status: 'not_run' });
    expect(notRun).toHaveLength(56);
    expect(keys(notRun)).toEqual(keys(h.outcomes(e.id)));
    expect(keys(notRun)).toEqual(expect.arrayContaining(keys(lhrTile(h, FIRST))));
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_error']);
  });

  it('a plan that does not partition the cells is a wiring error, refused before any call (spec §5.2, ssr-06)', () => {
    const h = createHarness();
    const def = h.createDefinition();
    const ctx = buildContext(h.deps, h.options);
    const b = buildSnapshot(ctx, def);
    expect(() => planTiles('fixture', discoveryOf(dropPlanCell(h.fixture)), b.snapshot, b.cells)).toThrow(
      'does not partition',
    );
    expect(planTiles('fixture', discoveryOf(h.fixture), b.snapshot, b.cells)).toHaveLength(2);
  });

  it('a tile answered for other cells than planned marks the planned cells parse (the engine owns coverage)', async () => {
    const { h, e } = await run([], {
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind === 'tile' && r.index === 0 ? { ...r, coveredCells: r.coveredCells.slice(1) } : r,
        ),
    });
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(errors.every((o) => o.reason === 'parse')).toBe(true);
  });
});

describe('error table: AbortedError (cancel / SIGTERM) → not_run', () => {
  const second = (r: { kind: string; params: Record<string, string> }) =>
    r.kind === 'calendar' && r.params.origin === 'LHR' && r.params.departFrom === SECOND;

  it('cancel mid-run: the held tile and every later tile stay not_run, nothing is written for them, the execution is cancelled', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([tileRule('LHR', SECOND, FIXTURE_RULES.hold, 1)]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some(second)).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const notRun = h.outcomes(e.id, { status: 'not_run' });
    // why: exact set — the held tile plus both LGW tiles (one tile in flight at a time, LHR before LGW)
    expect(keys(notRun)).toEqual(
      keys(h.outcomes(e.id).filter((o) => o.origin === LGW || o.departureDate >= SECOND)),
    );
    expect(notRun.length).toBe(42);
    expect(
      h.repos.calendarPrices
        .fetchedBy(e.id)
        .filter((p) => p.cell.origin === LHR && p.cell.departureDate >= SECOND),
    ).toHaveLength(0);
    // why: the aborted call was reserved, so its ledger row is finalised unknown and still counted (spec §5.3)
    expect(h.ledgerRows(e.id).filter((l) => l.tileIndex === 1)).toEqual([
      expect.objectContaining({ outcome: 'unknown' }),
    ]);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds(h)).toEqual([]);
  });

  it('cancel of an execution that is not running in this process marks it cancelled; of a finished one returns false', async () => {
    const h = createHarness();
    const orch = h.orch();
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(await orch.cancel(done.id)).toBe(false);
    h.repos.executions.setStatus(done.id, 'paused_error', { resumeAfter: null });
    expect(await orch.cancel(done.id)).toBe(true);
    expect(h.repos.executions.get(done.id)?.status).toBe('cancelled');
  });

  it('SIGTERM with a tile in flight: every cell stays not_run, status interrupted', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    await orch.shutdown();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('interrupted');
    const all = h.outcomes(e.id);
    expect(all.length).toBe(28);
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
  });
});
