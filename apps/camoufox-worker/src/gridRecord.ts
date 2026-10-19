/**
 * The date grid recording (WP15 Task 15.1; decision 70 and the round-1 rulings of 2026-10-18). On a settled Best view
 * it reads the results page's Cheapest tab and list minimum (to learn how the grid rounds against the list), clicks the
 * one "Price graph" button and, in the dialog "Price insights", the one "Dates" tab, then makes the named moves with the
 * four scroll buttons. Every view is settled (the first by two stable polls; each after a scroll only once its
 * departures or returns line has changed, then holds still) and classified on every poll; each scroll starts at least
 * the core's least scroll spacing after the last; each move has its own budget. It records what it reads, through locators, for
 * the grammar and the planner to be written from: the lines and labels with their element counts, the cell candidates in
 * order, the dates-grid check, and per move its timings and how many days each line moved. Nothing parses the printed
 * snapshot; it is stored for people to read. Only `record --grid` calls this module (rules.test.ts pins that).
 */
import { GRID_MIN_SCROLL_SPACING_SECONDS, GRID_MOVE_BUDGET_MS, GRID_MOVE_RESERVE_MS } from '@gmt/core';
import { type ClassifyRule, classifyPageWithRule } from './classify.js';
import { type Blocked, type Facts, panelOf, type Skipped, settle, snapshotOf, soft } from './dialogSettle.js';
import {
  CheapestStepFailed,
  CLICK_TIMEOUT_MS,
  clickTimeoutOf,
  countOf,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  type LocatorLike,
  nameOf,
  type PageLike,
  POLL_TIMEOUT_MS,
  runStep,
  type StepOptions,
  timeoutOf,
} from './driver.js';
import { parseOptionName } from './names.js';
import type { GridDirection } from './recordArgs.js';
import type { Selectors } from './selectors.js';
import type { Deadline, Timers } from './timers.js';

/** Scroll clicks start at least this far apart (ruling 12: 5 s, fixed, never randomised). */
const SPACING_MS = GRID_MIN_SCROLL_SPACING_SECONDS * 1000;
/** One view's read: the lines, the labels, the 49 candidates' names and the dates-grid check (the move's reserve). */
const READ_VIEW_MS = GRID_MOVE_RESERVE_MS;

const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} [A-Z][a-z]{2,3}';
/** One day label's whole text ("Thu 11 Mar"). */
const LABEL = new RegExp(`^${DAY}$`);
/** A text holding at least two day labels (recording 2 printed each line as one text). */
const LINE = new RegExp(`${DAY}.*${DAY}`);
// why: the recordings of 2026-10-18 print each line's labels with no space between them ("0000Thu 11 MarFri 12 Mar…"),
// so a token is matched without word boundaries, and its month by name (fix of the recorder's null deltas)
const DAY_TOKEN =
  /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)/g;
const SELECTED_LINE = /Round trip/;
const MONTH_INDEX: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Sept: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** What one settled view showed, read through locators. */
export interface ViewRead {
  index: number;
  snapshot: string;
  lines: { count: number; texts: string[] };
  labels: { count: number; texts: string[] };
  /** The panel's buttons other than the four scroll buttons, in document order (the cell candidates). */
  candidates: Array<string | null>;
  datesGrid: { dialog: number; datesSelected: number; grid: number; scrollButtons: number };
  selectedLines: string[];
  polls: number;
}
export type MoveRead =
  | {
      dir: GridDirection;
      clickMs: number;
      settleMs: number;
      readMs: number;
      polls: number;
      /** How many days the first departure and the first return moved (the measured step). */
      delta: { departures: number | null; returns: number | null };
    }
  | { dir: GridDirection; skipped: 'not-dates-grid' | 'no-button' }
  | ({ dir: GridDirection } & Skipped);

export interface ResultsRead {
  cheapestTabName: string;
  currencyName: string | null;
  /** The cheapest parsed result link in whole pounds (every link the page lists), or null when none parsed. */
  listMinimumPounds: number | null;
}

export type GridOutcome =
  | {
      kind: 'explored';
      results: ResultsRead | Skipped;
      views: ViewRead[];
      moves: MoveRead[];
      facts: Facts;
      classification: { kind: string; rule: ClassifyRule };
    }
  | Blocked;

export interface GridOptions {
  timers: Timers;
  pollMs: number;
  S: Selectors;
  steps: StepOptions;
  /** What was clicked, appended in order (kept by the caller for a stop record). */
  clicked: string[];
  moves: readonly GridDirection[];
  /** The page budget's next deadline (the Cheapest flow's), started at the Price graph click. */
  next: () => Deadline;
  /** A move's own deadline, never past the page's overall cap. */
  nextFor: (ms: number) => Deadline;
}

async function texts(l: LocatorLike, d: Deadline): Promise<{ count: number; texts: string[] }> {
  const count = await countOf(l, d);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push((await d.race(l.nth(i).textContent(timeoutOf(d)))) ?? '');
  return { count, texts: out };
}

