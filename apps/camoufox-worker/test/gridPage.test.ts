// WP15 Task 15.4: the worker's grid page through the page session (spec §2 rev 34; decision 70). Fake browser objects
// and synthetic grids in the --grid recordings' shape (test/support/gridTree.ts); no Google page is loaded.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate, asIsoDateTime, type GridMove, type PageRequest } from '@gmt/core';
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
  log?: ReturnType<typeof memoryLog>;
  /** The days a scroll in `dir` moves each axis, overriding `step` (a page that moves the wrong way). */
  moveOf?: (dir: string) => [number, number];
  /** What the Price graph click shows, overriding the dialog on its Price graph tab. */
  graph?: FakeNode;
  /** Called on each scroll with the context, to change its cookie jar. */
  onScrollContext?: (c: FakeContext) => void;
  pollMs?: number;
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
  const pacer = new Pacer({ dir: dataDir, minSpacingSeconds: 30, clock });
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
            pg.setTrees([o.graph ?? dialogPage(gridTree({ depart: at.dep, ret: at.ret, tab: 'graph' }))]);
          else if (x.role === 'tab' && x.name === 'Dates') show(pg);
          else if (x.role === 'button' && (x.name ?? '').startsWith('Scroll ')) {
            o.onScroll?.(timers.now());
            o.onScrollContext?.(c);
            const dir = (x.name ?? '').slice(7);
            const [dd, dr] = o.moveOf?.(dir) ?? [
              dir === 'right' ? step : dir === 'left' ? -step : 0,
              dir === 'down' ? step : dir === 'up' ? -step : 0,
            ];
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
    pacer,
    refusal: new Refusal({ dir: dataDir, clock }),
    clock,
    timers,
    selectors: o.selectors ?? { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false },
    pageTimeoutMs: 90_000,
    log: o.log ?? memoryLog(),
    versions,
    grid: o.grid ?? GRID,
    ...(o.pollMs === undefined ? {} : { pollMs: o.pollMs }),
  });
  return { session, timers, cooldown, contexts, pacer, profileDir };
}
const clicksOf = (t: ReturnType<typeof setup>) => t.contexts[0]?.pages[0]?.calls.clicks ?? [];
const decisions = (log: ReturnType<typeof memoryLog>) =>
  log.lines.filter((l) => l.msg === 'classifier decision').map((l) => l.o);

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
  // why: operator ruling 2026-10-25: CAMOUFOX_GRID_SCROLL_SPACING_SECONDS=0 is no pause between scroll clicks
  it('with a scroll spacing of 0 the scrolls do not wait; with 5 s they do', async () => {
    const run = async (spacingMs: number) => {
      const at: number[] = [];
      const t = setup({ grid: { ...GRID, spacingMs }, onScroll: (x) => at.push(x) });
      const moves: GridMove[] = Array(4).fill('down');
      const r = await t.session.page(req(moves, { reads: [true, false, false, false, true] }));
      expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 4, ended: 'complete' });
      return { gaps: at.slice(1).map((x, i) => x - (at[i] ?? 0)), sleeps: t.timers.sleeps };
    };
    const zero = await run(0);
    const five = await run(5000);
    expect(five.gaps.every((g) => g >= 5000)).toBe(true);
    expect(zero.gaps.every((g) => g < 5000)).toBe(true);
    expect(zero.sleeps.reduce((x, y) => x + y, 0)).toBeLessThan(five.sleeps.reduce((x, y) => x + y, 0));
  });
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

