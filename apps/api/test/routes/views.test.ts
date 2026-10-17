// Spec §10 calendar, duration analysis, coverage, calendar gap and cell detail (Views B, C, D and the side panel).
import { apiContract, asIata, daysBetween, generateCells } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSpace } from '../../src/read/space.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

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

describe('GET /api/definitions/:id/calendar (spec §10, View B)', () => {
  it('per day: six buckets per provider, selection, the three cheapest, stale thresholds', async () => {
    const { x, def } = await world();
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    const space = currentSpace(def, x.clock.todayLondon());
    expect(cal.days).toHaveLength(daysBetween(space.departureFrom, space.departureTo) + 1);
    expect(cal.staleAfterHours).toBe(192);
    expect(cal.calendarStaleAfterHours.fixture).toBe(168);
    const day = (d: string) => cal.days.find((y) => y.date === d);
    expect(day('2026-11-02')?.discovery).toEqual([
      {
        providerId: 'fixture',
        buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
        total: 1,
      },
    ]);
    expect(day('2026-11-02')?.verification).toEqual({
      selected: 1,
      itinerarySearched: 1,
      onDemand: 0,
      unconfirmedCells: 0,
    });
    expect(day('2026-11-02')?.cheapestVerified).toMatchObject({
      pricePence: 60_000,
      itineraryHash: 'hV',
      truncated: false,
    });
    expect(day('2026-11-02')?.cheapestCalendar?.pricePence).toBe(45_000);
    expect(day('2026-11-02')?.cheapestPartiallyVerified).toBeNull();
    expect(Object.keys(day('2026-11-02') ?? {})).not.toContain('byDestination'); // decision 58
    expect(day('2026-11-03')?.discovery[0]?.buckets.no_data).toBe(1);
    expect(day('2026-11-03')?.cheapestPartiallyVerified).toMatchObject({
      pricePence: 40_000,
      count: 1,
      itineraryHash: 'hP',
    });
    expect(day('2026-11-04')?.discovery[0]?.buckets.empty).toBe(1);
    expect(day('2026-11-04')?.cheapestVerified).toBeNull(); // why: hF is class failed
    expect(day('2026-11-05')?.discovery[0]?.buckets.error).toBe(1);
  });

  it('an offer whose price the final step did not confirm is never a cheapest itinerary-search price (decisions 45, 48)', async () => {
    const { x, def, s } = await world();
    s.verified('E1', C2, [
      { hash: 'hX', pricePence: 20_000, fetchedAt: at(-1), baggage: null, confirmed: false },
    ]);
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    expect(cal.days.find((d) => d.date === '2026-11-03')?.cheapestPartiallyVerified).toMatchObject({
      itineraryHash: 'hP',
    });
  });

  it('counts a selected cell whose itinerary search priced but confirmed no price (decision 51)', async () => {
    const { x, def, s } = await world();
    s.execution('E2', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.4) });
    s.cells('E2', [C4], { selected: [{ cell: C4, reason: 'always_include' }] });
    s.verified('E2', C4, [{ hash: 'hU', pricePence: 20_000, fetchedAt: at(-0.4), confirmed: false }]);
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    const day = cal.days.find((d) => d.date === '2026-11-05');
    expect(day?.verification).toMatchObject({ selected: 1, itinerarySearched: 1, unconfirmedCells: 1 });
    expect(day?.cheapestVerified).toBeNull();
    const other = cal.days.find((d) => d.date === '2026-11-03');
    expect(other?.verification.unconfirmedCells).toBe(0); // why: hP's price is confirmed
  });
});

