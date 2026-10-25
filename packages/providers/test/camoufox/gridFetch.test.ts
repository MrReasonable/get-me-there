// WP15 Task 15.7: the camoufox adapter in grid mode (spec §2, §5.2, §7 rev 34; decision 70): the plan from the measured
// step and the run's allowances, the grid-path request with its planned scrolls on the reservation, the answer mapped
// to prices with their return-date source and Google's mark, and every covered cell either priced, no data on the
// no-flights page, or an issue that names why. Synthetic worker answers (msw).
import {
  addDays,
  asIata,
  asIsoDate,
  asIsoDateTime,
  BudgetExceeded,
  cellKeyString,
  type GridView,
  type IsoDate,
} from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { camoufoxProvider } from '../../src/camoufox/index.js';
import { makeKit, SENTINELS, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';

const URL_ = 'http://127.0.0.1:8090/v1/page';
const STATUS = 'http://127.0.0.1:8090/v1/status';
const Q = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2027-03-11'),
  departureTo: asIsoDate('2027-03-17'),
  minNights: 10,
  maxNights: 10,
  cabin: 'economy' as const,
  currency: 'GBP' as const,
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
const contacted = { headers: { 'x-gmt-google-contacted': '1' } };
const versions = {
  selectors: 's',
  grammar: 'g',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
  gridGrammar: '2026-10-18',
};
const days = (from: string, n = 7): IsoDate[] =>
  Array.from({ length: n }, (_v, i) => addDays(asIsoDate(from), i));
/** A whole view of departures 11–17 Mar by returns 21–27 Mar at £450, with `over` cells replaced. */
function view(o: Partial<GridView> = {}): GridView {
  const cells = days('2027-03-11').flatMap((d) =>
    days('2027-03-21').map((r) => ({
      status: 'price' as const,
      departureDate: d,
      returnDate: r,
      amountMinor: 45_000,
      mark: 'none' as const,
    })),
  );
  return {
    index: 0,
    departures: days('2027-03-11'),
    returns: days('2027-03-21'),
    cells,
    unparsed: 0,
    structural: 'ok',
    offPlan: null,
    ...o,
  };
}
const answer = (o: { views?: GridView[]; ended?: string; scrolls?: number } = {}) => ({
  kind: 'grid',
  fetchedAt: '2026-10-14T15:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  views: o.views ?? [view()],
  scrolls: o.scrolls ?? 0,
  ended: o.ended ?? 'complete',
  notes: [],
  versions,
});
const status = (
  gridStepDays: unknown,
  grid: { gridScrollCap?: number; gridScrollSpacingSeconds?: number } = {},
) => ({
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions,
  flags: {},
  accountCookie: { found: false, names: [], checkedAt: '2026-10-14T15:00:00.000Z' },
  socsCapturedAt: '2026-10-14T15:00:00.000Z',
  socsStable: true,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
  gridStepDays,
  gridScrollCap: grid.gridScrollCap ?? 30,
  gridScrollSpacingSeconds: grid.gridScrollSpacingSeconds ?? 5,
});
function setup(
  grid: {
    executionPageCap: number;
    executionScrollCap: number;
    scrollCap: number;
    scrollSpacingSeconds?: number;
  } = {
    executionPageCap: 100,
    executionScrollCap: 600,
    scrollCap: 30,
  },
  o: { scrollsLeft?: (executionId: string | null) => number | null; now?: string } = {},
) {
  const { kit, budget, log, clock } = makeKit({ limits: testLimits() });
  if (o.now !== undefined) clock.set(asIsoDateTime(o.now));
  const p = camoufoxProvider({
    http: kit,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
    grid: { mode: 'grid', scrollSpacingSeconds: 5, pageTimeoutSeconds: 90, ...grid },
    ...(o.scrollsLeft === undefined ? {} : { scrollsLeft: o.scrollsLeft }),
  });
  const d = p.discovery;
  if (d === undefined) throw new Error('discovery');
  return { p, d, budget };
}
const body = async (req: Request): Promise<unknown> => JSON.parse(await req.text());

afterEach(() => {
  server.resetHandlers();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('camoufox grid mode', () => {
  it('declares the grid source: the assumed 24 h age, whole pounds, the return date from the cell (PA-03, PA-10)', () => {
    const { d } = setup();
    expect(d.info).toMatchObject({ sourceKind: 'scraped-self', maxAgeHours: 24, maxAgeAssumed: true });
    expect(d.info.provenanceNote).toMatch(/^Google Flights date grid via Camoufox: /);
    expect(d.info.provenanceNote).toContain('The grid shows whole pounds');
    expect(d.info.provenanceNote).toContain('age not stated (assumed ≤24h)');
    expect(d.info.provenanceNote).toContain('Return date: read from the grid cell');
  });
  it('plans one block for a one-week window of one stay, opened at its centre', () => {
    const { d } = setup();
    expect(d.plan(Q).map((t) => t.request)).toEqual([
      {
        kind: 'grid-path',
        start: { departureDate: '2027-03-14', returnDate: '2027-03-24' },
        moves: [],
        reads: [true],
      },
    ]);
  });
  it('splits the run’s allowances across the stage’s pairs (share)', () => {
    // why: one stay over five weeks is five blocks, each a column apart: 7 days right and 7 down, 14 scrolls a move
    const { d } = setup({ executionPageCap: 2, executionScrollCap: 28, scrollCap: 30 });
    const wide = { ...Q, departureTo: asIsoDate('2027-04-14') };
    const one = d.plan(wide);
    const four = d.plan({ ...wide, share: { pairs: 2 } });
    const scrolls = (ts: typeof one) =>
      ts.reduce((n, t) => n + (t.request.kind === 'grid-path' ? t.request.moves.length : 0), 0);
    expect(scrolls(one)).toBe(28);
    expect(scrolls(four)).toBe(14);
  });
  it('preflight refuses grid mode until the worker reports the measured step', async () => {
    const { d } = setup();
    server.use(http.get(STATUS, () => HttpResponse.json(status(null))));
    expect(await d.preflight?.(ctx)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      detail: expect.stringMatching(/grid/),
    });
    server.use(http.get(STATUS, () => HttpResponse.json(status({ departures: 7, returns: 7 }))));
    expect(await d.preflight?.(ctx)).toMatchObject({ ok: false, skip: 'provider_disabled' });
    server.use(http.get(STATUS, () => HttpResponse.json(status({ departures: 1, returns: 1 }))));
    expect(await d.preflight?.(ctx)).toEqual({ ok: true });
  });
  it('preflight refuses grid mode when the worker’s scroll cap or spacing differs from the app’s (CA 9)', async () => {
    const { d } = setup();
    server.use(
      http.get(STATUS, () => HttpResponse.json(status({ departures: 1, returns: 1 }, { gridScrollCap: 20 }))),
    );
    expect(await d.preflight?.(ctx)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      detail: expect.stringMatching(/CAMOUFOX_GRID_SCROLL_CAP.*20.*30/),
    });
    server.use(
      http.get(STATUS, () =>
        HttpResponse.json(status({ departures: 1, returns: 1 }, { gridScrollSpacingSeconds: 9 })),
      ),
    );
    expect(await d.preflight?.(ctx)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      detail: expect.stringMatching(/CAMOUFOX_GRID_SCROLL_SPACING_SECONDS.*9.*5/),
    });
  });
  it('preflight refuses grid mode when the worker’s page timeout differs from the app’s (CodeRabbit)', async () => {
    const { d } = setup();
    server.use(
      http.get(STATUS, () =>
        HttpResponse.json({ ...status({ departures: 1, returns: 1 }), pageTimeoutSeconds: 240 }),
      ),
    );
    expect(await d.preflight?.(ctx)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      detail: expect.stringMatching(/CAMOUFOX_PAGE_TIMEOUT_SECONDS.*240.*90/),
    });
  });
  // why: re-review N2: a page held back leaves no ledger row and breaks parity; with no scroll left the page drops its
  // lead scroll and reads the view it opens on, a day later on the returns, so only the same-day corner is unseen
  it('a 0-night page with no scroll left drops its lead scroll and reads the view it opens on (re-review N2)', async () => {
    let sent: unknown;
    server.use(
      http.post(URL_, async ({ request }) => {
        sent = await body(request);
        return HttpResponse.json(answer({ views: [], ended: 'complete' }), contacted);
      }),
    );
    const { d, budget } = setup(undefined, { scrollsLeft: () => 0 });
    const q = { ...Q, minNights: 0, maxNights: 0 };
    const [tile] = d.plan(q);
    if (tile?.request.kind !== 'grid-path') throw new Error('tile');
    expect([tile.request.moves, tile.request.reads]).toEqual([['up'], [false, true]]);
    const r = await d.fetchTile(tile, q, ctx);
    expect(sent).toMatchObject({ moves: [], reads: [true], scrollAllowance: 0 });
    expect(r.kind === 'tile' && r.notes).toContain('lead-scroll-dropped');
    expect(budget.rowsOf('camoufox')).toHaveLength(1);
  });
  it('a page asks for no more scrolls than the run’s and the month’s caps leave, and reserves that many (CA 1)', async () => {
    const left: Array<string | null> = [];
    const { d, budget } = setup(
      { executionPageCap: 1, executionScrollCap: 600, scrollCap: 30 },
      {
        scrollsLeft: (id) => {
          left.push(id);
          return 10;
        },
      },
    );
    const wide = { ...Q, departureTo: asIsoDate('2027-03-24') };
    const [tile] = d.plan(wide);
    if (tile?.request.kind !== 'grid-path') throw new Error('tile');
    expect(tile.request.moves).toHaveLength(14);
    let sent: unknown;
    server.use(
      http.post(URL_, async ({ request }) => {
        sent = await body(request);
        return HttpResponse.json(answer({ views: [view()], ended: 'allowance', scrolls: 10 }), contacted);
      }),
    );
    const r = await d.fetchTile(tile, wide, ctx);
    expect(sent).toMatchObject({ scrollAllowance: 10 });
    expect(left).toEqual(['exec-1']);
    expect(budget.rowsOf('camoufox').map((x) => [x.scrolls, x.scrollCount])).toEqual([[10, 10]]);
    if (r.kind !== 'tile') throw new Error('tile');
    expect(r.cellIssues?.map((i) => i.detail.split(' ')[0])).toEqual(Array(7).fill('scroll-allowance'));
  });
  // why: decision 82 (Task 17.3): a page the worker stopped short at its allowance met the worker's monthly scroll cap
  it('a grid answer that spent the month’s scrolls keeps its views and raises BudgetExceeded at provider-month for the next tile', async () => {
    const { d } = setup(
      { executionPageCap: 1, executionScrollCap: 600, scrollCap: 30 },
      { scrollsLeft: () => 10 },
    );
    const wide = { ...Q, departureTo: asIsoDate('2027-03-24') };
    const [tile] = d.plan(wide);
    if (tile === undefined) throw new Error('tile');
    let hits = 0;
    server.use(
      http.post(URL_, () => {
        hits++;
        return HttpResponse.json(answer({ views: [view()], ended: 'allowance', scrolls: 4 }), contacted);
      }),
    );
    const first = await d.fetchTile(tile, wide, ctx);
    expect(first.kind === 'tile' && first.prices).toHaveLength(7);
    const next = d.fetchTile(tile, wide, ctx);
    await expect(next).rejects.toBeInstanceOf(BudgetExceeded);
    await expect(next).rejects.toMatchObject({
      scope: 'provider-month',
      providerId: 'camoufox',
      unit: 'scrolls',
    });
    expect(hits).toBe(1);
    // why: another run asks the worker again (its month may have turned)
    expect((await d.fetchTile(tile, wide, { ...ctx, executionId: 'exec-2' })).kind).toBe('tile');
    expect(hits).toBe(2);
  });
  it('with no scrolls left, a page still opens and reads its first block, reserving none (CA 1)', async () => {
    const { d, budget } = setup(
      { executionPageCap: 1, executionScrollCap: 600, scrollCap: 30 },
      { scrollsLeft: () => 0 },
    );
    const wide = { ...Q, departureTo: asIsoDate('2027-03-24') };
    const [tile] = d.plan(wide);
    if (tile === undefined) throw new Error('tile');
    let sent: unknown;
    server.use(
      http.post(URL_, async ({ request }) => {
        sent = await body(request);
        return HttpResponse.json(answer({ views: [view()], ended: 'allowance', scrolls: 0 }), contacted);
      }),
    );
    const r = await d.fetchTile(tile, wide, ctx);
    expect(sent).toMatchObject({ scrollAllowance: 0 });
    expect(budget.rowsOf('camoufox').map((x) => x.scrolls)).toEqual([0]);
    expect(r.kind === 'tile' && r.prices).toHaveLength(7);
  });
  it('estimates each page at the page time and each scroll at the measured time, or the spacing when longer (CB-7)', () => {
    const t = {
      index: 0,
      coveredCells: [],
      request: {
        kind: 'grid-path' as const,
        start: { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-24') },
        moves: ['down' as const, 'down' as const],
        reads: [true, false, true],
      },
    };
    expect(setup().d.estimateTile?.(t)).toEqual({ scrolls: 2, seconds: 30 + 2 * 9.3 });
    const slow = setup({
      executionPageCap: 100,
      executionScrollCap: 600,
      scrollCap: 30,
      scrollSpacingSeconds: 30,
    });
    expect(slow.d.estimateTile?.(t)).toEqual({ scrolls: 2, seconds: 30 + 2 * 30 });
  });
  it('plans from the operator’s date (London), not the UTC date (CA 10)', () => {
    // why: 23:30 UTC on 18 Oct 2026 is 00:30 on 19 Oct in London; a window that has started anchors at today
    const { d } = setup(undefined, { now: '2026-10-18T23:30:00.000Z' });
    const q = { ...Q, departureFrom: asIsoDate('2026-10-15'), departureTo: asIsoDate('2026-10-28') };
    const cells = d.plan(q).flatMap((t) => t.coveredCells);
    const later = cells.filter((c) => c.departureDate > '2026-10-19');
    const [first] = d.plan({ ...q, cells: later });
    expect(first?.request.kind === 'grid-path' && first.request.start.departureDate).toBe('2026-10-22');
  });
  it('sends the grid path, reserves its planned scrolls, and maps priced cells with their source and Google’s mark', async () => {
    const { d, budget } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    let sent: unknown;
    const marked = view();
    const c0 = marked.cells[24];
    if (c0 !== undefined) marked.cells[24] = { ...c0, mark: 'low', amountMinor: 39_700 };
    server.use(
      http.post(URL_, async ({ request }) => {
        sent = await body(request);
        return HttpResponse.json(answer({ views: [marked], scrolls: 0 }), contacted);
      }),
    );
    const r = await d.fetchTile(tile, Q, ctx);
    if (r.kind !== 'tile') throw new Error('tile');
    expect(sent).toEqual({
      mode: 'grid',
      origin: 'LHR',
      destination: 'JFK',
      gl: 'GB',
      start: { departureDate: '2027-03-14', returnDate: '2027-03-24' },
      moves: [],
      reads: [true],
      scrollAllowance: 0,
    });
    // why: a 10-night stay over seven departures is seven cells of the 49; the other 42 are outside the tile
    expect(r.prices).toHaveLength(7);
    expect(r.prices.find((p) => p.departureDate === '2027-03-14')).toEqual({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-14',
      returnDate: '2027-03-24',
      amountMinor: 39_700,
      currency: 'GBP',
      returnDateSource: 'grid-cell',
      vendorPriceMark: 'low',
    });
    expect(r.notes).toContain('dropped-outside-tile:42');
    expect(r.cellIssues ?? []).toEqual([]);
    expect(budget.rowsOf('camoufox').map((x) => [x.scrolls, x.scrollCount])).toEqual([[0, 0]]);
  });
  it('a covered cell the view did not parse is an issue cell-unparsed; a structurally unparsed view, view-unparsed (PA-07)', async () => {
    const { d } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    const v = view({ unparsed: 1 });
    v.cells = v.cells.filter((c) => !(c.departureDate === '2027-03-11' && c.returnDate === '2027-03-21'));
    server.use(http.post(URL_, () => HttpResponse.json(answer({ views: [v] }), contacted)));
    const r = await d.fetchTile(tile, Q, ctx);
    if (r.kind !== 'tile') throw new Error('tile');
    expect(r.notes).toContain('unparsed:1@0');
    expect(r.cellIssues).toEqual([
      expect.objectContaining({
        reason: 'parse',
        detail: expect.stringContaining('cell-unparsed'),
        cell: expect.objectContaining({ departureDate: '2027-03-11' }),
      }),
    ]);
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(answer({ views: [view({ structural: 'unparsed', cells: [] })] }), contacted),
      ),
    );
    const s = await d.fetchTile(tile, Q, ctx);
    expect(s.kind === 'tile' && s.cellIssues?.map((i) => i.detail.split(' ')[0])).toEqual(
      Array(7).fill('view-unparsed'),
    );
  });
  it.each([
    ['scroll-not-settled', 'page-not-ready'],
    ['off-plan', 'off-plan-view'],
    ['allowance', 'scroll-allowance'],
  ])('a page that ended %s leaves its unread cells as %s issues, resumable', async (ended, detail) => {
    const { d } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    server.use(http.post(URL_, () => HttpResponse.json(answer({ views: [], ended }), contacted)));
    const r = await d.fetchTile(tile, Q, ctx);
    if (r.kind !== 'tile') throw new Error('tile');
    expect(r.prices).toEqual([]);
    expect(r.cellIssues?.map((i) => [i.reason, i.detail.split(' ')[0]])).toEqual(
      Array(7).fill(['parse', detail]),
    );
    // why: PA M3: the words state only what is known, never a cause the page did not show
    for (const i of r.cellIssues ?? []) expect(i.detail).not.toMatch(/sale window/);
  });
  // why: ruling on N1 (2026-10-19): the no-flights line is generic; inside the horizon it says nothing of cells the page
  // never showed, so only the query cell is no data and every other planned cell stays unsearched
  it('inside the horizon a no-flights page is no data for its query cell only; the others are no-flights-unseen issues', async () => {
    const { d } = setup();
    const [tile] = d.plan(Q);
    if (tile?.request.kind !== 'grid-path') throw new Error('tile');
    expect(tile.request.probe).toBeUndefined();
    server.use(
      http.post(URL_, () => HttpResponse.json(answer({ views: [], ended: 'no-flights' }), contacted)),
    );
    const r = await d.fetchTile(tile, Q, ctx);
    if (r.kind !== 'tile') throw new Error('tile');
    expect([r.prices, r.noFares]).toEqual([[], []]);
    // why: the page asked 14 → 24 Mar, a covered cell; the six others were never shown
    expect(r.cellIssues?.map((i) => [i.cell.departureDate, i.reason, i.detail.split(' ')[0]])).toEqual(
      ['2027-03-11', '2027-03-12', '2027-03-13', '2027-03-15', '2027-03-16', '2027-03-17'].map((dep) => [
        dep,
        'parse',
        'no-flights-unseen',
      ]),
    );
    expect(r.notes).toContain('no-flights-inferred:1');
  });
  it('a joined page inside the horizon that lands on no flights leaves every later block unsearched', async () => {
    const { d } = setup({ executionPageCap: 1, executionScrollCap: 600, scrollCap: 30 });
    const wide = { ...Q, departureTo: asIsoDate('2027-03-31'), maxNights: 21 };
    server.use(
      http.post(URL_, () => HttpResponse.json(answer({ views: [], ended: 'no-flights' }), contacted)),
    );
    const tiles = d.plan(wide);
    expect(tiles.some((t) => t.request.kind === 'grid-path' && t.request.moves.length > 0)).toBe(true);
    for (const tile of tiles) {
      if (tile.request.kind !== 'grid-path') throw new Error('tile');
      const start = tile.request.start;
      const r = await d.fetchTile(tile, wide, ctx);
      if (r.kind !== 'tile') throw new Error('tile');
      const query = tile.coveredCells.filter(
        (c) => c.departureDate === start.departureDate && c.returnDate === start.returnDate,
      );
      expect((r.cellIssues ?? []).length).toBe(tile.coveredCells.length - query.length);
      expect((r.cellIssues ?? []).every((i) => i.detail.startsWith('no-flights-unseen'))).toBe(true);
    }
  });
  it('the probe page past the horizon is no data for every cell it covers (the sale window’s end)', async () => {
    const { d } = setup();
    // why: the kit's clock is 2026-10-14, so the horizon ends 2027-08-30
    const late = { ...Q, departureFrom: asIsoDate('2027-08-20'), departureTo: asIsoDate('2027-09-10') };
    const probe = d.plan(late).at(-1);
    if (probe?.request.kind !== 'grid-path') throw new Error('probe');
    expect(probe.request.probe).toBe(true);
    server.use(
      http.post(URL_, () => HttpResponse.json(answer({ views: [], ended: 'no-flights' }), contacted)),
    );
    const r = await d.fetchTile(probe, late, ctx);
    if (r.kind !== 'tile') throw new Error('tile');
    expect([r.prices, r.noFares, r.cellIssues ?? []]).toEqual([[], [], []]);
    expect(r.notes).toContain(`no-flights-inferred:${probe.coveredCells.length}`);
  });
  it('two views that both price one covered pair fail the tile: nothing from the page is stored (PA M1, CodeRabbit)', async () => {
    const { d } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(answer({ views: [view(), view({ index: 1 })], scrolls: 1 }), contacted),
      ),
    );
    const r = await d.fetchTile(tile, Q, ctx);
    if (r.kind !== 'tile-error') throw new Error(JSON.stringify(r));
    expect(r.error).toMatchObject({ kind: 'parse', retryable: false, reason: 'grid-cell-read-twice' });
    expect(r.coveredCells).toEqual(tile.coveredCells);
  });
  it('a blocked grid answer is the blocked tile-error and its scrolls reach the ledger row (CB-4)', async () => {
    const { d, budget } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-16T15:00:00.000Z', scrolls: 3 },
          { status: 423, ...contacted },
        ),
      ),
    );
    const r = await d.fetchTile(tile, Q, ctx);
    expect(r.kind === 'tile-error' && r.error.kind).toBe('blocked');
    expect(budget.rowsOf('camoufox').map((x) => x.scrollCount)).toEqual([3]);
  });
  it('the covered cells of a list of tiles partition the pair', () => {
    const { d } = setup();
    const keys = d
      .plan({ ...Q, departureTo: asIsoDate('2027-04-14'), maxNights: 21 })
      .flatMap((t) => t.coveredCells.map(cellKeyString));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
