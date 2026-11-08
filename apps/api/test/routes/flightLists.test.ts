// Spec revision 55 §10 (WP20 Task 20.9): `GET /definitions/:id/flight-lists?pairs=` answers, per asked date pair in
// order, the figure's airport pair, its search link, the newest list for the figure's cell (`list`) or else the newest
// for another airport pair of the space (`listOtherPair`); `POST` starts a read on demand and maps the engine's
// refusals to their codes; `GET /executions/:id` reports `flights` from the stored plan and the execution's rows.
import {
  apiContract,
  asIsoDate,
  type CellKey,
  type DefinitionInput,
  ProviderError,
  type SearchDefinition,
} from '@gmt/core';
import { PAIRING_FIXTURE } from '@gmt/core/testing';
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
async function setup(
  o: { env?: Record<string, string>; constraints?: DefinitionInput['constraints']; wired?: boolean } = {},
) {
  h = await createHarness({ env: { ...WORKER_ENV, ...o.env }, wired: o.wired === true });
  const x = h;
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({
      ...SPACE,
      ...(o.constraints === undefined ? {} : { constraints: o.constraints }),
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
  o: {
    fetchedAt: string;
    executionId?: string | null;
    failed?: boolean;
    reason?: 'network' | 'monthly-cap' | 'execution-cap';
  },
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
    reason: o.failed === true ? (o.reason ?? 'network') : null,
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
      stale: 'refresh',
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
    // why: final review B-I3: no read can go where flight lists cannot be read
    expect(body.pairs.map((p) => p.readNow)).toEqual([false, false]);
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
      flightLists: {
        planned: 10,
        cells: planned,
        reused: 1,
        ended: null,
        returns: false,
        booking: false,
        returnsStopped: null,
        bookingStopped: null,
        confirm: null,
      },
    });
    for (const [i, c] of planned.entries())
      list(x, def, c, { fetchedAt: at(-1), executionId: id, failed: i === 0 });
    const res = await x.request(`/api/executions/${id}`);
    const e = apiContract.executionResponseSchema.parse(await res.json());
    expect(e.flights).toEqual({
      planned: 10,
      read: 8,
      reused: 1,
      failed: 1,
      ended: null,
      confirm: null,
      stopCause: null,
    });
    // why: the 20.8 ruling — the browser worker's run scope states its flight pages beside its pages (calls are the
    // `/v1/flights` page rows: none were ledgered here); design 2026-11-08 §4.8 withdrew their allowance: no cap
    expect(e.budget.find((u) => u.scope.startsWith('provider-execution'))?.flightLists).toEqual({
      calls: 0,
    });
  });

  // Design 2026-11-08 §7, §5.5: the stored summary travels on `flights.confirm` unchanged; null for a plan stored before it
  it('passes the stored confirm summary through unchanged, and null for a run stored before the change', async () => {
    const { x, s } = await setup();
    const summary = {
      mode: 'confirm',
      confirmed: 7,
      unread: 2,
      uncheckedCheaper: 31,
      stop: 'patience',
    } as const;
    const id = s.id('E');
    x.ports.repos.executions.patch(id, {
      flightLists: {
        planned: 18,
        cells: [],
        reused: 0,
        ended: null,
        returns: true,
        booking: true,
        returnsStopped: null,
        bookingStopped: null,
        confirm: summary,
      },
    });
    const res = await x.request(`/api/executions/${id}`);
    const e = apiContract.executionResponseSchema.parse(await res.json());
    expect(e.flights?.confirm).toEqual(summary);
  });

  // Design 2026-11-08 §5.5: the reason the step stopped early, for the line under the board (never a cause's text)
  describe('flights.stopCause', () => {
    const plan = (ended: 'stopped' | 'window' | null) => ({
      planned: 3,
      cells: [],
      reused: 0,
      ended,
      returns: true,
      booking: true,
      returnsStopped: null,
      bookingStopped: null,
      confirm: { mode: 'confirm', confirmed: 1, unread: 0, uncheckedCheaper: 5, stop: null } as const,
    });
    const flightsOfRun = async (x: Harness, id: string) =>
      apiContract.executionResponseSchema.parse(await (await x.request(`/api/executions/${id}`)).json())
        .flights;

    it("an ending error's detail is the newest failed list's reason when the step ended 'stopped'", async () => {
      const { x, def, s } = await setup();
      const id = s.id('E');
      x.ports.repos.executions.patch(id, { flightLists: plan('stopped') });
      list(x, def, A, { fetchedAt: at(-1), executionId: id, failed: true, reason: 'execution-cap' });
      expect((await flightsOfRun(x, id))?.stopCause).toEqual({ kind: 'detail', detail: 'execution-cap' });
    });

    it.each([
      ['cancelled', { kind: 'cancelled' }, 'cancelled'],
      ['budget', { kind: 'fatal' }, 'fatal'],
      ['limiter-timeout', { kind: 'limiter-timeout', providerId: 'camoufox', resumeAfter: null }, 'other'],
    ] as const)('a run stopped by a %s cause reads %s', async (_n, cause, kind) => {
      const { x, s } = await setup();
      const id = s.id('E');
      x.ports.repos.executions.patch(id, { flightLists: plan(null) });
      x.ports.repos.executions.setStatus(id, 'paused_error', { stopCause: cause, errorText: 'x' });
      expect((await flightsOfRun(x, id))?.stopCause).toEqual({ kind });
    });

    it("words a budget stop's flights with no denominator in confirm mode (stopText's confirm fact)", async () => {
      const { x, s } = await setup();
      const id = s.id('E');
      x.ports.repos.executions.patch(id, { flightLists: plan(null) });
      x.ports.repos.executions.setStatus(id, 'paused_budget', {
        stopCause: {
          kind: 'budget',
          scope: 'provider-execution',
          providerId: 'camoufox',
          unit: 'pages',
          cap: 100,
          resumeAfter: null,
          resetsAt: null,
          flights: { read: 3, planned: 3 },
        },
        errorText: 'x',
      });
      const res = await x.request(`/api/executions/${id}`);
      const e = apiContract.executionResponseSchema.parse(await res.json());
      expect(e.stop?.sentence).toContain('flights were read for 3 dates.');
    });

    it('is null for a run nothing stopped, and for a plan with no summary', async () => {
      const { x, s } = await setup();
      const id = s.id('E');
      x.ports.repos.executions.patch(id, { flightLists: plan(null) });
      expect((await flightsOfRun(x, id))?.stopCause).toBeNull();
    });
  });
});

