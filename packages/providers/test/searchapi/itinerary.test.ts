import { AbortedError, BudgetExceeded, type ItinerarySearchResult } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type ParamsAllowlist, ParamsNotAllowedError } from '../../src/params/allowlist.js';
import { estimateItinerary, type ItineraryDeps, searchItinerary } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { FakeBudget } from '../fakes.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import {
  agent,
  bookingBody,
  CELL_QUERY,
  ECHO,
  flightsBody,
  IN_1,
  IN_2,
  IN_3,
  OUT_A,
  OUT_B,
  ok,
  option,
  type Reply,
  seg,
  syntheticHandler,
} from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const deps = (k = saKit()): ItineraryDeps & { k: ReturnType<typeof saKit> } => ({
  http: k.kit,
  log: k.log,
  key: KEY,
  pointOfSale: 'GB',
  allowlist: SEARCHAPI_PARAMS,
  k,
});
const A = option(OUT_A, 600, { departure_token: 'dA' });
const B = option(OUT_B, 640, { departure_token: 'dB' });
const q1 = { ...CELL_QUERY, expandTop: 1 };
const notFound: Reply = { status: 404, body: { error: 'Not found' } };

/** Routes synthetic replies by token: step 1 has none, step 2 a departure_token, step 3 a booking_token. */
function chain(
  step1: unknown,
  step2: Record<string, Reply>,
  step3: Record<string, Reply> = {},
  onRequest: (p: URLSearchParams) => void = () => undefined,
) {
  server.use(
    syntheticHandler((p) => {
      onRequest(p);
      const bk = p.get('booking_token');
      const dep = p.get('departure_token');
      if (bk !== null) return step3[bk] ?? notFound;
      if (dep !== null) return step2[dep] ?? notFound;
      return ok(step1);
    }),
  );
}
const tokens = (d: { k: ReturnType<typeof saKit> }, name: string) =>
  sentUrls(d.k.events).flatMap((u) => u.searchParams.getAll(name));
/** Seller, amount, booking kind and the decision-27 flag of every offer, in order. */
const sellers = (r: ItinerarySearchResult) =>
  r.offers.map((o) => [o.seller, o.amountMinor, o.booking.kind, o.verified]);
const step2Only = (r: ItinerarySearchResult) => r.offers.length > 0 && r.offers.every((o) => !o.verified);

