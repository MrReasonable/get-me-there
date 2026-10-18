// WP15 Task 15.7: the camoufox adapter in grid mode (spec §2, §5.2, §7 rev 34; decision 70): the plan from the measured
// step and the run's allowances, the grid-path request with its planned scrolls on the reservation, the answer mapped
// to prices with their return-date source and Google's mark, and every covered cell either priced, no data on the
// no-flights page, or an issue that names why. Synthetic worker answers (msw).
import { addDays, asIata, asIsoDate, cellKeyString, type GridView, type IsoDate } from '@gmt/core';
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
const status = (gridStepDays: unknown) => ({
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
});
function setup(grid = { executionPageCap: 100, executionScrollCap: 600, scrollCap: 30 }) {
  const { kit, budget, log, clock } = makeKit({ limits: testLimits() });
  const p = camoufoxProvider({
    http: kit,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
    grid: { mode: 'grid', ...grid },
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
  });
  it('the no-flights page (past the sale window) is no data for every covered cell: no price, no issue', async () => {
    const { d } = setup();
    const [tile] = d.plan(Q);
    if (tile === undefined) throw new Error('tile');
    server.use(
      http.post(URL_, () => HttpResponse.json(answer({ views: [], ended: 'no-flights' }), contacted)),
    );
    const r = await d.fetchTile(tile, Q, ctx);
    expect(r.kind === 'tile' && [r.prices, r.noFares, r.cellIssues ?? []]).toEqual([[], [], []]);
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