/** The departures and the returns as their day tokens: from the two lines when the page prints lines, else the labels. */
function axes(v: Pick<ViewRead, 'lines' | 'labels'>): { departures: string[]; returns: string[] } {
  const tokens = (t: string): string[] => [...t.matchAll(DAY_TOKEN)].map((m) => `${m[1]} ${m[2]}`);
  if (v.lines.count >= 2)
    return { departures: tokens(v.lines.texts[0] ?? ''), returns: tokens(v.lines.texts[1] ?? '') };
  const all = v.labels.texts.flatMap(tokens);
  return { departures: all.slice(0, 7), returns: all.slice(7, 14) };
}

/** Days from `a` to `b` ("11 Mar" to "18 Mar" is 7), the nearer way round the year; null when either is unreadable. */
export function dayDelta(a: string | undefined, b: string | undefined): number | null {
  const at = (s: string | undefined): number | null => {
    const m = /^(\d{1,2}) ([A-Z][a-z]{2,3})$/.exec(s ?? '');
    const mon = m === null ? undefined : MONTH_INDEX[m[2] ?? ''];
    return m === null || mon === undefined ? null : Date.UTC(2001, mon, Number(m[1]));
  };
  const x = at(a);
  const y = at(b);
  if (x === null || y === null) return null;
  const days = Math.round((y - x) / 86_400_000);
  return days > 182 ? days - 365 : days < -182 ? days + 365 : days;
}

/**
 * How many days a line moved: the change in the mean of its dates, each counted from the old line's first (a scrolled
 * line's order is rotated, so first-to-first says nothing); null when a line is unreadable.
 */
export function shift(before: readonly string[], after: readonly string[]): number | null {
  const base = before[0];
  const offsets = (xs: readonly string[]): number[] | null => {
    const out = xs.map((x) => dayDelta(base, x));
    return out.every((x): x is number => x !== null) && out.length > 0 ? out : null;
  };
  const a = offsets(before);
  const b = offsets(after);
  if (a === null || b === null) return null;
  const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / xs.length;
  return Math.round(mean(b) - mean(a));
}

/** The lines' identity: what must change before a view after a scroll counts. */
const changeKeyOf = (v: Pick<ViewRead, 'lines' | 'labels'>): string =>
  `${v.lines.texts.join('|')}#${v.labels.texts.join('|')}`;

