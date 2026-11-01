// Spec revision 55 §10 (WP20 Task 20.9): `GET /definitions/:id/flight-lists?pairs=` answers, per asked date pair in
// order, the figure's airport pair, its search link, the newest list for the figure's cell (`list`) or else the newest
// for another airport pair of the space (`listOtherPair`); `POST` starts a read on demand and maps the engine's
// refusals to their codes; `GET /executions/:id` reports `flights` from the stored plan and the execution's rows.
import { apiContract, asIsoDate, type CellKey, type DefinitionInput, type SearchDefinition } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  vi.restoreAllMocks();
});

const WORKER_ENV = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
  CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef0123456789abcdef',
};
/** Two departure days, ten nights: the date pairs (2 Nov, 12 Nov) and (3 Nov, 13 Nov) over four airport pairs. */
const SPACE: Partial<DefinitionInput> = {
  origins: [LHR, LGW],
  destinations: [JFK, EWR],
  window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-03') },
  minNights: 10,
  maxNights: 10,
};
const ALL = [LHR, LGW].flatMap((o) =>
  [JFK, EWR].flatMap((d) => [cell(o, d, '2026-11-02', '2026-11-12'), cell(o, d, '2026-11-03', '2026-11-13')]),
);
const errorOf = async (res: Response) =>
  z.object({ error: z.object({ code: z.string(), details: z.unknown().optional() }) }).parse(await res.json())
    .error;
const A = cell(LHR, JFK, '2026-11-02', '2026-11-12');
const B = cell(LGW, EWR, '2026-11-03', '2026-11-13');
const B_OTHER = cell(LHR, JFK, '2026-11-03', '2026-11-13');
const PAIRS = '2026-11-02_2026-11-12,2026-11-03_2026-11-13';

/** A search naming camoufox beside the fixture, with fixture prices: A cheapest on LHR–JFK, B on LGW–EWR. */
async function setup(o: { env?: Record<string, string> } = {}) {
  h = await createHarness({ env: { ...WORKER_ENV, ...o.env } });
  const x = h;
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({
      ...SPACE,
      providers: {
        discovery: ['fixture', 'camoufox'],
        verification: [],
        discoveryRefreshHours: { fixture: 168, camoufox: 168 },
      },
    }),
  );
  const s = seeder(x.ports);
  s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E', ALL, { discovery: ['fixture', 'travelpayouts'] });
  s.tile('E', A, { status: 'priced', fetchedAt: at(-2), pricePence: 40_000 });
  s.tile('E', B, { status: 'priced', fetchedAt: at(-2), pricePence: 41_000, tileIndex: 1 });
  return { x, def, s };
}

function list(
  x: Harness,
  def: SearchDefinition,
  c: CellKey,
  o: { fetchedAt: string; executionId?: string | null; failed?: boolean },
) {
  return x.ports.repos.flightLists.insert({
    definitionId: def.id,
    executionId: o.executionId ?? null,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    cabin: 'economy',
    ...c,
    fetchedAt: apiContract.flightListSchema.shape.fetchedAt.parse(o.fetchedAt),
    pointOfSale: 'GB',
    status: o.failed === true ? 'failed' : 'read',
    reason: o.failed === true ? 'network' : null,
    listed: o.failed === true ? null : 'flights',
    minMinor: o.failed === true ? null : 40_000,
    tabMinor: o.failed === true ? null : 40_000,
    cheapestView: o.failed === true ? null : 'cheapest',
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: o.failed === true ? null : 1,
    flights:
      o.failed === true
        ? []
        : [
            {
              departsLocal: '10:15',
              arrivesLocal: '13:20',
              arrivesDayOffset: 0,
              durationMinutes: 485,
              stops: 0,
              carriers: ['Virgin Atlantic'],
              operatedBy: null,
              amountMinor: 40_000,
            },
          ],
  });
}

async function get(x: Harness, defId: string, pairs: string) {
  return x.request(`/api/definitions/${defId}/flight-lists?pairs=${pairs}`);
}