describe('calendar selection rules (plan decisions 53, 54; review prov-009)', () => {
  const calendar = (x: Harness, defId: string, query = '') =>
    get(
      x,
      `/api/definitions/${defId}/calendar${query}`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
  async function bare(destinations = ['JFK']) {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ destinations: destinations.map(asIata) }),
    );
    return { x, s, def };
  }

  it('with destination=, buckets, selection and minima count that destination only; 422 for another', async () => {
    const { x, s, def } = await bare(['JFK', 'EWR']);
    const J = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    const E = cell('LHR', 'EWR', '2026-11-02', '2026-11-12');
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [J, E], { selected: [J, E].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.tile('E1', J, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
    s.tile('E1', E, { status: 'priced', pricePence: 35_000, fetchedAt: at(-1), tileIndex: 1 });
    s.verified('E1', J, [{ hash: 'hJ', pricePence: 60_000, fetchedAt: at(-1) }]);
    s.verified('E1', E, [{ hash: 'hE', pricePence: 50_000, fetchedAt: at(-1) }]);
    const both = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect([
      both?.cheapestVerified?.pricePence,
      both?.verification.selected,
      both?.discovery[0]?.total,
    ]).toEqual([50_000, 2, 2]);
    const jfk = (await calendar(x, def.id, '?destination=JFK')).days.find((d) => d.date === '2026-11-02');
    expect([jfk?.cheapestVerified?.pricePence, jfk?.cheapestCalendar?.pricePence]).toEqual([60_000, 45_000]);
    expect([jfk?.verification.selected, jfk?.discovery[0]?.total]).toEqual([1, 1]);
    const bos = await x.request(`/api/definitions/${def.id}/calendar?destination=BOS`);
    expect(bos.status).toBe(422);
    expect((await errorOf(bos)).code).toBe('unknown_destination');
  });

  it('prefers a price the newest search returned over a cheaper one it did not, and marks the latter', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hOld', pricePence: 55_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hNew', pricePence: 65_000, fetchedAt: at(-1) }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hNew', notSeenInLatest: null });
    const gap = await get(
      x,
      `/api/definitions/${def.id}/calendar-gap`,
      '/api/definitions/:id/calendar-gap',
      apiContract.calendarGapResponseSchema,
    );
    expect(gap.cheapestVerified).toMatchObject({ itineraryHash: 'hNew', notSeenInLatest: null });
  });

  it('prefers a fresh price over a cheaper stale one on the same day', async () => {
    const { x, s, def } = await bare();
    const C1b = cell('LHR', 'JFK', '2026-11-02', '2026-11-13');
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1, C1b], { selected: [C1, C1b].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hStale', pricePence: 50_000, fetchedAt: at(-250) }]); // 250 h > 192
    s.verified('E1', C1b, [{ hash: 'hFresh', pricePence: 58_000, fetchedAt: at(-1) }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hFresh', stale: false });
  });

  it('a fresh offer from another seller is shown before a cheaper stale offer of the same itinerary (decision 58)', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hS', pricePence: 40_000, fetchedAt: at(-250), seller: 'Stale Air' }, // 250 h > 192
      { hash: 'hS', pricePence: 42_000, fetchedAt: at(-1), seller: 'Fresh Travel' },
    ]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hS', pricePence: 42_000, stale: false });
  });

  it('a confirmed £400 offer is the cheapest even when the same itinerary has an unconfirmed £380 offer', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hD', pricePence: 40_000, fetchedAt: at(-1), seller: 'Confirmed Air' },
      { hash: 'hD', pricePence: 38_000, fetchedAt: at(-1), seller: 'Unconfirmed Travel', confirmed: false },
    ]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hD', pricePence: 40_000 });
    expect(day?.verification.unconfirmedCells).toBe(0);
  });

  it("unconfirmedCells follows the latest run: an older run's confirmed price does not hide it", async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hC', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hU', pricePence: 55_000, fetchedAt: at(-1), confirmed: false }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.verification.unconfirmedCells).toBe(1);
  });
});