describe('itinerary outcome rules (spec §5.4), synthetic shapes', () => {
  it('step 1 zero options → coverage empty, one call (synthetic)', async () => {
    chain(flightsBody([]), {});
    const d = deps();
    expect(await searchItinerary(d, CELL_QUERY, ctx())).toMatchObject({
      coverage: 'empty',
      offers: [],
      partial: false,
      failedExpansions: 0,
      pointOfSale: 'GB',
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('a step-1 body with neither best_flights nor other_flights → parse no-options-key, never empty (synthetic)', async () => {
    chain({ ...ECHO, price_insights: null }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      message: expect.stringMatching(/no-options-key/),
    });
  });

  it('other_flights alone is read (synthetic)', async () => {
    chain(
      { ...ECHO, other_flights: [A] },
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    expect((await searchItinerary(deps(), q1, ctx())).coverage).toBe('priced');
  });

  it('options, but every step 2 fails → upstream no-return-legs, non-retryable (synthetic)', async () => {
    chain(flightsBody([A, B]), {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(3);
  });

  it('options, but every step 2 returns no legs → upstream no-return-legs (synthetic)', async () => {
    chain(flightsBody([A, B]), { dA: ok(flightsBody([])), dB: ok(flightsBody([])) });
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
    });
  });

  it('a step 2 without an options key is a failed expansion (parse), not "no legs" (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])), dB: ok({ ...ECHO }) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
    expect(res.notes).toContain('expansion-failed:1');
  });

  it('some step 2 succeed → priced, partial, failedExpansions counted (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
    expect(res.notes).toContain('expansion-failed:1');
  });

  it('a step 2 with zero legs contributes nothing and is not a failure (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])), dB: ok(flightsBody([])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: false, failedExpansions: 0 });
    expect(res.notes).toContain('no-return-legs-for-outbound:1');
    expect(res.offers.every((o) => o.outbound[0]?.flightNumber === '100')).toBe(true);
  });

  it('unpriced options are skipped and counted at step 1 and step 2, never expanded or persisted (synthetic)', async () => {
    const unpriced = option(OUT_B, undefined, { departure_token: 'dU' });
    chain(
      flightsBody([unpriced, A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, undefined, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    const res = await searchItinerary(d, CELL_QUERY, ctx());
    expect(res.notes).toEqual(
      expect.arrayContaining(['unpriced-skipped-step1:1', 'unpriced-skipped-step2:1']),
    );
    expect(tokens(d, 'departure_token')).toEqual(['dA']);
    expect(tokens(d, 'booking_token')).toEqual(['b1']);
  });

  it('all step-1 options unpriced → upstream no-priced-options, nothing expanded (spec §5.4) (synthetic)', async () => {
    chain(flightsBody([option(OUT_A, undefined, { departure_token: 'dA' })]), {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-priced-options',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('all step-1 options unpriced stays upstream no-priced-options (spec §5.4) and is distinct from unusable ones (synthetic)', async () => {
    chain(
      flightsBody([
        option(OUT_A, undefined, { departure_token: 'dA' }),
        option(OUT_B, undefined, { departure_token: 'dB' }),
      ]),
      {},
    );
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-priced-options',
    });
  });

  it('priced step-1 options without a token, with a non-IATA airport or an unusable price → parse unusable-step1-options, never no-priced-options (synthetic)', async () => {
    const noToken = { flights: OUT_A, price: 500 };
    const badAirport = option(
      [seg('/m/04jpl', 'JFK', '2026-11-02', '09:00', 'X1 100', 'Synthetic Air One')],
      510,
      { departure_token: 'dX' },
    );
    const badPrice = option(OUT_B, 520.005, { departure_token: 'dY' });
    chain(flightsBody([noToken, badAirport, badPrice]), {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(
        /no-departure-token-step1:1, unusable-price-step1:1, unusable-segments-step1:1.*\[unusable-step1-options\]/,
      ),
    });
  });

  it('expands the expandTop cheapest priced outbounds, cheapest first (synthetic)', async () => {
    const C = option(OUT_B, 590, { departure_token: 'dC' });
    chain(
      flightsBody([B, A, C]),
      { dC: ok(flightsBody([option(IN_1, 590, { booking_token: 'bC' })])) },
      { bC: ok(bookingBody([agent(560)])) },
    );
    const d = deps();
    await searchItinerary(d, q1, ctx());
    expect(tokens(d, 'departure_token')).toEqual(['dC']);
  });

  it('every request is a google_flights request with sort_by=price, separate_tickets=1, adults=1, tileIndex null, never cached (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    await searchItinerary(d, q1, ctx());
    await searchItinerary(d, q1, ctx());
    const urls = sentUrls(d.k.events);
    expect(urls).toHaveLength(6);
    for (const u of urls)
      expect([
        u.searchParams.get('sort_by'),
        u.searchParams.get('separate_tickets'),
        u.searchParams.get('adults'),
      ]).toEqual(['price', '1', '1']);
    expect(d.k.events.filter((e) => e.type === 'reserve').every((e) => e.tileIndex === null)).toBe(true);
    expect(d.k.budget.count('cache-hit')).toBe(0);
    expect(d.k.cache.sets).toHaveLength(0);
  });

  it('fetchedAt of the chain is the oldest step: http-kit stamps each response after its body is read (synthetic)', async () => {
    const d = deps();
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
      () => d.k.clock.advance(60_000),
    );
    expect((await searchItinerary(d, q1, ctx())).fetchedAt).toBe('2026-10-14T15:01:00.000Z');
  });

  it('bookingLinks false throws before any request (spec §5.4: forced true) (synthetic)', async () => {
    chain(flightsBody([A]), {});
    const d = deps();
    await expect(searchItinerary(d, { ...CELL_QUERY, bookingLinks: false }, ctx())).rejects.toThrow(
      /bookingLinks/,
    );
    expect(d.k.events).toEqual([]);
  });
});

describe('errors that propagate (spec §5.4 rev 12, plan decision 17), synthetic', () => {
  it.each([
    ['a header-less 429', { status: 429, body: null }, 'rate-limit'],
    ['a 401', { status: 401, body: { error: 'Invalid API key.' } }, 'auth'],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota'],
    [
      'a 429 asking to wait beyond MAX_WAIT_SECONDS',
      { status: 429, body: null, headers: { 'retry-after': '99999' } },
      'limiter-timeout',
    ],
  ] as const)(
    '%s at step 2 rejects with %s; no further step-2 or step-3 request (synthetic)',
    async (_label, reply, kind) => {
      chain(flightsBody([A, B]), {
        dA: reply,
        dB: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])),
      });
      const d = deps();
      await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({ kind });
      expect(sentUrls(d.k.events)).toHaveLength(2);
    },
  );

  it.each([
    ['a header-less 429', { status: 429, body: null }, 'rate-limit'],
    ['a 401', { status: 401, body: { error: 'Invalid API key.' } }, 'auth'],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota'],
    [
      'a 429 asking to wait beyond MAX_WAIT_SECONDS',
      { status: 429, body: null, headers: { 'retry-after': '99999' } },
      'limiter-timeout',
    ],
  ] as const)(
    '%s at step 3 rejects with %s rather than returning a partial result; three requests (synthetic)',
    async (_label, reply, kind) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: reply },
      );
      const d = deps();
      await expect(searchItinerary(d, q1, ctx())).rejects.toMatchObject({ kind, retryable: false });
      expect(sentUrls(d.k.events)).toHaveLength(3);
    },
  );

  it('a request the allowlist refuses never reaches reserve or the network (adapter-level check)', async () => {
    const key = '/api/v1/search?engine=google_flights';
    // why: a restrictive allowlist (sort_by departure_time only) makes the adapter's own check the one that refuses.
    const strict: ParamsAllowlist = {
      ...SEARCHAPI_PARAMS,
      endpoints: Object.fromEntries(
        Object.entries(SEARCHAPI_PARAMS.endpoints).map(([k, e]) => [
          k,
          k === key ? { ...e, values: { ...e.values, sort_by: ['departure_time'] } } : e,
        ]),
      ),
    };
    chain(flightsBody([A]), {});
    const d = { ...deps(), allowlist: strict };
    await expect(searchItinerary(d, q1, ctx())).rejects.toBeInstanceOf(ParamsNotAllowedError);
    expect(d.k.events).toEqual([]);
  });

  it('a BudgetExceeded at step 1 or at the first step 2 propagates: nothing was gathered yet', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) });
    for (const refuseAt of [1, 2]) {
      const budget = new FakeBudget([]);
      budget.refuse = () =>
        budget.reserveCalls === refuseAt
          ? new BudgetExceeded({ scope: 'execution-calls', cap: 1, current: 1, requested: 1 })
          : null;
      const d = deps(saKit({ budget }));
      await expect(searchItinerary(d, q1, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
      expect(sentUrls(d.k.events)).toHaveLength(refuseAt - 1);
    }
  });
});