describe('grid pages: fix round 1 (the moves, the lookups and the settle)', () => {
  it.each([
    ['moves the other axis too', (dir: string): [number, number] => (dir === 'right' ? [1, 1] : [0, 0])],
    ['moves the wrong way', (dir: string): [number, number] => (dir === 'right' ? [-1, 0] : [0, 0])],
  ])(
    'a scroll that %s is unrecognised (grid:wrong-move): no view kept, no further click (PIE-12)',
    async (_l, moveOf) => {
      const log = memoryLog();
      const t = setup({ moveOf, log });
      const r = await t.session.page(req(['right', 'right']));
      expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised', scrolls: 1 });
      expect(clicksOf(t).filter((c) => c.startsWith('button:Scroll'))).toEqual(['button:Scroll right']);
      expect(decisions(log)[0]).toMatchObject({ cause: 'unrecognised', rule: 'grid:wrong-move', move: 1 });
    },
  );
  it('a re-render that only reorders the labels after a scroll is a scroll that did not settle, not a wrong move (PIE M2)', async () => {
    // why: the default view rotates its elements on every scroll; with a step of 0 its dates never change
    const t = setup({ step: 0 });
    const r = await t.session.page(req(['down', 'down']));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 1, ended: 'scroll-not-settled' });
    expect(t.cooldown.active()).toBeNull();
  });
  it('no Price graph button: unrecognised (grid:no-price-graph-button), nothing clicked', async () => {
    const log = memoryLog();
    const t = setup({
      tree: resultsTree({ form: formNodes({ dep: 'Sun, 14 Mar', ret: 'Wed, 24 Mar' }), extra: [] }),
      log,
    });
    const r = await t.session.page(req(['down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised', scrolls: 0 });
    expect(clicksOf(t)).toEqual([]);
    expect(decisions(log)[0]).toMatchObject({ rule: 'grid:no-price-graph-button' });
  });
  it('a dialog with no Dates tab: unrecognised (grid:no-dates-tab), no tab clicked', async () => {
    const log = memoryLog();
    const t = setup({
      graph: dialogPage(
        n('dialog', 'Price insights', [n('tablist', '', [n('tab', 'Price graph', [], { selected: true })])]),
      ),
      log,
    });
    const r = await t.session.page(req(['down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
    expect(clicksOf(t)).toEqual(['button:Price graph']);
    expect(decisions(log)[0]).toMatchObject({ rule: 'grid:no-dates-tab' });
  });
  it('a second "Scroll down" in the dialog, outside the panel: unrecognised (grid:no-scroll-button), never clicked', async () => {
    const log = memoryLog();
    const t = setup({
      log,
      view: (d, r) => {
        const g = gridTree({ depart: d, ret: r });
        g.children = [...(g.children ?? []), n('button', 'Scroll down')];
        return [dialogPage(g)];
      },
    });
    const r = await t.session.page(req(['down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised', scrolls: 0 });
    expect(clicksOf(t).filter((c) => c.startsWith('button:Scroll'))).toEqual([]);
    expect(decisions(log)[0]).toMatchObject({ rule: 'grid:no-scroll-button' });
  });
  it('two "Price insights" dialogs: not the dates-grid view (PIE M3)', async () => {
    const log = memoryLog();
    const t = setup({
      log,
      view: (d, r) => [
        n('document', '', [
          ...formNodes({ dep: 'Sun, 14 Mar', ret: 'Wed, 24 Mar' }),
          gridTree({ depart: d, ret: r }),
          gridTree({ depart: d, ret: r }),
        ]),
      ],
    });
    const r = await t.session.page(req([]));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
    expect(decisions(log)[0]).toMatchObject({ rule: 'grid:not-dates-grid', dialog: 2 });
  });
  it('a scroll click that overruns its step is counted: the ledger never undercounts (CodeRabbit)', async () => {
    const t = setup({
      view: (d, r) => {
        const g = gridTree({ depart: d, ret: r });
        const panel = (g.children ?? []).find((x) => x.role === 'tabpanel');
        for (const b of panel?.children ?? []) if (b.name === 'Scroll down') b.clickHang = true;
        return [dialogPage(g)];
      },
    });
    let done = false;
    const pending = t.session.page(req(['down', 'down'])).finally(() => {
      done = true;
    });
    // why: only the click's own step bound is pending once it hangs; the fake clock runs it out
    for (let i = 0; i < 80 && !done; i++) {
      for (let j = 0; j < 5; j++) await new Promise((res) => setImmediate(res));
      if (!done) t.timers.runOut();
    }
    const r = await pending;
    expect(r.answer).toMatchObject({ scrolls: 1 });
    expect(r.answer.kind).not.toBe('grid');
  });
  it('SOCS changed by a scroll: consent-unhandled, the profile wiped, the scroll counted', async () => {
    const t = setup({
      onScrollContext: (c) => {
        c.afterGoto = (jar) => jar;
        c.jar = c.jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'an-accept-value' } : x));
      },
    });
    const r = await t.session.page(req(['down']));
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'consent-unhandled', scrolls: 1 });
    expect(existsSync(t.profileDir)).toBe(false);
  });
  it('the pacer is released after a grid page, and the next page waits 30 s from this page’s start', async () => {
    const t = setup();
    const start = t.timers.now();
    await t.session.page(req(['down']));
    expect(t.timers.now() - start).toBeLessThan(30_000 - 2000);
    expect(t.pacer.claim().ok).toBe(false);
    t.timers.clock.set(asIsoDateTime(new Date(start + 30_000).toISOString()));
    const c = t.pacer.claim();
    t.pacer.release();
    expect(c.ok).toBe(true);
  });
  it('a view settles only once two polls 2 s apart match, however short the poll interval (ruling 9)', async () => {
    const log = memoryLog();
    const t = setup({ pollMs: 500, log });
    const r = await t.session.page(req([]));
    expect(r.answer).toMatchObject({ kind: 'grid', ended: 'complete' });
    const get = (o: object | undefined, k: string): unknown =>
      o === undefined ? undefined : Reflect.get(o, k);
    const polls = log.lines
      .filter((l) => l.msg === 'dialog poll' && get(l.o, 'view') === 'dates')
      .map((l) => l.o);
    const last = polls.at(-1);
    const firstSame = polls.find((p) => get(p, 'container') === get(last, 'container'));
    expect(get(last, 'stable')).toBe(true);
    expect(Number(get(last, 'elapsedMs')) - Number(get(firstSame, 'elapsedMs'))).toBeGreaterThanOrEqual(2000);
    expect(polls.length).toBeGreaterThanOrEqual(5);
  });
  it.each([
    [
      'a shifted first view far from both ends of the sale window is `shifted`',
      '2027-03-14',
      '2027-03-24',
      'shifted',
    ],
    [
      'a shifted first view at the end of the planning horizon is `sale-window-end`',
      '2027-09-01',
      '2027-09-11',
      'sale-window-end',
    ],
  ])('%s (PA M3)', async (_l, dep, ret, cause) => {
    const shown = (x: string) => {
      const d = new Date(`${x}T00:00:00Z`);
      return d
        .toUTCString()
        .slice(0, 11)
        .replace(/^(\w{3}), (\d{2}) (\w{3})$/, (_m, w, dd, mm) => `${w}, ${Number(dd)} ${mm}`);
    };
    const t = setup({
      tree: best({ dep: shown(dep), ret: shown(ret) }),
      view: () => [
        dialogPage(gridTree({ depart: plusDays(dep, -4), ret: plusDays(ret, -3), selected: [dep, ret] })),
      ],
    });
    const r = await t.session.page(req(['down'], { dep, ret }));
    expect(r.answer).toMatchObject({ kind: 'grid', scrolls: 0, ended: 'off-plan' });
    expect(r.answer.kind === 'grid' && r.answer.views.map((v) => v.offPlan)).toEqual([cause]);
  });
});
