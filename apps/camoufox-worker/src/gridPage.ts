/**
 * The grid page (spec §2 rev 34; plan decision 70; WP15 Task 15.4): the provider's own flow over one page whose Best
 * view has settled and passed the search-form and currency checks. It clicks the one "Price graph" button and, in the
 * dialog, the one "Dates" tab; settles the first view by two stable polls; then makes the request's moves, each at
 * least the scroll spacing after the last, each under its own budget inside the page's overall cap, each counted only
 * once its lines change and then hold still, never more than the request's allowance. Every poll is classified first:
 * any blocked kind but unrecognised is that stop at once, and the session discards the page. A view that cannot be read
 * as the dates-grid view, or whose cells drift from the grammar, is `unrecognised`. A view whose dates are off the plan
 * but consistent is kept, flagged with its cause, and ends the page; a scroll that does not settle ends it too.
 */
import type { BlockedPage, GridMove, GridRequest, GridView, IsoDate } from '@gmt/core';
import type { PageBudget } from './budget.js';
import { panelOf, settle, snapshotOf } from './dialogSettle.js';
import {
  CheapestStepFailed,
  CLICK_TIMEOUT_MS,
  clickTimeoutOf,
  countOf,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  type LocatorLike,
  type PageLike,
  runStep,
  type StepOptions,
} from './driver.js';
import { MOVE_BUDGET_MS, MOVE_RESERVE_MS } from './gridRecord.js';
import { changeKeyOf, type Interpreted, interpretView, readRawView } from './gridView.js';
import type { Selectors } from './selectors.js';
import type { Deadline, Timers } from './timers.js';

export interface GridPageOptions {
  timers: Timers;
  pollMs: number;
  S: Selectors;
  steps: StepOptions;
  /** Scroll clicks start at least this far apart (CAMOUFOX_GRID_SCROLL_SPACING_SECONDS). */
  spacingMs: number;
  /** Days one scroll moves on each axis (the dated, measured step). */
  stepDays: { departures: number; returns: number };
  /** Today at the operator's machine, for a first view the sale window shifted. */
  today: IsoDate;
  /** What was clicked and how many scrolls were made so far, kept by the caller for a stop or a deadline. */
  counter: { scrolls: number };
}

export type GridPageResult =
  | {
      kind: 'grid';
      views: GridView[];
      ended: 'complete' | 'scroll-not-settled' | 'off-plan' | 'allowance';
      notes: string[];
    }
  | { kind: 'stop'; page: BlockedPage; notes: string[] };

