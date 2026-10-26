// Spec §10 coverage, calendar gap and cell detail (the Dates view's coverage section and the date pair detail's
// per-airport-pair panels; WP19 retired the calendar and duration-analysis routes).
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder, snapshotOf } from '../helpers/seed.js';

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');
const C4 = cell('LHR', 'JFK', '2026-11-05', '2026-11-15');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/**
 * Discovery: C1 priced £450, C2 no data, C3 no fares, C4 error. Selection: all four; C4 not reached.
 * Itinerary search: hV £600 verified (C1), hP £400 partially-verified (C2), hF £300 failed (C3).
 */
async function world() {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({ constraints: { maxStops: 1, checkedBagRequired: true } }),
  );
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2, C3, C4], {
    selected: [
      ...[C1, C2, C3].map((c) => ({ cell: c, reason: 'top_n' as const })),
      { cell: C4, reason: 'always_include' as const },
    ],
  });
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1), tileIndex: 0 });
  s.tile('E1', C2, { status: 'no_data', fetchedAt: at(-1), tileIndex: 1 });
  s.tile('E1', C3, { status: 'empty', fetchedAt: at(-1), tileIndex: 2 });
  s.tileError('E1', [C4], 'upstream', 'HTTP 503');
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
  s.verified('E1', C2, [{ hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null }]);
  s.verified('E1', C3, [{ hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 }]);
  return { x, def, s };
}

const get = <S extends Parameters<typeof expectContract>[3]>(
  x: Harness,
  path: string,
  route: string,
  schema: S,
) => x.request(path).then((r) => expectContract(r, 'GET', route, schema));

// why: WP19 Task 19.8 retired the calendar and duration-analysis routes; their rules were ported to the date-pairs
// route's tests (test/routes/datePairs.test.ts, "ported: …"). The cell route keeps decision 54's mark here.
describe('superseded calendar prices in the cell detail (decision 54, WP10 Task 10.1 shapes)', () => {
  it('the cell detail marks a price a later search found empty', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    const detail = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      apiContract.cellDetailResponseSchema,
    );
    expect(detail.calendarPrices.map((p) => [p.pricePence, p.superseded])).toEqual([[30_000, true]]);
  });
});