export async function exploreGrid(
  driver: Driver,
  page: PageLike,
  d: Deadline,
  o: GridOptions,
): Promise<GridOutcome> {
  const { timers, S } = o;
  const G = S.results.dateGrid;
  const scrollNames = [G.scroll.left, G.scroll.right, G.scroll.up, G.scroll.down];
  const steps: StepOptions = { ...o.steps, flow: 'grid' };
  // why: PA-10: the results page's own figures, read before anything is clicked, so the recording shows how the grid
  // rounds against the list
  const results = await soft(() =>
    runStep('read-results', POLL_TIMEOUT_MS, d, steps, async (st): Promise<ResultsRead> => {
      const list = await driver.listFacts(st);
      const pounds = list.names
        .map((n) => (n === null ? null : parseOptionName(n)))
        .flatMap((p) => (p === null ? [] : [p.amountMinor / 100]));
      return {
        cheapestTabName: list.cheapestTabName,
        currencyName: list.currencyName,
        listMinimumPounds: pounds.length === 0 ? null : Math.min(...pounds),
      };
    }),
  );
  const button = page.getByRole('button', { name: S.results.priceGraphButton, exact: true });
  const found = await runStep('find-graph-button', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(button, st));
  if (found !== 1) throw new CheapestStepFailed('find-graph-button', 'not-found');
  // why: as the Cheapest flow: the dialog has its own budget from the first click, within twice the page timeout
  const dd = o.next();
  const click = (name: string, l: LocatorLike, target: string, st0: Deadline) =>
    runStep(name, CLICK_TIMEOUT_MS, st0, steps, async (st) => {
      await st.race(l.click(clickTimeoutOf(st)));
      o.clicked.push(target);
    });
  await click('click-graph', button.nth(0), `button:${S.results.priceGraphButton}`, dd);
  const so = { timers, pollMs: o.pollMs, S, reserveMs: GRID_MOVE_RESERVE_MS };
  const dialogs = page.getByRole('dialog', { name: G.dialog, exact: true });
  const dialog = dialogs.nth(0);
  const opened = await settle('dialog', driver, dd, so, steps, async (st) => {
    const n = await countOf(dialogs, st);
    return { value: n, id: `dialog:${n}`, snapshot: n === 0 ? '' : await snapshotOf(dialog, st) };
  });
  if (opened.kind === 'blocked') return opened;
  const tab = dialog.getByRole('tab', { name: G.datesTab, exact: true });
  const tabs = await runStep('find-dates-tab', LOOKUP_TIMEOUT_MS, dd, steps, (st) => countOf(tab, st));
  if (tabs !== 1) throw new CheapestStepFailed('find-dates-tab', 'not-found');
  await click('click-dates-tab', tab.nth(0), `tab:${G.datesTab}`, dd);

  /** One view after a click: settled (after a scroll, only once changed), then read. */
  const view = async (
    name: string,
    st0: Deadline,
    index: number,
    differsFrom: string | undefined,
  ): Promise<
    { read: ViewRead; settleMs: number; readMs: number; facts: Facts; rule: ClassifyRule } | Blocked
  > => {
    const s0 = timers.now();
    const s = await settle(
      name,
      driver,
      st0,
      so,
      steps,
      async (st) => {
        const p = await panelOf(dialog, st);
        const lines = await texts(p.locator.getByText(LINE), st);
        const labels = await texts(p.locator.getByText(LABEL), st);
        return {
          value: p.locator,
          id: `panel:${p.index ?? 'dialog'}`,
          snapshot: await snapshotOf(p.locator, st),
          changeKey: changeKeyOf({ lines, labels }),
        };
      },
      differsFrom,
    );
    if (s.kind === 'blocked') return s;
    const settleMs = timers.now() - s0;
    const r0 = timers.now();
    const panel = s.value;
    const read = await runStep('read-view', READ_VIEW_MS, st0, steps, async (st): Promise<ViewRead> => {
      const buttons = panel.getByRole('button');
      const candidates: Array<string | null> = [];
      for (let i = 0, n = await countOf(buttons, st); i < n; i++) {
        const nm = await nameOf(buttons.nth(i), st);
        if (nm === null || !scrollNames.includes(nm)) candidates.push(nm);
      }
      let scrollButtons = 0;
      for (const nm of scrollNames)
        if ((await countOf(panel.getByRole('button', { name: nm, exact: true }), st)) === 1) scrollButtons++;
      return {
        index,
        snapshot: s.snapshot,
        lines: await texts(panel.getByText(LINE), st),
        labels: await texts(panel.getByText(LABEL), st),
        candidates,
        datesGrid: {
          dialog: await countOf(dialogs, st),
          datesSelected: await countOf(
            dialog.getByRole('tab', { name: G.datesTab, exact: true, selected: true }),
            st,
          ),
          grid: await countOf(panel.getByRole('grid', { name: G.grid, exact: true }), st),
          scrollButtons,
        },
        selectedLines: (await texts(panel.getByText(SELECTED_LINE), st)).texts,
        polls: s.polls,
      };
    });
    return { read, settleMs, readMs: timers.now() - r0, facts: s.facts, rule: s.rule };
  };

  const first = await view('dates', dd, 0, undefined);
  if ('kind' in first) return first;
  const views: ViewRead[] = [first.read];
  const moves: MoveRead[] = [];
  let last = first;
  const done = (): GridOutcome => ({
    kind: 'explored',
    results: results.ok ? results.value : results.skipped,
    views,
    moves,
    facts: last.facts,
    classification: { kind: classifyPageWithRule(last.facts.page, S).kind.kind, rule: last.rule },
  });
  const g = first.read.datesGrid;
  const firstDir = o.moves[0];
  if (firstDir !== undefined && !(g.dialog === 1 && g.datesSelected === 1 && g.scrollButtons === 4)) {
    moves.push({ dir: firstDir, skipped: 'not-dates-grid' });
    return done();
  }
  let lastScrollAt: number | null = null;
  for (const [i, dir] of o.moves.entries()) {
    // why: ruling 12: scroll clicks start at least the fixed spacing apart; never randomised
    const wait = lastScrollAt === null ? 0 : lastScrollAt + SPACING_MS - timers.now();
    if (wait > 0) await timers.sleep(wait);
    const dm = o.nextFor(GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS);
    const target = dialog.getByRole('button', { name: G.scroll[dir], exact: true });
    const step = await soft(async () => {
      const n = await runStep('find-scroll', LOOKUP_TIMEOUT_MS, dm, steps, (st) => countOf(target, st));
      if (n !== 1) return null;
      const c0 = timers.now();
      lastScrollAt = c0;
      await click('click-scroll', target.nth(0), `button:${G.scroll[dir]}`, dm);
      const clickMs = timers.now() - c0;
      const v = await view(`move-${i + 1}`, dm, i + 1, changeKeyOf(last.read));
      return { v, clickMs };
    });
    if (!step.ok) {
      moves.push({ dir, ...step.skipped });
      break;
    }
    if (step.value === null) {
      moves.push({ dir, skipped: 'no-button' });
      break;
    }
    const { v, clickMs } = step.value;
    if ('kind' in v) return v;
    const before = axes(last.read);
    const after = axes(v.read);
    moves.push({
      dir,
      clickMs,
      settleMs: v.settleMs,
      readMs: v.readMs,
      polls: v.read.polls,
      delta: {
        departures: shift(before.departures, after.departures),
        returns: shift(before.returns, after.returns),
      },
    });
    views.push(v.read);
    last = v;
  }
  return done();
}
