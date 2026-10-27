// Spec §10 `/results` scope parameters (WP19 Task 19.2): the date pair, the airports and the journey limit narrow the
// rows and the coverage before the basis is chosen and the rows ranked; their refusals are the date-pairs route's.
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/contract.js';
import { datesOf, pairOf, resultsOf, SCOPE_422, seedDatesWorld } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function world(origins = [LHR, LGW]) {
  const x = await createHarness();
  h = x;
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({ origins, destinations: [JFK, EWR], window: SMALL_WINDOW }),
  );
  seedDatesWorld(x, def, (c) => origins.includes(c.origin));
  return { x, def };
}

describe('/results scoped to a date pair (spec §10)', () => {
  it('narrows rows and coverage before the basis: a date pair priced only by a calendar price opens on the calendar basis', async () => {
    const { x, def } = await world();
    const whole = await resultsOf(x, def.id);
    expect(whole.basis).toBe('verified');
    const r = await resultsOf(x, def.id, '?departureDate=2026-11-04&returnDate=2026-11-14');
    expect(r.basis).toBe('calendar');
    expect(r.cheapest).toMatchObject({
      pricePence: 40_000,
      cell: { departureDate: '2026-11-04', nights: 10 },
    });
    expect(r.rows.every((row) => row.cell.departureDate === '2026-11-04' && row.cell.nights === 10)).toBe(
      true,
    );
    expect([r.total, r.truncated, r.excludedByCurrentSpace]).toEqual([1, false, 0]);
    // the coverage is that date pair's four cells, the counts the board shows for it
    const board = pairOf(await datesOf(x, def.id), '2026-11-04', '2026-11-14');
    expect(r.coverage.total).toBe(4);
    expect(r.coverage.buckets).toEqual(board.buckets);
    expect(r.datePairFigure).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000, truncated: true },
    });
  });

  it('datePairFigure is null without a date pair; with no scope parameter the read is the whole space as before', async () => {
    const { x, def } = await world();
    const r = await resultsOf(x, def.id, '?origins=LHR');
    expect(r.datePairFigure).toBeNull();
    expect(r.rows.every((row) => row.cell.origin === LHR)).toBe(true);
    const whole = await resultsOf(x, def.id);
    expect(whole.datePairFigure).toBeNull();
    expect(whole.coverage.total).toBe(4 * 4 * 12);
  });

  it('origins and maxJourneyMinutes narrow by parseScope: a 601-minute row is left out, 600 and unknown stay', async () => {
    const { x, def } = await world();
    const q = '?departureDate=2026-11-04&returnDate=2026-11-15&basis=verified';
    const all = await resultsOf(x, def.id, q);
    expect(all.rows.map((r) => r.pricePence).sort()).toEqual([48_000, 52_000]);
    const limited = await resultsOf(x, def.id, `${q}&maxJourneyMinutes=600`);
    expect(limited.rows.map((r) => r.pricePence)).toEqual([52_000]);
    expect(limited.datePairFigure).toMatchObject({ origin: 'LHR', journeyMinutes: 600 });
    const lgw = await resultsOf(x, def.id, `${q}&origins=LGW`);
    expect(lgw.rows.map((r) => r.cell.origin)).toEqual(['LGW']);
    expect(lgw.coverage.total).toBe(2);
  });

  it.each([
    { name: 'a departure without a return', query: 'departureDate=2026-11-02', code: 'date_pair_incomplete' },
    { name: 'a return without a departure', query: 'returnDate=2026-11-12', code: 'date_pair_incomplete' },
    {
      name: 'a malformed date',
      query: 'departureDate=2026-11-2&returnDate=2026-11-12',
      code: 'invalid_date_pair',
    },
    {
      name: 'a day that does not exist',
      query: 'departureDate=2026-11-02&returnDate=2026-11-31',
      code: 'invalid_date_pair',
    },
    {
      name: 'a stay outside the nights range',
      query: 'departureDate=2026-11-02&returnDate=2026-11-30',
      code: 'date_pair_outside_space',
    },
    {
      name: 'a departure outside the window',
      query: 'departureDate=2026-11-06&returnDate=2026-11-16',
      code: 'date_pair_outside_space',
    },
    ...SCOPE_422,
  ])('422 for $name', async ({ query, code }) => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ window: SMALL_WINDOW, destinations: [JFK, EWR] }),
    );
    const res = await x.request(`/api/definitions/${def.id}/results?${query}`);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe(code);
  });

  it('?executionId= with a date pair reads that run alone, its coverage the run as the parent', async () => {
    const { x, def } = await world();
    const runs = (await resultsOf(x, def.id)).executions;
    const oldest = runs[runs.length - 1]?.id ?? '';
    const r = await resultsOf(
      x,
      def.id,
      `?executionId=${oldest}&departureDate=2026-11-03&returnDate=2026-11-13`,
    );
    expect(r.executions.map((e) => e.id)).toEqual([oldest]);
    // E1 priced both LHR cells of 3 Nov, 10 nights; the latest run's "no fares" marks one superseded
    expect(r.coverage.buckets.priced).toBe(2);
    expect(r.rows.map((row) => [row.pricePence, row.superseded])).toEqual([
      [50_000, false],
      [28_000, true],
    ]);
  });
});