describe('a chain stopped by budget or cancel keeps what it paid for (plan decision 24, CBR-05), synthetic', () => {
  const step2 = {
    dA: ok(
      flightsBody([option(IN_1, 600, { booking_token: 'b1' }), option(IN_2, 650, { booking_token: 'b2' })]),
    ),
  };

  it('a BudgetExceeded at step 3 returns the step-2 offers as a partial result, and no further request (synthetic)', async () => {
    chain(flightsBody([A]), step2, { b1: ok(bookingBody([agent(573)])) });
    const budget = new FakeBudget([]);
    budget.refuse = (p) =>
      budget.reserveCalls === 3
        ? new BudgetExceeded({
            scope: 'execution-calls',
            cap: 2,
            current: 2,
            requested: 1,
            providerId: p.providerId,
          })
        : null;
    const d = deps(saKit({ budget }));
    const res = await searchItinerary(d, q1, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(sellers(res)).toEqual([
      ['Synthetic Air One', 65_000, 'none', false],
      ['Synthetic Air One', 60_000, 'none', false],
    ]);
    expect(res.notes).toContain('chain-stopped-budget:1');
    expect(sentUrls(d.k.events)).toHaveLength(2);
  });

  it('a BudgetExceeded at the second step 2 returns the first outbound’s offers, partial (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { ...step2, dB: ok(flightsBody([option(IN_3, 700, { booking_token: 'b3' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      budget.reserveCalls === 4
        ? new BudgetExceeded({ scope: 'provider-month', cap: 3, current: 3, requested: 1 })
        : null;
    const res = await searchItinerary(deps(saKit({ budget })), CELL_QUERY, ctx());
    expect(res.partial).toBe(true);
    expect(
      res.offers.map((o) => [o.amountMinor, o.verified]).sort(([a], [b]) => Number(a) - Number(b)),
    ).toEqual([
      [57_300, true],
      [60_000, false],
      [65_000, false],
    ]);
  });

  it('an operator cancel between step 2 and step 3 returns the step-2 offers, partial, and sends no step 3 (synthetic)', async () => {
    const ac = new AbortController();
    chain(flightsBody([A]), step2, { b1: ok(bookingBody([agent(573)])) });
    // why: the cancel lands just as step 3 is reserved, after step 2 was paid for (a deterministic hook; http-kit
    // checks the signal before every reservation).
    const budget = new (class extends FakeBudget {
      override reserve(p: Parameters<FakeBudget['reserve']>[0]) {
        if (this.reserveCalls === 2) ac.abort();
        if (ac.signal.aborted) throw new AbortedError();
        return super.reserve(p);
      }
    })([]);
    const d = deps(saKit({ budget }));
    const res = await searchItinerary(d, q1, ctx(ac.signal));
    expect(res.partial).toBe(true);
    expect(res.notes).toContain('chain-stopped-abort:1');
    expect(res.offers).toHaveLength(2);
    expect(step2Only(res)).toBe(true);
    expect(tokens(d, 'booking_token')).toEqual([]);
  });

  it('a cancel before step 1 propagates AbortedError (synthetic)', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(searchItinerary(deps(), q1, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
  });
});

describe('step 3 and the price-source rule (spec §5.4), synthetic shapes', () => {
  it('every priced step-2 return option is its own offer; step 3 runs only for the cheapest (synthetic)', async () => {
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 650, { booking_token: 'b1' }),
            option(IN_2, 600, { booking_token: 'b2' }),
            option(IN_3, 700, { booking_token: 'b3' }),
          ]),
        ),
      },
      { b2: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    const res = await searchItinerary(d, q1, ctx());
    expect(tokens(d, 'booking_token')).toEqual(['b2']);
    expect(res.offers.map((o) => o.amountMinor).sort((a, b) => a - b)).toEqual([
      57_300, 60_000, 65_000, 70_000,
    ]);
    expect(res.notes).toEqual(['airline-direct-kept:1']);
    expect(res.partial).toBe(false);
    // decision 27: only the step-3 seller listing is verified; every step-2 price stays unverified.
    expect(res.offers.filter((o) => o.verified).map((o) => o.amountMinor)).toEqual([57_300]);
  });

  it('a step-3 option naming the airline replaces the step-2 airline offer (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 603, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(603, 'Synthetic Air One'), agent(573)])) },
    );
    expect(sellers(await searchItinerary(deps(), q1, ctx()))).toEqual([
      ['Synthetic Air One', 60_300, 'post', true],
      ['Synthetic Travel Agent', 57_300, 'post', true],
    ]);
  });

  it('a step-3 seller that is a connecting carrier or a near-miss spelling keeps the step-2 offer (synthetic)', async () => {
    const mixed = [
      seg('JFK', 'BOS', '2026-11-14', '15:00', 'Y2 300', 'Synthetic Air Two'),
      seg('BOS', 'LHR', '2026-11-14', '19:00', 'X1 107', 'Synthetic Air One'),
    ];
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(mixed, 610, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(580, 'Synthetic Air Two'), agent(600, 'Synthetic Air One plc')])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([
      ['Synthetic Air Two', 58_000, 'post', true],
      ['Synthetic Air One plc', 60_000, 'post', true],
      ['Synthetic Air One', 61_000, 'none', false],
    ]);
    expect(res.notes).toEqual(['airline-direct-kept:1']);
  });

  it('an outbound whose first flight states no airline: step-2 offers are dropped and counted, never named; step 3 still runs (synthetic)', async () => {
    const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, { departure_token: 'dA' });
    chain(
      flightsBody([anon]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, 650, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([['Synthetic Travel Agent', 57_300, 'post', true]]);
    expect(res.notes).toEqual(['no-airline-skipped-step2:2']);
  });

  it('a step 3 whose only options are split bookings keeps the step-2 offer; the result is not partial (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([{ is_split_booking: true, price: 400 }])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([['Synthetic Air One', 60_000, 'none', false]]);
    expect(res).toMatchObject({ partial: false, notes: ['split-booking-skipped:1'] });
  });

  it.each([
    ['fails (404)', notFound, 'booking-options-failed:1'],
    ['has no booking_options key', ok({ ...ECHO }), 'booking-options-failed:1'],
    ['fails the schema', ok({ ...ECHO, booking_options: 'x' }), 'booking-options-failed:1'],
    [
      'echoes another gl',
      ok({ search_parameters: { currency: 'GBP', gl: 'us' }, booking_options: [agent(560)] }),
      'booking-options-failed:1',
    ],
  ] as const)(
    'a step 3 that %s keeps the step-2 offer and marks the result partial, not a failed expansion (synthetic)',
    async (_label, reply, note) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: reply },
      );
      const res = await searchItinerary(deps(), q1, ctx());
      expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0, notes: [note] });
      expect(res.offers.map((o) => o.amountMinor)).toEqual([60_000]);
      expect(step2Only(res)).toBe(true);
    },
  );

  it.each([
    ['no booking_token', { dA: ok(flightsBody([{ flights: IN_1, price: 600 }])) }, {}],
    [
      'a 404 at step 3',
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: notFound },
    ],
    [
      'split-only booking options',
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([{ is_split_booking: true, price: 400 }])) },
    ],
  ] as const)(
    'an airline-less outbound with %s ends with no usable offer → parse no-usable-offers, never a priced empty result (decision 31) (synthetic)',
    async (_label, step2, step3) => {
      const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, {
        departure_token: 'dA',
      });
      chain(flightsBody([anon]), step2, step3);
      await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
        kind: 'parse',
        providerId: 'searchapi',
        message: expect.stringMatching(/\[no-usable-offers\]/),
      });
    },
  );

  it('an airline-less outbound whose step 3 prices are in an unknown currency → upstream currency-unsupported (synthetic)', async () => {
    const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, { departure_token: 'dA' });
    chain(
      flightsBody([anon]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok({ search_parameters: { currency: 'XAU', gl: 'gb' }, booking_options: [agent(560)] }) },
    );
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
    });
  });

  it('an outbound whose step-2 prices were all dropped marks the result partial even when another outbound priced (decision 31) (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      {
        dA: ok({
          search_parameters: { currency: 'XAU', gl: 'gb' },
          best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
        }),
        dB: ok(flightsBody([option(IN_2, 640, { booking_token: 'b2' })])),
      },
      { b2: ok(bookingBody([agent(610)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(res.notes).toContain('returns-dropped-for-outbound:1');
  });

  it('a cheapest return without a booking_token keeps the step-2 offer and is partial: step 3 could not run (synthetic)', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([{ flights: IN_1, price: 600 }])) });
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res).toMatchObject({ partial: true, notes: ['no-booking-token-step2:1'] });
    expect(res.offers).toHaveLength(1);
    expect(step2Only(res)).toBe(true);
  });

  it.each([
    [
      'are seller-less',
      bookingBody([
        { price: 560, booking_request: { url: 'https://www.google.com/travel/clk/f', post_data: 'u=s' } },
      ]),
      ['booking-options-unusable-step3:1', 'no-seller-skipped-step3:1'],
    ],
    [
      'are in a currency core does not know',
      { search_parameters: { currency: 'XAU', gl: 'gb' }, booking_options: [agent(560)] },
      ['booking-options-unusable-step3:1', 'offers-dropped:1'],
    ],
  ] as const)(
    'a step 3 whose non-split options %s keeps the step-2 offer and is partial (synthetic)',
    async (_label, body, notes) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: ok(body) },
      );
      const res = await searchItinerary(deps(), q1, ctx());
      expect(res).toMatchObject({ partial: true, notes });
      expect(sellers(res)).toEqual([['Synthetic Air One', 60_000, 'none', false]]);
    },
  );

  it('calls per cell are 1 + expandTop × 2 when every step succeeds (spec §5.4) (synthetic)', async () => {
    server.use(
      syntheticHandler((p) => {
        if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
        const dep = p.get('departure_token');
        if (dep !== null) return ok(flightsBody([option(IN_1, 600, { booking_token: `b-${dep}` })]));
        return ok(flightsBody([A, B]));
      }),
    );
    const d = deps();
    await searchItinerary(d, CELL_QUERY, ctx());
    expect(sentUrls(d.k.events)).toHaveLength(1 + 2 * 2);
    expect(estimateItinerary(CELL_QUERY, 0).calls).toBe(5);
  });
});