describe('GET /definitions/:id/flight-lists (revision 55 §10)', () => {
  it('answers one entry per asked pair, in order, with the figure airport pair, its list and else another pair list', async () => {
    const { x, def } = await setup();
    list(x, def, A, { fetchedAt: at(-200) });
    list(x, def, B_OTHER, { fetchedAt: at(-1) });
    const res = await get(x, def.id, PAIRS);
    expect(res.status).toBe(200);
    const body = apiContract.flightListsResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      available: true,
      unavailableReason: null,
      refreshHours: 168,
      monthlyPagesLeft: 1500,
      reading: null,
    });
    expect(body.pairs.map((p) => [p.departureDate, p.origin, p.destination])).toEqual([
      ['2026-11-02', LHR, JFK],
      ['2026-11-03', LGW, EWR],
    ]);
    const [a, b] = body.pairs;
    expect(a?.list).toMatchObject({
      origin: LHR,
      destination: JFK,
      ageHours: 200,
      stale: true,
      status: 'read',
      listed: 'flights',
      provenance: {
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        maxAgeHours: 0,
        fx: { converted: false },
        pointOfSale: 'GB',
        cabin: 'economy',
      },
    });
    expect(a?.listOtherPair).toBeNull();
    expect(b?.list).toBeNull();
    expect(b?.listOtherPair).toMatchObject({ origin: LHR, destination: JFK, ageHours: 1, stale: false });
    // why: the fixture's figure is synthetic, so no search link is offered for it
    expect(a?.link).toBeNull();
  });

  it('links a real figure through the allowlist with the install point of sale', async () => {
    const { x, def, s } = await setup();
    s.tile('E', A, {
      status: 'priced',
      fetchedAt: at(-2),
      pricePence: 30_000,
      real: { providerId: 'travelpayouts' },
      tileIndex: 2,
    });
    const body = apiContract.flightListsResponseSchema.parse(
      await (await get(x, def.id, PAIRS.split(',')[0] ?? '')).json(),
    );
    expect(body.pairs[0]?.link?.host).toBe('www.google.com');
    expect(body.pairs[0]?.link?.url).toContain('gl=GB');
  });

  it('is not available without the browser worker configured, naming why', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(
      exampleDefinitionInput({
        ...SPACE,
        providers: { discovery: ['fixture', 'camoufox'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const body = apiContract.flightListsResponseSchema.parse(await (await get(h, def.id, PAIRS)).json());
    expect(body.available).toBe(false);
    expect(body.unavailableReason).toBe('not-configured');
    expect(body.monthlyPagesLeft).toBeNull();
  });

  it.each([
    ['a malformed pair', '2026-11-02_12-11-2026'],
    ['no pair', ''],
    ['51 pairs', Array.from({ length: 51 }, () => '2026-11-02_2026-11-12').join(',')],
  ])('%s is 422 invalid_pairs', async (_name, pairs) => {
    const { x, def } = await setup();
    const res = await get(x, def.id, pairs);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('invalid_pairs');
  });

  it('a search that does not exist is 404', async () => {
    const { x } = await setup();
    expect((await get(x, 'no-such-search', PAIRS)).status).toBe(404);
  });
});

describe('POST /definitions/:id/flight-lists', () => {
  const body = { departureDate: '2026-11-02', returnDate: '2026-11-12' };

  it('answers 202 accepted, after which GET reports the pair being read', async () => {
    const { x, def } = await setup();
    const read = vi
      .spyOn(x.engine, 'readFlightList')
      .mockResolvedValue({ ok: true, done: new Promise(() => undefined) });
    vi.spyOn(x.engine, 'flightReadInFlight').mockReturnValue({
      definitionId: def.id,
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-12'),
    });
    const res = await x.request(`/api/definitions/${def.id}/flight-lists`, { json: body });
    expect(res.status).toBe(202);
    expect(apiContract.readFlightListResponseSchema.parse(await res.json())).toEqual({ accepted: true });
    expect(read).toHaveBeenCalledWith(def.id, body);
    const after = apiContract.flightListsResponseSchema.parse(await (await get(x, def.id, PAIRS)).json());
    expect(after.reading).toEqual({ departureDate: '2026-11-02', returnDate: '2026-11-12' });
  });

  it.each([
    [{ ok: false, code: 'busy' }, 409, 'browser_busy'],
    [{ ok: false, code: 'fresh' }, 409, 'fresh'],
    [{ ok: false, code: 'outside_space' }, 422, 'outside_space'],
    [{ ok: false, code: 'no_price' }, 422, 'no_price'],
    [{ ok: false, code: 'not_found' }, 404, 'definition_not_found'],
    [{ ok: false, code: 'shutting-down' }, 503, 'shutting-down'],
  ] as const)('%o is %i %s', async (refusal, status, code) => {
    const { x, def } = await setup();
    vi.spyOn(x.engine, 'readFlightList').mockResolvedValue(refusal);
    const res = await x.request(`/api/definitions/${def.id}/flight-lists`, { json: body });
    expect(res.status).toBe(status);
    expect((await errorOf(res)).code).toBe(code);
  });

  it('not_available is 409 with its reason', async () => {
    const { x, def } = await setup();
    vi.spyOn(x.engine, 'readFlightList').mockResolvedValue({
      ok: false,
      code: 'not_available',
      reason: 'cabin',
    });
    const res = await x.request(`/api/definitions/${def.id}/flight-lists`, { json: body });
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.code).toBe('not_available');
    expect(err.details).toEqual({ reason: 'cabin' });
  });
});

describe('GET /executions/:id flights (revision 55 §8.1 "What the run reports")', () => {
  it('reports the stored plan with read and failed from the execution newest row per planned cell', async () => {
    const { x, def, s } = await setup();
    // why: nine planned cells to read (the run's own snapshot; a list row is not held to the current space)
    const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
    const planned = Array.from({ length: 9 }, (_, i) => cell(LHR, JFK, day(2 + i), day(12 + i)));
    const id = s.id('E');
    x.ports.repos.executions.patch(id, {
      flightLists: { planned: 10, cells: planned, reused: 1, ended: null },
    });
    for (const [i, c] of planned.entries())
      list(x, def, c, { fetchedAt: at(-1), executionId: id, failed: i === 0 });
    const res = await x.request(`/api/executions/${id}`);
    const e = apiContract.executionResponseSchema.parse(await res.json());
    expect(e.flights).toEqual({ planned: 10, read: 8, reused: 1, failed: 1, ended: null });
    // why: the 20.8 ruling — the browser worker's run scope states its flight pages beside the page cap (calls are the
    // `/v1/flights` page rows: none were ledgered here; the seeded snapshot froze no allowance, read as 0)
    expect(e.budget.find((u) => u.scope.startsWith('provider-execution'))?.flightLists).toEqual({
      calls: 0,
      cap: 0,
    });
  });
});
