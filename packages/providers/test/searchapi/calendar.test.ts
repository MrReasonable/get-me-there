import {
  AbortedError,
  addDays,
  asIata,
  asIsoDate,
  asIsoMonth,
  BudgetExceeded,
  cellKeyString,
  type DiscoveryQuery,
  type TilePlan,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type ParamsAllowlist, ParamsNotAllowedError } from '../../src/params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from '../../src/searchapi/calendar.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { FakeBudget } from '../fakes.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import { ECHO, ok, type Reply, syntheticHandler } from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const TTL = 3600;
const deps = (k = saKit()): CalendarDeps & { k: ReturnType<typeof saKit> } => ({
  http: k.kit,
  log: k.log,
  key: KEY,
  pointOfSale: 'GB',
  allowlist: SEARCHAPI_PARAMS,
  cacheTtlSeconds: TTL,
  k,
});
const small: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-04'),
  minNights: 10,
  maxNights: 12,
  cabin: 'economy',
  currency: 'GBP',
};
const smallPlan = (): TilePlan => {
  const [t, ...rest] = planRectangles(small);
  if (t === undefined || rest.length > 0) throw new Error('expected one tile');
  return t;
};
type Entry = Record<string, unknown>;
/** A calendar body with one entry per covered cell priced 500, plus `extra` entries. */
const gridFor = (plan: TilePlan, extra: Entry[] = [], echo: object = ECHO): { calendar: Entry[] } => ({
  ...echo,
  calendar: [
    ...plan.coveredCells.map(
      (c): Entry => ({ departure: c.departureDate, return: c.returnDate, price: 500 }),
    ),
    ...extra,
  ],
});
const answer = (reply: Reply) => server.use(syntheticHandler(() => reply));
async function tileOf(plan: TilePlan, q: DiscoveryQuery = small, d = deps()) {
  const res = await fetchCalendarTile(d, plan, q, ctx());
  if (res.kind !== 'tile') throw new Error(`expected a tile, got ${res.error.message}`);
  return res;
}
async function errorOf(plan: TilePlan, q: DiscoveryQuery = small) {
  const res = await fetchCalendarTile(deps(), plan, q, ctx());
  if (res.kind !== 'tile-error') throw new Error('expected a tile-error');
  return res.error;
}