describe('GET /api/definitions/:id/duration-analysis (spec §10, View C)', () => {
  it('per nights: minimum with its cell and n, calendar per provider, searched per series, gaps as null / empty', async () => {
    const { x, def } = await world();
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    expect(d.byNights.map((n) => n.nights)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    const ten = d.byNights[0];
    expect(ten?.minVerified).toMatchObject({ n: 1, pricePence: 60_000, cell: { ...C1, nights: 10 } });
    expect(ten?.minCalendar).toEqual([
      expect.objectContaining({
        providerId: 'fixture',
        n: 1,
        price: expect.objectContaining({ pricePence: 45_000 }),
      }),
    ]);
    // why: WP10's per-series counts: three of the four selected 10-night cells were itinerary-searched (C4 was not
    // reached); the fixture answered C1, C2 and C3 of every 10-night cell of the window (C4's tile failed)
    const tenTotal = generateCells(currentSpace(def, x.clock.todayLondon())).filter(
      (c) => c.nights === 10,
    ).length;
    expect(ten?.searched).toEqual({
      verification: { searched: 3, total: 4 },
      discovery: [{ providerId: 'fixture', searched: 3, total: tenTotal }],
    });
    expect(d.byNights[1]).toMatchObject({
      nights: 11,
      minVerified: null,
      minCalendar: [],
      searched: {
        verification: { searched: 0, total: 0 },
        discovery: [{ providerId: 'fixture', searched: 0, total: tenTotal }],
      },
    });
  });
});

describe('superseded calendar prices on the views (decision 54, WP10 Task 10.1 shapes)', () => {
  it('a day, a stay length and the cell detail mark a price a later search found empty, and prefer a current one', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const C1b = cell('LHR', 'JFK', '2026-11-02', '2026-11-13'); // same day, 11 nights
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1, C1b]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.tile('Eold', C1b, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1, C1b]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    s.tile('Enew', C1b, { status: 'priced', pricePence: 52_000, fetchedAt: at(-2), tileIndex: 1 });
    const day = (
      await get(
        x,
        `/api/definitions/${def.id}/calendar`,
        '/api/definitions/:id/calendar',
        apiContract.calendarResponseSchema,
      )
    ).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestCalendar).toMatchObject({ pricePence: 52_000, superseded: false });
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    // why: the duration reads the latest parent's own fetches, so the 10-night minimum is gone, not superseded
    expect(d.byNights.find((n) => n.nights === 10)?.minCalendar).toEqual([]);
    const detail = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      apiContract.cellDetailResponseSchema,
    );
    expect(detail.calendarPrices.map((p) => [p.pricePence, p.superseded])).toEqual([[30_000, true]]);
  });
});

describe('duration analysis over one set of executions (review prov-012)', () => {
  it('counts a cell the latest run reused as searched and takes its reused price as the minimum (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 41_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1, C2]);
    s.reuse('Enew', 'Eold', [C1], at(-100));
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-1), tileIndex: 1 });
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    const ten = d.byNights.find((n) => n.nights === 10);
    expect(ten?.minCalendar.map((m) => [m.price.pricePence, m.n])).toEqual([[41_000, 2]]);
    expect(ten?.searched.discovery[0]?.searched).toBe(2);
  });

  it("an older run's price is neither a minimum nor marks a nights value searched once a newer run skipped it", async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-29) });
    s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C2], { selected: [{ cell: C2, reason: 'top_n' }] });
    s.verified('E2', C2, [{ hash: 'hW', pricePence: 61_000, fetchedAt: at(-1) }]);
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    const ten = d.byNights.find((n) => n.nights === 10);
    expect(ten?.minVerified).toMatchObject({ pricePence: 61_000, n: 1, cell: { ...C2, nights: 10 } });
    expect(ten?.minVerified?.cell.departureDate).toBe('2026-11-03');
    expect(ten?.searched.verification).toEqual({ searched: 1, total: 1 });
    expect(ten?.minCalendar).toEqual([]);
    expect(ten?.searched.discovery.map((s) => s.searched)).toEqual([0]);
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
    expect(cov.summary).toEqual({
      buckets: { priced: 1, empty: 1, no_data: 1, error: 1, skipped: 0, not_run: 0, reused: 0 },
      total: 4,
      selected: 4,
      itinerarySearched: 3,
      onDemand: 0,
      reused: 0,
    });
    expect(cov.perStage.find((p) => p.stage === 'discovery')).toMatchObject({
      providerId: 'fixture',
      total: 4,
      requests: { calls: 0, cacheHits: 0, costMicroGbp: 0, planCalls: null },
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
      .mockReturnValue({ ok: true, maxCalls: 6, headroomCalls: 994 });
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
    expect(d.verify).toEqual({ maxCalls: 6, headroomCalls: 994 });
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