// Spec rev 56 §10 (WP21 Task 21.6): a list carries its return read on the wire (null for a list read without one, or
// stored before 0012); the response carries the pages one read plans (ruling D3); the POST body never carries limits.
describe('the return leg on the flight-lists wire (spec rev 56 §10)', () => {
  it('list.returns field for field, null for a list without a return read', async () => {
    const { x, def } = await setup();
    list(x, def, A, { fetchedAt: at(-1) });
    x.ports.repos.flightLists.insert({
      definitionId: def.id,
      executionId: null,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
      cabin: 'economy',
      ...B,
      fetchedAt: at(-1),
      pointOfSale: 'GB',
      status: 'read',
      reason: null,
      listed: 'flights',
      minMinor: 48_000,
      tabMinor: null,
      cheapestView: 'cheapest',
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: 4,
      flights: PAIRING_FIXTURE.flights,
      returns: PAIRING_FIXTURE.returns,
    });
    const body = apiContract.flightListsResponseSchema.parse(await (await get(x, def.id, PAIRS)).json());
    const [a, b] = body.pairs;
    expect(a?.list?.returns).toBeNull();
    expect(b?.list?.returns).toEqual(PAIRING_FIXTURE.returns);
    expect(b?.list?.flights).toEqual(PAIRING_FIXTURE.flights);
    expect('pagesLoaded' in (b?.list ?? {})).toBe(false);
  });

  // why: final review B-M1: the list's stale mark is judged on the elapsed milliseconds, as the pairing's freshness is
  it('a list 168 h 30 m old under a 168 h refresh is stale (never whole hours)', async () => {
    const { x, def } = await setup();
    list(x, def, A, { fetchedAt: at(-168.5) });
    const body = apiContract.flightListsResponseSchema.parse(await (await get(x, def.id, PAIRS)).json());
    expect(body.pairs[0]?.list).toMatchObject({ ageHours: 168, stale: 'refresh' });
  });

  // why: final review B-I3: readNow is the on-demand read's own rule (no list, or one it would not refuse as fresh),
  // less a failed list a per-run limit stopped; false where flight lists cannot be read
  it('readNow: true with no list, a list the read would not reuse, a failed one; false when fresh or limit-stopped', async () => {
    const { x, def } = await setup();
    const readNow = async () =>
      apiContract.flightListsResponseSchema
        .parse(await (await get(x, def.id, PAIRS)).json())
        .pairs.map((p) => p.readNow);
    expect(await readNow()).toEqual([true, true]);
    // a young list with no return read: read again while the flags are unread (the read may plan the return phase)
    list(x, def, A, { fetchedAt: at(-1) });
    list(x, def, B, { fetchedAt: at(-1), failed: true, reason: 'execution-cap' });
    expect(await readNow()).toEqual([true, false]);
    // with the return flag off the young list is fresh
    x.engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: false });
    expect(await readNow()).toEqual([false, false]);
    // why: spec rev 64: a list the withdrawn monthly cap stopped (a row stored before then) may be read again, as any
    // other failed list may
    list(x, def, B, { fetchedAt: at(0), failed: true, reason: 'monthly-cap' });
    expect(await readNow()).toEqual([false, true]);
  });
  it('pagesPlanned is 2 before the worker is read (prov-008: the read may then load 2), 1 with its flag off, 2 with it on', async () => {
    const { x, def } = await setup();
    const planned = async () =>
      apiContract.flightListsResponseSchema.parse(await (await get(x, def.id, PAIRS)).json()).pagesPlanned;
    expect(await planned()).toBe(2);
    x.engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: false });
    expect(await planned()).toBe(1);
    x.engine.setWorkerFlags('camoufox', { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true });
    expect(await planned()).toBe(2);
  });

  // why: 21.6 review M10: the read's limits are the definition's, sent by the engine to the worker; a body carrying its
  // own would be refused by the strict body schema before this commit too, so the case drives the read itself
  it("POST reads with the definition's limits: the worker request carries them, the body names none", async () => {
    const { x, def } = await setup({ constraints: { maxStops: 1 }, wired: true });
    const camoufox = x.ports.providers.find((p) => p.id === 'camoufox');
    const preflight = camoufox?.discovery?.preflight;
    const cap = camoufox?.flightLists;
    if (camoufox?.discovery === undefined || preflight === undefined || cap === undefined)
      throw new Error('the camoufox provider and its capabilities');
    vi.spyOn(camoufox.discovery, 'preflight').mockResolvedValue({
      ok: true,
      flags: { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true },
    });
    const sent = vi.spyOn(cap, 'read').mockResolvedValue({
      kind: 'list-error',
      error: new ProviderError({ kind: 'network', retryable: false, message: 'stub' }),
    });
    const started = vi.spyOn(x.engine, 'readFlightList');
    const res = await x.request(`/api/definitions/${def.id}/flight-lists`, {
      json: { departureDate: '2026-11-02', returnDate: '2026-11-12' },
    });
    expect(res.status, await res.clone().text()).toBe(202);
    const r = await started.mock.results[0]?.value;
    if (r === undefined || !r.ok) throw new Error('the read started');
    await r.done;
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      returnLimits: {
        maxJourneyMinutes: null,
        maxStops: 1,
        departureWindowLocal: null,
        arrivalWindowLocal: null,
      },
      booking: true,
    });
  });
});
