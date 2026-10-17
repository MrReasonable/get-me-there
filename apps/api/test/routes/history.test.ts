// Spec §10, §7 history routes: provenance, staleness, truncation and confirmation on every point (decisions 36, 38, 42, 44).
import { apiContract, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

const ITINERARY = apiContract.itineraryHistoryResponseSchema;
const ROUTE = apiContract.routeHistoryResponseSchema;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function world() {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput());
  s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-299) });
  s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.cells('E2', [C1, C2], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-299) }]);
  s.verified('E2', C1, [{ hash: 'hV', pricePence: 59_000, fetchedAt: at(-1), confirmed: false }]);
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-299) });
  s.reuse('E2', 'E1', [C1], at(-400));
  s.tile('E2', C2, {
    status: 'priced',
    pricePence: 47_000,
    fetchedAt: at(-1),
    lastError: TRUNCATED_NOTE,
    tileIndex: 1,
  });
  s.routeLowest({
    origin: 'LHR',
    destination: 'JFK',
    date: '2026-10-13',
    pricePence: 44_000,
    fetchedAt: at(-1),
  });
  return { x, s };
}

describe('history routes (spec §10, §7)', () => {
  it('itinerary history: one series per provider, seller and cabin, points in time order with provenance, stale and confirmation', async () => {
    const { x, s } = await world();
    const body = await expectContract(
      await x.request('/api/itineraries/hV/history'),
      'GET',
      '/api/itineraries/:hash/history',
      ITINERARY,
    );
    expect(body.itineraryHash).toBe('hV');
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ providerId: 'fixture', seller: 'BA', cabin: 'economy' });
    expect(body.series[0]?.points.map((p) => [p.pricePence, p.stale, p.truncated, p.priceConfirmed])).toEqual(
      [
        [60_000, true, false, true],
        [59_000, false, false, false],
      ],
    );
    expect(body.series[0]?.points.every((p) => p.provenance.providerId === 'fixture')).toBe(true);
    // decision 52 (WP10 Task 10.1): the itinerary names its own trip, and each point the run that observed it
    expect(body.cell).toEqual({ ...C1, nights: 10 });
    expect(body.carriers).toEqual(['BA']);
    expect(body.series[0]?.points.map((p) => p.executionId)).toEqual([s.id('E1'), s.id('E2')]);
    const unknown = await x.request('/api/itineraries/nope/history');
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('itinerary_not_found');
  });

  it('route history: one calendar point per execution fetch, reused rows excluded, stale and truncated, and the route-level series by cabin and date', async () => {
    const { x, s } = await world();
    const body = await expectContract(
      await x.request('/api/routes/LHR/JFK/history'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect([body.origin, body.destination]).toEqual(['LHR', 'JFK']);
    expect(
      body.calendarSeries
        .find((c) => c.providerId === 'fixture')
        ?.points.map((p) => [p.pricePence, p.executionId, p.stale, p.truncated]),
    ).toEqual([
      [45_000, s.id('E1'), true, false],
      [47_000, s.id('E2'), false, true],
    ]);
    expect(
      body.routeSeries
        .find((r) => r.providerId === 'fixture' && r.cabin === 'unknown')
        ?.points.map((p) => [p.date, p.pricePence]),
    ).toEqual([['2026-10-13', 44_000]]);
    // decisions 54, 55: a route-level point is stale by its fetch age (the vendor gives the series no age)
    const route = body.routeSeries.find((r) => r.providerId === 'fixture');
    expect(route?.points.map((p) => p.stale)).toEqual([false]);
    x.clock.advance(200 * 3_600_000);
    const later = await expectContract(
      await x.request('/api/routes/LHR/JFK/history'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect(later.routeSeries.find((r) => r.providerId === 'fixture')?.points.map((p) => p.stale)).toEqual([
      true,
    ]);
  });

  it('reads the requested cabin and rejects a bad airport code', async () => {
    const { x } = await world();
    const business = await expectContract(
      await x.request('/api/routes/LHR/JFK/history?cabin=business'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect(business.calendarSeries.every((c) => c.points.length === 0)).toBe(true);
    expect((await x.request('/api/routes/LHRX/JFK/history')).status).toBe(400);
  });
});