describe('currency, money and route history (spec §2, §6.3, plan decisions 24–25), synthetic', () => {
  it('a step-1 response that states no currency → parse (synthetic)', async () => {
    chain({ best_flights: [A] }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      message: expect.stringMatching(/no-currency/),
    });
  });

  it('a step-1 currency core does not know → upstream currency-unsupported, never parse, one call (synthetic)', async () => {
    chain({ search_parameters: { currency: 'XAU', gl: 'gb' }, best_flights: [A] }, {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('a USD echo passes through as USD at its exponent (currency from the response) (synthetic)', async () => {
    const usd = { search_parameters: { currency: 'USD', gl: 'gb' } };
    chain(
      { ...usd, best_flights: [A] },
      { dA: ok({ ...usd, best_flights: [option(IN_1, 760.5, { booking_token: 'b1' })] }) },
      { b1: ok({ ...usd, booking_options: [agent(720.25)] }) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.offers.map((o) => [o.amountMinor, o.currency])).toEqual([
      [72_025, 'USD'],
      [76_050, 'USD'],
    ]);
  });

  it('a step-2 price with excess precision is dropped and counted offers-dropped, never rounded (synthetic)', async () => {
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, 612.345, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(61_235);
    expect(res.notes).toContain('offers-dropped:1');
  });

  it('price_insights.price_history becomes routeHistory in minor units; bad points are dropped and counted (synthetic)', async () => {
    const history = {
      price_insights: {
        price_history: [
          { price: 646, iso_date: '2026-09-19T04:00:00Z' },
          { price: 612.5, iso_date: '2026-09-20T04:00:00Z' },
          { price: 600, iso_date: 'garbage' },
          { price: 600, iso_date: '2026-02-30T04:00:00Z' },
          { price: 0, iso_date: '2026-09-21T04:00:00Z' },
          { iso_date: '2026-09-22T04:00:00Z' },
        ],
      },
    };
    chain(
      flightsBody([A], history),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.routeHistory).toEqual([
      { date: '2026-09-19', lowestPriceMinor: 64_600, currency: 'GBP' },
      { date: '2026-09-20', lowestPriceMinor: 61_250, currency: 'GBP' },
    ]);
    expect(res.notes).toContain('route-history-dropped:4');
  });

  it('a step-1 body failing the schema → parse malformed-flights with providerId searchapi (synthetic)', async () => {
    chain({ ...ECHO, best_flights: 'x' }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(/malformed-flights/),
    });
  });

  it('a step-2 return leg through a non-IATA airport is counted and never an offer (synthetic)', async () => {
    const odd = [seg('JFK', '/m/02_286', '2026-11-14', '18:00', 'X1 109', 'Synthetic Air One')];
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(odd, 550, { booking_token: 'bX' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.notes).toContain('unusable-segments-step2:1');
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(55_000);
  });

  it('a step-2 body echoing another gl is a failed expansion (parse), never priced (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      {
        dA: ok({
          search_parameters: { currency: 'GBP', gl: 'us' },
          best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
        }),
        dB: ok(flightsBody([option(IN_2, 640, { booking_token: 'b2' })])),
      },
      { b2: ok(bookingBody([agent(610)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ partial: true, failedExpansions: 1 });
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(60_000);
  });

  it('step-2 returns all in a currency core does not know → currency-unsupported, never no-return-legs (synthetic)', async () => {
    chain(flightsBody([A]), {
      dA: ok({
        search_parameters: { currency: 'XAU', gl: 'gb' },
        best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
      }),
    });
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
    });
  });

  it('step-2 returns whose prices are all unusable → parse unusable-return-prices, never no-return-legs (synthetic)', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600.125, { booking_token: 'b1' })])) });
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(/unusable-return-prices/),
    });
  });

  it('a null price_insights yields an empty routeHistory, not an error (synthetic)', async () => {
    chain(
      flightsBody([A], { price_insights: null }),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    expect((await searchItinerary(deps(), q1, ctx())).routeHistory).toEqual([]);
  });
});

describe('estimateItinerary (spec §5.4, §12; ruling po-006)', () => {
  it('calls = 1 + expandTop × 2, priced at the configured per-call cost, 29 s per call', () => {
    expect(estimateItinerary(CELL_QUERY, 1234)).toMatchObject({
      calls: 5,
      costMicroGbp: 5 * 1234,
      seconds: 145,
    });
    expect(estimateItinerary({ ...CELL_QUERY, expandTop: 3 }, 0)).toMatchObject({
      calls: 7,
      costMicroGbp: 0,
    });
    expect(() => estimateItinerary({ ...CELL_QUERY, bookingLinks: false }, 0)).toThrow(/bookingLinks/);
  });
});