describe('fetchTile request and ledger (spec §5.2, §8.1 parity), synthetic', () => {
  it('plan().length equals upstream hits over a 3-tile scan; each reserve carries its tile index, attempt 1 (synthetic)', async () => {
    const q: DiscoveryQuery = {
      ...small,
      departureTo: addDays(small.departureFrom, 23),
      minNights: 10,
      maxNights: 21,
    };
    const plans = planRectangles(q);
    expect(plans).toHaveLength(3); // 24 departure days in blocks of 9
    // why: answer every rectangle combination, so out-of-band entries exist and must be dropped.
    server.use(
      syntheticHandler((p) => {
        const calendar: Entry[] = [];
        for (
          let d = asIsoDate(p.get('outbound_date_start') ?? '');
          d <= asIsoDate(p.get('outbound_date_end') ?? '');
          d = addDays(d, 1)
        )
          for (
            let r = asIsoDate(p.get('return_date_start') ?? '');
            r <= asIsoDate(p.get('return_date_end') ?? '');
            r = addDays(r, 1)
          )
            calendar.push({ departure: d, return: r, price: 480 });
        return ok({ ...ECHO, calendar });
      }),
    );
    const d = deps();
    for (const plan of plans) {
      const res = await tileOf(plan, q, d);
      expect(res.prices).toHaveLength(plan.coveredCells.length);
      expect(res.notes.some((n) => n.startsWith('dropped-outside-tile:'))).toBe(true);
    }
    expect(sentUrls(d.k.events)).toHaveLength(plans.length);
    expect(d.k.events.flatMap((e) => (e.type === 'reserve' ? [[e.tileIndex, e.httpAttempt]] : []))).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('sends the key only as Authorization: Bearer, travel_class=first_class for first, gl=gb (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const d = deps();
    await tileOf(plan, { ...small, cabin: 'first' }, d);
    const fetches = d.k.events.flatMap((e) => (e.type === 'fetch' ? [e] : []));
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.headers.authorization).toBe(`Bearer ${KEY.reveal()}`);
    expect(fetches[0]?.url).not.toContain(KEY.reveal());
    const p = new URL(fetches[0]?.url ?? '').searchParams;
    expect(p.get('travel_class')).toBe('first_class');
    expect(p.get('gl')).toBe('gb');
    expect(p.get('adults')).toBe('1');
  });

  it('a repeat within the TTL is a cache hit: one reserve, one cache-hit row with the tile index, the original fetchedAt (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const d = deps();
    const one = await tileOf(plan, small, d);
    d.k.clock.advance(60_000);
    const two = await tileOf(plan, small, d);
    expect(sentUrls(d.k.events)).toHaveLength(1);
    expect(two.fetchedAt).toBe(one.fetchedAt);
    expect(
      d.k.events.flatMap((e) =>
        e.type === 'reserve' || e.type === 'cache-hit' ? [[e.type, e.tileIndex]] : [],
      ),
    ).toEqual([
      ['reserve', plan.index],
      ['cache-hit', plan.index],
    ]);
    // why: expiry is the cache port's (WP3); the adapter's part is passing SEARCHAPI_CACHE_TTL_HOURS through.
    expect(d.k.cache.sets.map((s) => s.ttlSeconds)).toEqual([TTL]);
  });

  it('a grid the parser rejects is never cached: the repeat goes upstream again (plan decision 15) (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [] }));
    const d = deps();
    await fetchCalendarTile(d, smallPlan(), small, ctx());
    await fetchCalendarTile(d, smallPlan(), small, ctx());
    expect(sentUrls(d.k.events)).toHaveLength(2);
    expect(d.k.cache.sets).toHaveLength(0);
  });

  it('asserts ≤200 combinations before reserve: no ledger row, no request (spec §5.2)', async () => {
    const d = deps();
    const tooBig: TilePlan = {
      index: 0,
      coveredCells: [],
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2026-11-01'),
        departTo: asIsoDate('2026-11-10'),
        returnFrom: asIsoDate('2026-11-11'),
        returnTo: asIsoDate('2026-12-01'),
      },
    };
    await expect(fetchCalendarTile(d, tooBig, small, ctx())).rejects.toThrow(/210 combinations/);
    expect(d.k.events).toEqual([]);
  });

  it('a rectangle of exactly 200 combinations is sent; 201 is refused before reserve (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [{ departure: '2026-11-01', return: '2026-11-11', price: 480 }] }));
    const rect = (departTo: string, returnTo: string): TilePlan => ({
      index: 0,
      coveredCells: [],
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2026-11-01'),
        departTo: asIsoDate(departTo),
        returnFrom: asIsoDate('2026-11-11'),
        returnTo: asIsoDate(returnTo),
      },
    });
    const d = deps();
    expect((await fetchCalendarTile(d, rect('2026-11-10', '2026-11-30'), small, ctx())).kind).toBe('tile'); // 10 × 20
    expect(sentUrls(d.k.events)).toHaveLength(1);
    const e = deps();
    await expect(fetchCalendarTile(e, rect('2026-11-03', '2027-01-16'), small, ctx())).rejects.toThrow(
      /201 combinations/,
    ); // 3 × 67
    expect(e.k.events).toEqual([]);
  });

  it('a request the allowlist refuses never reaches reserve or the network (adapter-level check)', async () => {
    const key = '/api/v1/search?engine=google_flights_calendar';
    // why: a restrictive allowlist (hl fr only) makes the adapter's own pre-request check the one that must refuse.
    const strict: ParamsAllowlist = {
      ...SEARCHAPI_PARAMS,
      endpoints: Object.fromEntries(
        Object.entries(SEARCHAPI_PARAMS.endpoints).map(([k, e]) => [
          k,
          k === key ? { ...e, values: { ...e.values, hl: ['fr'] } } : e,
        ]),
      ),
    };
    const d = { ...deps(), allowlist: strict };
    await expect(fetchCalendarTile(d, smallPlan(), small, ctx())).rejects.toBeInstanceOf(
      ParamsNotAllowedError,
    );
    expect(d.k.events).toEqual([]);
  });

  it('refuses a non-rectangle tile before any request', async () => {
    const d = deps();
    const plan: TilePlan = {
      index: 0,
      coveredCells: [],
      request: { kind: 'month', month: asIsoMonth('2026-11') },
    };
    await expect(fetchCalendarTile(d, plan, small, ctx())).rejects.toThrow(/rectangle/);
    expect(d.k.events).toEqual([]);
  });

  it('BudgetExceeded propagates rather than becoming a tile-error, and nothing is sent', async () => {
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-month',
        cap: 1,
        current: 1,
        requested: 1,
        providerId: 'searchapi',
      });
    const d = deps(saKit({ budget }));
    await expect(fetchCalendarTile(d, smallPlan(), small, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(sentUrls(d.k.events)).toHaveLength(0);
  });

  it('an aborted signal propagates AbortedError, never a tile-error', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(fetchCalendarTile(deps(), smallPlan(), small, ctx(ac.signal))).rejects.toBeInstanceOf(
      AbortedError,
    );
  });

  it('an HTTP error becomes a tile-error for exactly this tile (synthetic 401)', async () => {
    answer({ status: 401, body: { error: 'Invalid API key.' } });
    const plan = smallPlan();
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    expect(res).toMatchObject({
      kind: 'tile-error',
      index: plan.index,
      coveredCells: plan.coveredCells,
      error: { kind: 'auth', retryable: false },
    });
  });
});