describe('GET /api/definitions/:id/coverage (spec §10, View D)', () => {
  it('summary, per stage × provider with requests, selected-but-not-reached, errors with retry, blocked schedule', async () => {
    const { x, def, s } = await world();
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.executionId).toBe(s.id('E1'));
    // why: revision 50: the summary is the per-cell classification over the current space (182 days × 12 nights of
    // one airport pair), so the 2,180 cells the run has no discovery result for count as not searched
    expect(cov.summary).toEqual({
      buckets: { priced: 1, empty: 1, no_data: 1, error: 1, skipped: 0, not_run: 2_180, reused: 0 },
      total: 2_184,
      selected: 4,
      itinerarySearched: 3,
      onDemand: 0,
      reused: 0,
    });
    expect(cov.perStage.find((p) => p.stage === 'discovery')).toMatchObject({
      providerId: 'fixture',
      total: 4,
      requests: { calls: 0, tiles: 0, cacheHits: 0, costMicroGbp: 0, planCalls: null },
      overrun: false,
      parityBreak: false,
    });
    expect(cov.selectedNotReached).toEqual([{ cell: { ...C4, nights: 10 }, reason: 'not_run' }]);
    expect(cov.errors).toEqual([
      expect.objectContaining({
        stage: 'discovery',
        providerId: 'fixture',
        reason: 'upstream',
        lastError: 'HTTP 503',
        attempts: 1,
        retryable: true,
      }),
    ]);
    expect(cov.scheduleBlockedSince).toBeNull();
    expect(cov.onDemand).toEqual([]);
    expect(cov.scheduledOnly).toEqual([]);
  });

  it('names the scheduled_only cells per stage × provider and detail (spec §3, §8.2 rev 36)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1, C2, C3, C4]);
    const leave = (c: typeof C1, detail: 'catch-up-no-browser' | 'outside-browser-window') =>
      x.ports.repos.cells.setOutcome(s.id('E1'), c, 'discovery', 'fixture', {
        status: 'skipped',
        reason: 'scheduled_only',
        skipDetail: detail,
      });
    leave(C1, 'outside-browser-window');
    leave(C2, 'outside-browser-window');
    leave(C3, 'catch-up-no-browser');
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.scheduledOnly).toEqual([
      { stage: 'discovery', providerId: 'fixture', detail: 'catch-up-no-browser', cells: 1 },
      { stage: 'discovery', providerId: 'fixture', detail: 'outside-browser-window', cells: 2 },
    ]);
    const detail = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      apiContract.cellDetailResponseSchema,
    );
    expect(detail.outcomes.map((o) => [o.reason, o.skipDetail])).toEqual([
      ['scheduled_only', 'outside-browser-window'],
    ]);
    // S6, S9: who fetches them is read now (this app runs no browser provider, so nobody will), and only the latest
    // parent run's left cells carry that promise
    expect(cov.browserLeftFor).toBe('no-longer-used');
    expect(detail.browserLeftFor).toBe('no-longer-used');
    expect(detail.latestExecutionId).toBe(s.id('E1'));
  });

  it('S8: the execution response names the firing a row stands for and why a missed one was not caught up', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const row = x.ports.repos.executions.createForFiring({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: snapshotOf(def, at(-31)),
      estimate: null,
      trigger: 'schedule',
      status: 'skipped_missed',
      scheduledFor: at(-30),
      skipCode: 'half-cadence',
    });
    if (row === null) throw new Error('no row');
    const e = await get(
      x,
      `/api/executions/${row.id}`,
      '/api/executions/:id',
      apiContract.executionResponseSchema,
    );
    expect([e.scheduledFor, e.isCatchUp, e.skipCode]).toEqual([at(-30), false, 'half-cadence']);
  });

  it('lists the on-demand children below the parent run, each with its own buckets and ledger (UI-004, ruling 15)', async () => {
    const { x, def, s } = await world();
    s.execution('Ec', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.4), child: C1 });
    s.cells('Ec', [C1], { discovery: [], selected: [{ cell: C1, reason: 'always_include' }] });
    s.verified('Ec', C1, [{ hash: 'hC', pricePence: 47_100, fetchedAt: at(-0.4) }]);
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.executionId).toBe(s.id('E1')); // the parent's table is unchanged
    expect(cov.onDemand).toEqual([
      {
        executionId: s.id('Ec'),
        status: 'completed',
        startedAt: at(-0.5),
        cell: { ...C1, nights: 10 },
        perStage: [
          {
            stage: 'verification',
            providerId: 'fixture',
            buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
            total: 1,
            requests: { calls: 0, cacheHits: 0, costMicroGbp: 0 },
          },
        ],
      },
    ]);
  });

  it('an error on a cell that has since departed is not offered for retry: a resume would refuse it (ssr-004)', async () => {
    const { x, def } = await world();
    x.clock.advance(25 * 24 * 3_600_000); // 2026-11-08: C4 (out 2026-11-05) has departed
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.errors.map((e) => [e.cell.departureDate, e.retryable])).toEqual([['2026-11-05', false]]);
  });

  it('a browser-provider error that a resume would only leave for a later run is offered no Retry: a catch-up, or past the window (R12)', async () => {
    const { x, def, s } = await world();
    const raw = x.ports.db.raw;
    raw.prepare("UPDATE cell_outcomes SET provider_id = 'camoufox' WHERE status = 'error'").run();
    const retry = async () =>
      (
        await get(
          x,
          `/api/definitions/${def.id}/coverage`,
          '/api/definitions/:id/coverage',
          apiContract.coverageResponseSchema,
        )
      ).errors.map((e) => [e.providerId, e.retryable]);
    // inside the window (no stored end: started_at + STUCK_AFTER_HOURS), a resume would fetch it again
    expect(await retry()).toEqual([['camoufox', true]]);
    raw.prepare('UPDATE search_executions SET browser_window_end = ? WHERE id = ?').run(at(-1), s.id('E1'));
    expect(await retry()).toEqual([['camoufox', false]]);
    raw
      .prepare(
        "UPDATE search_executions SET browser_window_end = NULL, trigger = 'schedule', scheduled_for = ?, is_catch_up = 1 WHERE id = ?",
      )
      .run(at(-3), s.id('E1'));
    expect(await retry()).toEqual([['camoufox', false]]);
  });

  it('an error outcome with no recorded reason says so with null, never an empty string (review prov M3)', async () => {
    const { x, def } = await world();
    x.ports.db.raw.prepare("UPDATE cell_outcomes SET reason = NULL WHERE status = 'error'").run();
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.errors.map((e) => [e.reason, e.lastError])).toEqual([[null, 'HTTP 503']]);
  });

  it('404 no_execution before the first run', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const res = await x.request(`/api/definitions/${def.id}/coverage`);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('no_execution');
  });
});