const plus = (iso: string, k: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const days = (from: string, n = 7): string[] =>
  Array.from({ length: n }, (_v, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type Read = Extract<Interpreted, { kind: 'view' }>;

/** Where the view after `move` should show its dates, from the view before it. */
function expected(prev: Read, move: GridMove, step: { departures: number; returns: number }) {
  const dDep = move === 'right' ? step.departures : move === 'left' ? -step.departures : 0;
  const dRet = move === 'down' ? step.returns : move === 'up' ? -step.returns : 0;
  const first = (xs: readonly string[]): string => xs[0] ?? '';
  return {
    departures: days(plus(first(prev.departures), dDep)),
    returns: days(plus(first(prev.returns), dRet)),
    axis: move === 'left' || move === 'right' ? 'departures' : 'returns',
    sign: move === 'right' || move === 'down' ? 1 : -1,
  } as const;
}

export async function gridPage(
  driver: Driver,
  page: PageLike,
  budget: PageBudget,
  req: GridRequest,
  o: GridPageOptions,
): Promise<GridPageResult> {
  const { timers, S } = o;
  const G = S.results.dateGrid;
  const steps: StepOptions = { ...o.steps, flow: 'grid' };
  const notes: string[] = [];
  const unrecognised = (why: string): GridPageResult => {
    notes.push(why);
    return { kind: 'stop', page: 'unrecognised', notes };
  };
  const so = { timers, pollMs: o.pollMs, S, reserveMs: MOVE_RESERVE_MS };
  const click = (name: string, l: LocatorLike, st0: Deadline) =>
    runStep(name, CLICK_TIMEOUT_MS, st0, steps, async (st) => {
      await st.race(l.click(clickTimeoutOf(st)));
    });
  const button = page.getByRole('button', { name: S.results.priceGraphButton, exact: true });
  const d0 = budget.d;
  if ((await runStep('find-graph-button', LOOKUP_TIMEOUT_MS, d0, steps, (st) => countOf(button, st))) !== 1)
    return unrecognised('no-price-graph-button');
  // why: as the Cheapest flow: the dialog has its own budget from the first click, within twice the page timeout
  const d = budget.next();
  await click('click-graph', button.nth(0), d);
  const dialog = page.getByRole('dialog', { name: G.dialog, exact: true }).nth(0);
  const opened = await settle('dialog', driver, d, so, steps, async (st) => {
    const n = await countOf(dialog, st);
    return { value: n, id: `dialog:${n}`, snapshot: n === 0 ? '' : await snapshotOf(dialog, st) };
  });
  if (opened.kind === 'blocked') return { kind: 'stop', page: opened.page, notes };
  const tab = dialog.getByRole('tab', { name: G.datesTab, exact: true });
  if ((await runStep('find-dates-tab', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(tab, st))) !== 1)
    return unrecognised('no-dates-tab');
  await click('click-dates-tab', tab.nth(0), d);

  const anchor = req.start.departureDate;
  /** One view after a click: settled (after a scroll, only once its lines changed), read and checked. */
  const view = async (name: string, st0: Deadline, differsFrom: string | undefined, first: boolean) => {
    const s = await settle(
      name,
      driver,
      st0,
      so,
      steps,
      async (st) => {
        const p = await panelOf(dialog, st);
        const raw = await readRawView(dialog, p.locator, st, S);
        return {
          value: raw,
          id: `panel:${p.index ?? 'dialog'}`,
          snapshot: await snapshotOf(p.locator, st),
          changeKey: changeKeyOf(raw),
        };
      },
      differsFrom,
    );
    if (s.kind === 'blocked') return s;
    const read = interpretView(
      s.value,
      anchor,
      first ? { dep: req.start.departureDate, ret: req.start.returnDate } : undefined,
    );
    return { kind: 'read' as const, read, key: changeKeyOf(s.value) };
  };
  const toView = (r: Read, index: number, offPlan: GridView['offPlan']): GridView => ({
    index,
    departures: r.departures,
    returns: r.returns,
    cells: r.cells,
    unparsed: r.unparsed,
    structural: r.structural,
    offPlan,
  });

  const firstRead = await view('dates', d, undefined, true);
  if (firstRead.kind === 'blocked') return { kind: 'stop', page: firstRead.page, notes };
  if (firstRead.read.kind === 'unrecognised') return unrecognised(firstRead.read.why);
  const views: GridView[] = [];
  let prev = firstRead.read;
  let prevKey = firstRead.key;
  // why: the departures and returns lines are the truth for what a view shows; a first view the sale window shifted
  // (its first departure at today, or later than planned at the window's end) is kept and ends the page (ruling 11)
  const plannedDeps = days(plus(req.start.departureDate, -3));
  const plannedRets = days(plus(req.start.returnDate, -3));
  if (!same(prev.departures, plannedDeps) || !same(prev.returns, plannedRets)) {
    const cause = (prev.departures[0] ?? '') <= o.today ? 'near-today' : 'sale-window-end';
    if (req.reads[0] === true) views.push(toView(prev, 0, cause));
    return { kind: 'grid', views, ended: 'off-plan', notes };
  }
  if (req.reads[0] === true) views.push(toView(prev, 0, null));
  let lastScrollAt: number | null = null;
  for (const [i, move] of req.moves.entries()) {
    if (o.counter.scrolls >= req.scrollAllowance) return { kind: 'grid', views, ended: 'allowance', notes };
    // why: ruling 12: scroll clicks start at least the fixed spacing apart; never randomised
    const wait = lastScrollAt === null ? 0 : lastScrollAt + o.spacingMs - timers.now();
    if (wait > 0) await timers.sleep(wait);
    const dm = budget.nextFor(MOVE_BUDGET_MS + MOVE_RESERVE_MS);
    const target = dialog.getByRole('button', { name: G.scroll[move], exact: true });
    if ((await runStep('find-scroll', LOOKUP_TIMEOUT_MS, dm, steps, (st) => countOf(target, st))) !== 1)
      return unrecognised('no-scroll-button');
    lastScrollAt = timers.now();
    await click('click-scroll', target.nth(0), dm);
    o.counter.scrolls++;
    let next: Awaited<ReturnType<typeof view>>;
    try {
      next = await view(`move-${i + 1}`, dm, prevKey, false);
    } catch (e) {
      if (e instanceof CheapestStepFailed) return { kind: 'grid', views, ended: 'scroll-not-settled', notes };
      throw e;
    }
    if (next.kind === 'blocked') return { kind: 'stop', page: next.page, notes };
    if (next.read.kind === 'unrecognised') return unrecognised(next.read.why);
    const cur = next.read;
    const want = expected(prev, move, o.stepDays);
    const reads = req.reads[i + 1] === true;
    if (!same(cur.departures, want.departures) || !same(cur.returns, want.returns)) {
      // why: PIE-12: a move on its own axis, in its own direction, by another step (an edge of the sale window) is an
      // off-plan view; anything else is a page this app does not recognise
      const other = want.axis === 'departures' ? 'returns' : 'departures';
      const moved =
        (new Date(`${cur[want.axis][0] ?? ''}T00:00:00Z`).getTime() -
          new Date(`${prev[want.axis][0] ?? ''}T00:00:00Z`).getTime()) /
        86_400_000;
      if (!same(cur[other], prev[other]) || Math.sign(moved) !== want.sign) return unrecognised('wrong-move');
      if (reads) views.push(toView(cur, i + 1, 'short-move'));
      return { kind: 'grid', views, ended: 'off-plan', notes };
    }
    if (reads) views.push(toView(cur, i + 1, null));
    prev = cur;
    prevKey = next.key;
  }
  return { kind: 'grid', views, ended: 'complete', notes };
}