describe('fetchTile parsing (spec §5.2), synthetic shapes', () => {
  it('response-keyed prices in minor units, currency and pointOfSale from the echo, fetchedAt from http-kit (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const res = await tileOf(plan);
    expect(res.prices).toHaveLength(plan.coveredCells.length);
    expect(res.prices.every((p) => p.amountMinor === 50_000 && p.currency === 'GBP')).toBe(true);
    expect(new Set(res.prices.map(cellKeyString))).toEqual(new Set(plan.coveredCells.map(cellKeyString)));
    expect(res).toMatchObject({
      pointOfSale: 'GB',
      fetchedAt: '2026-10-14T15:00:00.000Z',
      noFares: [],
      notes: [],
    });
  });

  it('has_no_flights: true on an entry → that cell in noFares, no price (synthetic)', async () => {
    const plan = smallPlan();
    const [first] = plan.coveredCells;
    if (first === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: first.departureDate, return: first.returnDate, has_no_flights: true };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([first]);
    expect(res.prices).toHaveLength(plan.coveredCells.length - 1);
  });

  it('a grid where every entry has no flights is a tile of noFares, not a parse error (synthetic)', async () => {
    const plan = smallPlan();
    answer(
      ok({
        ...ECHO,
        calendar: plan.coveredCells.map((c) => ({
          departure: c.departureDate,
          return: c.returnDate,
          has_no_flights: true,
        })),
      }),
    );
    const res = await tileOf(plan);
    expect(res.prices).toEqual([]);
    expect(res.noFares).toEqual(plan.coveredCells);
  });

  it('an empty grid under a passing ≤200 assertion → parse, never no_data (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [] }));
    const e = await errorOf(smallPlan());
    expect(e).toMatchObject({ kind: 'parse', retryable: false });
    expect(e.message).toMatch(/empty-grid/);
  });

  it.each([
    [
      'states no currency',
      { calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }] },
      /no-currency/,
    ],
    [
      'does not echo gl',
      {
        search_parameters: { currency: 'GBP' },
        calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }],
      },
      /no-point-of-sale/,
    ],
    [
      'echoes another gl',
      {
        search_parameters: { currency: 'GBP', gl: 'us' },
        calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }],
      },
      /point-of-sale-mismatch/,
    ],
    [
      'has a malformed envelope',
      { ...ECHO, calendar: 'nope' },
      /^(?=.*malformed-calendar)(?=.*calendar: Invalid input)/,
    ],
  ] as const)('a response that %s → parse (synthetic)', async (_label, body, message) => {
    answer(ok(body));
    const e = await errorOf(smallPlan());
    expect(e).toMatchObject({ kind: 'parse', retryable: false, providerId: 'searchapi' });
    expect(e.message).toMatch(message);
  });

  it('drops and counts entries outside the tile, outside the band, without a return, with an impossible date, or unpriced (synthetic)', async () => {
    const plan = smallPlan();
    const [a, b] = plan.coveredCells;
    if (a === undefined || b === undefined) throw new Error('cells');
    // why: q.cells may carry an off-band cell only through an engine bug; the band check still applies.
    const offBand = { ...a, returnDate: addDays(a.departureDate, 30) };
    const withOff: TilePlan = { ...plan, coveredCells: [...plan.coveredCells, offBand] };
    const body = gridFor(plan, [
      { departure: '2026-12-01', return: '2026-12-11', price: 1 },
      { departure: offBand.departureDate, return: offBand.returnDate, price: 1 },
      { departure: a.departureDate },
      { departure: '2027-02-30', return: '2027-03-10', price: 1 },
    ]);
    body.calendar[1] = { departure: b.departureDate, return: b.returnDate }; // unpriced, not no-flights
    answer(ok(body));
    const res = await tileOf(withOff);
    expect(res.notes).toEqual([
      'covered-cells-absent:1',
      'dropped-bad-date:1',
      'dropped-no-return:1',
      'dropped-outside-band:1',
      'dropped-outside-tile:1',
      'unpriced-skipped:1',
    ]);
    expect(res.prices.some((p) => cellKeyString(p) === cellKeyString(b))).toBe(false);
    // why: an unpriced row is neither "no fares" nor a dropped price; the engine decides the cell from that absence.
    expect(res.noFares.some((c) => cellKeyString(c) === cellKeyString(b))).toBe(false);
    expect(res.cellIssues ?? []).toEqual([]);
  });

  // why: CodeRabbit batch 3 — the envelope is strict, but each entry is read on its own: one wrongly shaped entry is
  // dropped and counted, never the whole tile; a grid whose every entry is malformed is still a parse fault
  it('drops and counts wrongly shaped entries beside valid ones; the tile keeps the rest (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body: { calendar: unknown[] } = gridFor(plan);
    body.calendar.push({ departure: a.departureDate, return: a.returnDate, price: 'cheap' }, 'not an entry', {
      departure: 20261102,
    });
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.prices).toHaveLength(plan.coveredCells.length);
    expect(res.notes).toContain('dropped-malformed-entry:3');
  });

  it('a grid whose every entry is malformed → parse, never an empty or absent tile (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [{ departure: 1 }, 'x', { departure: '2026-11-02', price: 'cheap' }] }));
    const e = await errorOf(smallPlan());
    expect(e).toMatchObject({ kind: 'parse', retryable: false });
    expect(e.message).toMatch(/\[malformed-calendar\]/);
  });

  it('duplicates pass through so the engine keeps the minimum: a cheaper second entry is returned (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(ok(gridFor(plan, [{ departure: a.departureDate, return: a.returnDate, price: 420 }])));
    const res = await tileOf(plan);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [50_000, 42_000],
    );
    expect(res.notes).toContain('duplicate-entries:1');
  });

  it('a cell with both a price and has_no_flights is priced, never no fares, and counted (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar.unshift({ departure: a.departureDate, return: a.returnDate, has_no_flights: true });
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'duplicate-entries:1']);
  });

  it('one row carrying both has_no_flights and a price is a priced conflicting entry, never "no fares" (review provenance Minor) (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true, price: 455 };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [45_500],
    );
    expect(res.notes).toEqual(['conflicting-entries:1']);
  });

  it('one row carrying both has_no_flights and an unusable price is reported, never "no fares" (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true, price: 0 };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'offers-dropped:1']);
    expect(res.cellIssues).toMatchObject([{ cell: a, reason: 'parse', offersDropped: 1 }]);
  });

  it('a no-flights entry beside a vendor price that was dropped is not "no fares": counted conflicting, with an issue (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true };
    body.calendar.push({ departure: a.departureDate, return: a.returnDate, price: 0 });
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'duplicate-entries:1', 'offers-dropped:1']);
    expect(res.cellIssues).toEqual([
      { cell: a, reason: 'parse', offersDropped: 1, detail: expect.stringMatching(/1 calendar row/) },
    ]);
  });

  it('notes covered cells the grid left out, without inventing a status for them (synthetic)', async () => {
    const plan = smallPlan();
    const body = gridFor(plan);
    body.calendar.pop();
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.notes).toEqual(['covered-cells-absent:1']);
    expect(res.prices.length + res.noFares.length).toBe(plan.coveredCells.length - 1);
  });
});