describe('GET /api/definitions/:id/calendar-gap (spec §10, §6.9)', () => {
  it('lists calendar prices below the cheapest class-verified price', async () => {
    const { x, def, s } = await world();
    s.tile('E1', C2, { status: 'priced', pricePence: 70_000, fetchedAt: at(-1), tileIndex: 9 });
    const gap = await get(
      x,
      `/api/definitions/${def.id}/calendar-gap`,
      '/api/definitions/:id/calendar-gap',
      apiContract.calendarGapResponseSchema,
    );
    expect(gap.cheapestVerified).toMatchObject({
      pricePence: 60_000,
      itineraryHash: 'hV',
      provenance: { providerId: 'fixture' },
    });
    expect(gap.cells.map((c) => [c.cell.departureDate, c.calendar.pricePence, c.verifyAvailable])).toEqual([
      ['2026-11-02', 45_000, true],
    ]);
  });
  it('verifyAvailable is what the engine would do for the cell, never a constant (review prov M2)', async () => {
    const { x, def, s } = await world();
    s.tile('E1', C2, { status: 'priced', pricePence: 70_000, fetchedAt: at(-1), tileIndex: 9 });
    const preview = vi
      .spyOn(x.engine, 'childCapPreview')
      .mockReturnValue({ ok: false, code: 'window', message: 'outside the window' });
    const gap = await get(
      x,
      `/api/definitions/${def.id}/calendar-gap`,
      '/api/definitions/:id/calendar-gap',
      apiContract.calendarGapResponseSchema,
    );
    expect(gap.cells.map((c) => c.verifyAvailable)).toEqual([false]);
    expect(preview).toHaveBeenCalledWith(def.id, expect.objectContaining({ departureDate: '2026-11-02' }));
  });
  it('is empty when the definition has no verification provider', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    expect(
      await get(
        x,
        `/api/definitions/${def.id}/calendar-gap`,
        '/api/definitions/:id/calendar-gap',
        apiContract.calendarGapResponseSchema,
      ),
    ).toEqual({ cheapestVerified: null, cells: [] });
  });
});

describe('GET /api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate (spec §10, View B side panel)', () => {
  const route = '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate';
  it("returns the cell's outcomes per stage and provider, its prices with provenance, and the verify cap from the engine", async () => {
    const { x, def, s } = await world();
    const preview = vi
      .spyOn(x.engine, 'childCapPreview')
      .mockReturnValue({ ok: true, maxCalls: 6, headroomCalls: 994, needCalls: 6 });
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.outcomes.map((o) => [o.executionId, o.stage, o.status]).sort()).toEqual([
      [s.id('E1'), 'discovery', 'priced'],
      [s.id('E1'), 'verification', 'priced'],
    ]);
    expect(
      d.calendarPrices.map((p) => [p.pricePence, p.provenance.providerId, p.executionId, p.truncated]),
    ).toEqual([[45_000, 'fixture', s.id('E1'), false]]);
    expect(d.observations.map((o) => [o.itineraryHash, o.pricePence, o.verdictClass])).toEqual([
      ['hV', 60_000, 'verified'],
    ]);
    expect(d.verify).toEqual({ maxCalls: 6, headroomCalls: 994, needCalls: 6 });
    expect(preview).toHaveBeenCalledWith(def.id, C1);
  });
  it('drops a hostile stored booking from the observations it lists (decision 54, review SEC-R2-3)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    const url = 'https://user:pw@evil.example:8443/book';
    s.verified('E1', C1, [
      {
        hash: 'hH',
        pricePence: 50_000,
        fetchedAt: at(-1),
        booking: { kind: 'get', url, host: 'evil.example' },
      },
    ]);
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.observations.map((o) => o.booking)).toEqual([{ kind: 'none' }]);
    expect(JSON.stringify(d)).not.toContain('evil.example');
  });

  it('verify is null without a verification provider', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.verify).toBeNull();
  });
  it('400 on a malformed path parameter', async () => {
    const { x, def } = await world();
    expect((await x.request(`/api/definitions/${def.id}/cells/LHR/JFK/2026-02-30/2026-03-10`)).status).toBe(
      400,
    );
    expect((await x.request(`/api/definitions/${def.id}/cells/LHRX/JFK/2026-11-02/2026-11-12`)).status).toBe(
      400,
    );
  });
});
