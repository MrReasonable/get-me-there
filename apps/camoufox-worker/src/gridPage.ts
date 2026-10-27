/**
 * The grid page (spec §2 rev 34; plan decision 70; WP15 Task 15.4): the provider's own flow over one page whose Best
 * view has settled and passed the search-form and currency checks. It clicks the one "Price graph" button and, in the
 * dialog, the one "Dates" tab; settles the first view by two stable polls; then makes the request's moves, each at
 * least the scroll spacing after the last, each under its own budget inside the page's overall cap, each counted only
 * once its lines change and then hold still, never more than the request's allowance. A view is taken only once it
 * names every cell its lines call for (spec §2 rev 46); one still drawing when its settle's bound comes is taken as it
 * is, and the reading refuses it as it would any view short of cells. Every poll is classified first:
 * any blocked kind but unrecognised is that stop at once, and the session discards the page. A view that cannot be read
 * as the dates-grid view, or whose cells drift from the grammar, is `unrecognised`. A view whose dates are off the plan
 * but consistent is kept, flagged with its cause, and ends the page; a scroll that does not settle ends it too.
 */
import {
  type BlockedPage,
  GRID_HORIZON_DAYS,
  GRID_MOVE_BUDGET_MS,
  GRID_MOVE_RESERVE_MS,
  GRID_SIDE,
  type GridMove,
  type GridRequest,
  type GridView,
  type IsoDate,
} from '@gmt/core';
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
import {
  changeKeyOf,
  type Interpreted,
  interpretView,
  type RawView,
  readRawView,
  stillDrawing,
  viewCounts,
} from './gridView.js';
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
  | {
      kind: 'stop';
      page: BlockedPage;
      notes: string[];
      /**
       * The rule that stopped the page (spec §2 "Navigation and the stops"): the classifier's on a blocked poll inside
       * the dialog, else `grid:<why>`, with the first view's failing check (`grid:first-view:price`).
       */
      rule: string;
    };

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
  // why: the live run of 2026-10-18 on 8885ba8: every grid stop logs its rule at debug, with counts only (never a name,
  // a date or a URL), as the recorder's decision line does
  const unrecognised = (why: string, extra: Record<string, number | string> = {}): GridPageResult => {
    notes.push(why);
    // why: the grid runs of 2026-10-26: the answer carries the rule to the app, the first view's check included, and
    // the debug line names the same rule (CodeRabbit on PR #33)
    const rule = `grid:${why}${typeof extra.check === 'string' ? `:${extra.check}` : ''}`;
    o.steps.log?.debug(
      {
        cause: 'unrecognised',
        rule,
        elapsedMs: timers.now() - (o.steps.startedAt ?? timers.now()),
        ...extra,
      },
      'classifier decision',
    );
    return { kind: 'stop', page: 'unrecognised', notes, rule };
  };
  /** A poll inside the dialog that met a blocked kind: that stop, with the classifier's own rule. */
  const blocked = (b: { page: BlockedPage; rule: string }): GridPageResult => ({
    kind: 'stop',
    page: b.page,
    notes,
    rule: b.rule,
  });
  const rejected = (r: Extract<Interpreted, { kind: 'unrecognised' }>, raw: RawView): GridPageResult =>
    unrecognised(r.why, { ...(r.check === undefined ? {} : { check: r.check }), ...viewCounts(raw) });
  const so = { timers, pollMs: o.pollMs, S, reserveMs: GRID_MOVE_RESERVE_MS };
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
  // why: PIE M3: the check counts every "Price insights" dialog, so a second one fails it; the flow reads the first
  const dialogs = page.getByRole('dialog', { name: G.dialog, exact: true });
  const dialog = dialogs.nth(0);
  const opened = await settle('dialog', driver, d, so, steps, async (st) => {
    const n = await countOf(dialog, st);
    return { value: n, id: `dialog:${n}`, snapshot: n === 0 ? '' : await snapshotOf(dialog, st) };
  });
  if (opened.kind === 'blocked') return blocked(opened);
  const tab = dialog.getByRole('tab', { name: G.datesTab, exact: true });
  if ((await runStep('find-dates-tab', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(tab, st))) !== 1)
    return unrecognised('no-dates-tab');
  await click('click-dates-tab', tab.nth(0), d);

  const anchor = req.start.departureDate;
  /** One view after a click: settled (after a scroll, only once its lines changed; drawn, to the bound), read, checked. */
  const view = async (name: string, st0: Deadline, differsFrom: string | undefined, first: boolean) => {
    const s = await settle(
      name,
      driver,
      st0,
      so,
      steps,
      async (st) => {
        const p = await panelOf(dialog, st);
        const raw = await readRawView(dialogs, p.locator, st, S);
        return {
          value: raw,
          id: `panel:${p.index ?? 'dialog'}`,
          snapshot: await snapshotOf(p.locator, st),
          changeKey: changeKeyOf(raw),
          drawing: stillDrawing(raw.lines, raw.candidates.length, anchor),
        };
      },
      differsFrom,
    );
    if (s.kind === 'blocked') return s;
    const read = interpretView(
      s.value,
      anchor,
      first ? { dep: req.start.departureDate, ret: req.start.returnDate } : undefined,
      { unpriced: S.GRID_UNPRICED_VERIFIED },
    );
    return { kind: 'read' as const, read, key: changeKeyOf(s.value), raw: s.value };
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
  if (firstRead.kind === 'blocked') return blocked(firstRead);
  if (firstRead.read.kind === 'unrecognised') return rejected(firstRead.read, firstRead.raw);
  const views: GridView[] = [];
  let prev = firstRead.read;
  let prevKey = firstRead.key;
  // why: the departures and returns lines are the truth for what a view shows; a first view on other dates than planned
  // is kept and ends the page (ruling 11). Its cause is named only from what is known (fix round 1, PA M3): near today
  // when it starts at today or earlier, the sale window's end only when the planned block reaches within a block of the
  // planning horizon, and otherwise only that it shifted
  const plannedDeps = days(plus(req.start.departureDate, -3));
  const plannedRets = days(plus(req.start.returnDate, -3));
  if (!same(prev.departures, plannedDeps) || !same(prev.returns, plannedRets)) {
    const edge = plus(o.today, GRID_HORIZON_DAYS - GRID_SIDE);
    const cause =
      (prev.departures[0] ?? '') <= o.today
        ? 'near-today'
        : (plannedRets.at(-1) ?? '') >= edge || (plannedDeps.at(-1) ?? '') >= edge
          ? 'sale-window-end'
          : 'shifted';
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
    const dm = budget.nextFor(GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS);
    // why: PIE M4: the button is looked up in the whole dialog, which is stricter than the panel the view check counts
    // in: a second control of that name anywhere in the dialog is a page this app does not recognise
    const target = dialog.getByRole('button', { name: G.scroll[move], exact: true });
    if ((await runStep('find-scroll', LOOKUP_TIMEOUT_MS, dm, steps, (st) => countOf(target, st))) !== 1)
      return unrecognised('no-scroll-button');
    lastScrollAt = timers.now();
    // why: CodeRabbit on PR #9: a click that overruns its step may still have reached the page; it is counted before
    // the click, so the ledger never undercounts the scrolls
    o.counter.scrolls++;
    await click('click-scroll', target.nth(0), dm);
    let next: Awaited<ReturnType<typeof view>>;
    try {
      next = await view(`move-${i + 1}`, dm, prevKey, false);
    } catch (e) {
      if (e instanceof CheapestStepFailed) return { kind: 'grid', views, ended: 'scroll-not-settled', notes };
      throw e;
    }
    if (next.kind === 'blocked') return blocked(next);
    if (next.read.kind === 'unrecognised') return rejected(next.read, next.raw);
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
      if (!same(cur[other], prev[other]) || Math.sign(moved) !== want.sign)
        return unrecognised('wrong-move', { movedDays: moved, move: i + 1 });
      if (reads) views.push(toView(cur, i + 1, 'short-move'));
      return { kind: 'grid', views, ended: 'off-plan', notes };
    }
    if (reads) views.push(toView(cur, i + 1, null));
    prev = cur;
    prevKey = next.key;
  }
  return { kind: 'grid', views, ended: 'complete', notes };
}