describe('fetchTile money (spec §6.3, plan decision 24: shared majorToMinor, no rounding), synthetic', () => {
  const priced = (price: number, currency = 'GBP') => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(
      ok({
        search_parameters: { currency, gl: 'gb' },
        calendar: [{ departure: a.departureDate, return: a.returnDate, price }],
      }),
    );
    return tileOf(plan);
  };

  it('573.5 GBP is 57350 pence', async () => {
    expect((await priced(573.5)).prices.map((p) => p.amountMinor)).toEqual([57_350]);
  });

  it.each([573.555, 0, -10])(
    '%s is dropped and counted offers-dropped, never rounded or kept (synthetic)',
    async (price) => {
      const res = await priced(price);
      expect(res.prices).toEqual([]);
      expect(res.notes).toContain('offers-dropped:1');
      // why: decision 28: the cell is reported, so the engine writes `error` (reason parse), never `no_data`.
      expect(res.cellIssues).toMatchObject([{ reason: 'parse', offersDropped: 1 }]);
    },
  );

  it('a USD echo passes through as USD at its exponent; JPY has exponent 0 (currency from the response) (synthetic)', async () => {
    expect((await priced(610.25, 'usd')).prices).toMatchObject([{ amountMinor: 61_025, currency: 'USD' }]);
    expect((await priced(81_000, 'JPY')).prices).toMatchObject([{ amountMinor: 81_000, currency: 'JPY' }]);
  });

  it('a currency core does not know is currency-unsupported: rows dropped and counted, the tile is not a parse error (synthetic)', async () => {
    const res = await priced(500, 'XAU');
    expect(res.prices).toEqual([]);
    expect(res.notes).toEqual(['covered-cells-absent:8', 'offers-dropped:1']);
    expect(res.cellIssues).toMatchObject([{ reason: 'currency-unsupported', offersDropped: 1 }]);
  });

  it('a cell with one dropped row and one good row is priced and reported; a clean tile carries no cellIssues (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(ok(gridFor(plan, [{ departure: a.departureDate, return: a.returnDate, price: 412.345 }])));
    const res = await tileOf(plan);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [50_000],
    );
    expect(res.cellIssues).toEqual([
      { cell: a, reason: 'parse', offersDropped: 1, detail: expect.any(String) },
    ]);
    answer(ok(gridFor(plan)));
    expect('cellIssues' in (await tileOf(plan))).toBe(false);
  });
});
