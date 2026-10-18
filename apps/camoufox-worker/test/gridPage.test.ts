// WP15 Task 15.4: the worker's grid page through the page session (spec §2 rev 34; decision 70). Fake browser objects
// and synthetic grids in the --grid recordings' shape (test/support/gridTree.ts); no Google page is loaded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate, type GridMove, type PageRequest } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { SELECTORS, type Selectors } from '../src/selectors.js';
import { type GridSettings, PageSession } from '../src/session.js';
import { loadSocs } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { type FakeNode, type FakePage, formNodes, n, resultsTree, text } from './support/fakePage.js';
import { gridTree, plusDays } from './support/gridTree.js';
import { memoryLog } from './support/log.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

const CAPTURE = {
  value: 'synthetic-socs-rejection-value',
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
const GRID: GridSettings = {
  mode: 'grid',
  spacingMs: 5000,
  scrollCap: 30,
  stepDays: { departures: 1, returns: 1 },
};
const req = (
  moves: GridMove[],
  o: { reads?: boolean[]; allowance?: number; dep?: string; ret?: string } = {},
): PageRequest => ({
  mode: 'grid',
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  gl: 'GB',
  start: { departureDate: asIsoDate(o.dep ?? '2027-03-14'), returnDate: asIsoDate(o.ret ?? '2027-03-24') },
  moves,
  reads: o.reads ?? [true, ...moves.map(() => true)],
  scrollAllowance: o.allowance ?? moves.length,
});
const best = (o: { adults?: string; currency?: string; dep?: string; ret?: string } = {}): FakeNode =>
  resultsTree({
    form: formNodes({ adults: o.adults ?? '1', dep: o.dep ?? 'Sun, 14 Mar', ret: o.ret ?? 'Wed, 24 Mar' }),
    extra: [n('button', 'Price graph'), ...(o.currency === undefined ? [] : [n('button', o.currency)])],
  });
const dialogPage = (g: FakeNode): FakeNode =>
  n('document', '', [...formNodes({ dep: 'Sun, 14 Mar', ret: 'Wed, 24 Mar' }), g]);

interface Run {
  tree?: FakeNode;
  grid?: GridSettings;
  selectors?: Selectors;
  /** The trees a view at (first departure, first return) shows, by its index. */
  view?: (dep: string, ret: string, index: number) => FakeNode[];
  /** Days a scroll actually moves (the synthetic page's step). */
  step?: number;
  onScroll?: (at: number) => void;
  today?: string;
  log?: ReturnType<typeof memoryLog>;
}
function setup(o: Run = {}) {
  const dataDir = tmpDir();
  writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const profileDir = join(dataDir, 'profile');
  mkdirSync(profileDir);
  const timers = fakeTimers();
  const clock = timers.clock;
  const contexts: FakeContext[] = [];
  const cooldown = new CooldownStore({ dir: dataDir, challengeHours: 48, clock });
  let at = { dep: '2027-03-11', ret: '2027-03-21' };
  let index = 0;
  const step = o.step ?? 1;
  const show = (pg: FakePage) =>
    pg.setTrees(
      o.view?.(at.dep, at.ret, index) ?? [
        dialogPage(gridTree({ depart: at.dep, ret: at.ret, rotate: index })),
      ],
    );
  const session = new PageSession({
    launch: async () => {
      const c = new FakeContext();
      c.navigations = [
        { hops: ['https://www.google.com/travel/flights?q=x', LANDED], tree: o.tree ?? best() },
      ];
      c.onNewPage = (pg) => {
        pg.onClick = (x) => {
          if (x.role === 'button' && x.name === 'Price graph')
            pg.setTrees([dialogPage(gridTree({ depart: at.dep, ret: at.ret, tab: 'graph' }))]);
          else if (x.role === 'tab' && x.name === 'Dates') show(pg);
          else if (x.role === 'button' && (x.name ?? '').startsWith('Scroll ')) {
            o.onScroll?.(timers.now());
            const dir = (x.name ?? '').slice(7);
            const dd = dir === 'right' ? step : dir === 'left' ? -step : 0;
            const dr = dir === 'down' ? step : dir === 'up' ? -step : 0;
            at = { dep: plusDays(at.dep, dd), ret: plusDays(at.ret, dr) };
            index++;
            show(pg);
          }
        };
      };
      contexts.push(c);
      mkdirSync(profileDir, { recursive: true });
      return c;
    },
    profileDir,
    socs: loadSocs(dataDir, clock),
    cooldown,
    pacer: new Pacer({ dir: dataDir, minSpacingSeconds: 30, clock }),
    refusal: new Refusal({ dir: dataDir, clock }),
    clock,
    timers,
    selectors: o.selectors ?? { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false },
    pageTimeoutMs: 90_000,
    log: o.log ?? memoryLog(),
    versions,
    grid: o.grid ?? GRID,
  });
  return { session, timers, cooldown, contexts };
}
const clicksOf = (t: ReturnType<typeof setup>) => t.contexts[0]?.pages[0]?.calls.clicks ?? [];

describe('grid pages: gating', () => {
  it('GRID_VERIFIED false, or CAMOUFOX_MODE=list, answers mode-unavailable without opening anything', async () => {
    for (const t of [
      setup({ selectors: { ...SELECTORS, GRID_VERIFIED: false } }),
      setup({ grid: { ...GRID, mode: 'list' } }),
    ]) {
      const r = await t.session.page(req(['down']));
      expect([r.answer.kind, r.googleContacted, t.contexts.length]).toEqual(['mode-unavailable', false, 0]);
    }
  });
  it('more moves than the worker’s scroll cap is rejected before any page', async () => {
    const t = setup({ grid: { ...GRID, scrollCap: 2 } });
    const r = await t.session.page(req(['down', 'down', 'down']));
    expect([r.rejected, r.googleContacted, t.contexts.length]).toEqual([true, false, 0]);
  });
});

// why: the live run of 2026-10-18 on 8885ba8 (LHR→JFK, departures 8–21 Mar 2027, 10–12 nights): the planner's first
// page is the block 8–14 Mar by 18–24 Mar, opened at 11 → 21 Mar; the range line sits inside the price line's element,
// as the recordings print it, and the first view was refused. It must be read, and a refusal must name its rule.
describe('grid pages: the live run’s first page', () => {
  it('the planner’s first block for 8–21 Mar, 10–12 nights, is read', async () => {
    const t = setup({
      tree: best({ dep: 'Thu, 11 Mar', ret: 'Sun, 21 Mar' }),
      view: () => [dialogPage(gridTree({ depart: '2027-03-08', ret: '2027-03-18' }))],
    });
    const r = await t.session.page(req([], { dep: '2027-03-11', ret: '2027-03-21' }));
    expect(r.answer).toMatchObject({ kind: 'grid', ended: 'complete', scrolls: 0 });
    expect(
      r.answer.kind === 'grid' && r.answer.views.map((v) => [v.cells.length, v.structural, v.offPlan]),
    ).toEqual([[49, 'ok', null]]);
  });
  it('a refused view logs the rule and the failing check with counts only', async () => {
    const log = memoryLog();
    const t = setup({
      tree: best({ dep: 'Thu, 11 Mar', ret: 'Sun, 21 Mar' }),
      view: () => [
        dialogPage(
          gridTree({ depart: '2027-03-08', ret: '2027-03-18', selected: ['2027-03-12', '2027-03-21'] }),
        ),
      ],
      log,
    });
    const r = await t.session.page(req([], { dep: '2027-03-11', ret: '2027-03-21' }));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
    const lines = log.lines.filter((l) => l.msg === 'classifier decision').map((l) => l.o);
    expect(lines[0]).toMatchObject({
      cause: 'unrecognised',
      rule: 'grid:first-view',
      check: 'selected-cell',
      candidates: 49,
      ranges: 1,
      prices: 1,
    });
    expect(lines[1]).toMatchObject({ cause: 'unrecognised', rule: 'grid:first-view' });
    expect(JSON.stringify(lines)).not.toMatch(/Mar|£|https?:/);
  });
});

describe('grid pages: the flow', () => {
  it('opens the first block, moves seven days down a scroll at a time 5 s apart, reads the planned views and counts the scrolls', async () => {
    const at: number[] = [];
    const t = setup({ onScroll: (x) => at.push(x) });
    const moves: GridMove[] = Array(7).fill('down');
    const r = await t.session.page(
      req(moves, { reads: [true, false, false, false, false, false, false, true] }),
    );
    if (r.answer.kind !== 'grid') throw new Error(JSON.stringify(r.answer));
    expect(clicksOf(t).slice(0, 2)).toEqual(['button:Price graph', 'tab:Dates']);
    expect(clicksOf(t).filter((c) => c === 'button:Scroll down')).toHaveLength(7);
    for (let i = 1; i < at.length; i++) expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(5000);
    expect(r.answer).toMatchObject({ scrolls: 7, ended: 'complete', currency: 'GBP', pointOfSale: 'GB' });
    expect(r.answer.versions.gridGrammar).toBe('2026-10-18');
    expect(
      r.answer.views.map((v) => [v.index, v.departures[0], v.returns[0], v.cells.length, v.offPlan]),
    ).toEqual([
      [0, '2027-03-11', '2027-03-21', 49, null],
      [7, '2027-03-11', '2027-03-28', 49, null],
    ]);
    expect(t.cooldown.active()).toBeNull();
  });
  it('a form showing two adults, or a currency other than GBP, is unrecognised and Price graph is never clicked (PA-12)', async () => {
    const two = setup({ tree: best({ adults: '2' }) });
    expect((await two.session.page(req(['down']))).answer).toMatchObject({
      kind: 'blocked',
      page: 'unrecognised',
      scrolls: 0,
    });
    expect(clicksOf(two)).toEqual([]);
    const usd = resultsTree({
      form: formNodes({ dep: 'Sun, 14 Mar', ret: 'Wed, 24 Mar' }),
      extra: [n('button', 'Price graph')],
    });
    for (const x of usd.children ?? []) if (x.name === 'Currency GBP') x.name = 'Currency USD';
    const other = setup({ tree: usd });
    expect((await other.session.page(req(['down']))).answer).toMatchObject({
      kind: 'blocked',
      page: 'unrecognised',
    });
    expect(clicksOf(other)).toEqual([]);
  });
  it('a challenge after a scroll is that stop with its cool-down and the scrolls made; no view is returned', async () => {
    const t = setup({
      view: (d, r, i) =>
        i < 2
          ? [dialogPage(gridTree({ depart: d, ret: r }))]
          : [n('document', '', [text('Our systems have detected unusual traffic')])],
    });
    const r = await t.session.page(req(['down', 'down', 'down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unusual-traffic', scrolls: 2 });
    expect(t.cooldown.active()?.cause).toBe('unusual-traffic');
  });
  it('a view that never changes after a scroll ends the page scroll-not-settled with the views read, no cool-down', async () => {
    // why: as run 4's `left` near today: the page does not move, so its lines never change
    const t = setup({ step: 0, view: (d, r) => [dialogPage(gridTree({ depart: d, ret: r }))] });
    const r = await t.session.page(req(['left', 'down']));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 1, ended: 'scroll-not-settled' });
    expect(r.answer.kind === 'grid' && r.answer.views).toHaveLength(1);
    expect(t.cooldown.active()).toBeNull();
  });
  it('a move on its axis by another step is an off-plan view, kept, ending the page (PIE-12)', async () => {
    const t = setup({ step: 2 });
    const r = await t.session.page(req(['down', 'down']));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 1, ended: 'off-plan' });
    expect(r.answer.kind === 'grid' && r.answer.views.map((v) => v.offPlan)).toEqual([null, 'short-move']);
  });
  it('a first view the sale window shifted to start at today is kept as near-today and ends the page', async () => {
    const t = setup({
      tree: best({ dep: 'Tue, 20 Oct', ret: 'Fri, 23 Oct' }),
      view: () => [
        dialogPage(
          gridTree({ depart: '2026-10-18', ret: '2026-10-20', selected: ['2026-10-20', '2026-10-23'] }),
        ),
      ],
    });
    const r = await t.session.page(req(['down'], { dep: '2026-10-20', ret: '2026-10-23' }));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 0, ended: 'off-plan' });
    expect(r.answer.kind === 'grid' && r.answer.views.map((v) => [v.offPlan, v.cells.length])).toEqual([
      ['near-today', 39],
    ]);
  });
  it('drift on a view is unrecognised, with no further scrolls', async () => {
    const t = setup({
      view: (d, r, i) => [
        dialogPage(
          gridTree(
            i === 0
              ? { depart: d, ret: r }
              : { depart: d, ret: r, names: (dd, rr) => `£450, from ${dd} to ${rr}` },
          ),
        ),
      ],
    });
    const r = await t.session.page(req(['down', 'down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised', scrolls: 1 });
  });
  it('the allowance stops the scrolls: 2 of 4 moves, ended allowance', async () => {
    const t = setup();
    const r = await t.session.page(req(['down', 'down', 'down', 'down'], { allowance: 2 }));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 2, ended: 'allowance' });
  });
  it('Google’s no-flights page (past the sale window) is a grid answer with no views', async () => {
    const t = setup({
      tree: n('document', '', [
        ...formNodes({ dep: 'Fri, 10 Sep', ret: 'Mon, 20 Sep' }),
        text('No flights found'),
        n('main', ''),
      ]),
    });
    const r = await t.session.page(req(['down'], { dep: '2027-09-10', ret: '2027-09-20' }));
    expect(r.answer).toMatchObject({ kind: 'grid', views: [], scrolls: 0, ended: 'no-flights' });
  });
});
