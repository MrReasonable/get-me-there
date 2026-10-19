/**
 * The recorder's two dialog recordings (split from record.ts, fix round 1, CA 11): `--grid` (the date grid's views and
 * moves, gridRecord.ts) and `--graph-explore` (the Price graph exploration, graph.ts), each on a settled Best view,
 * under the page's budget, every step classified. A step that fails is classified once more under its own bound: a
 * blocked kind is that stop, with its cool-down; otherwise the recording ends plainly, naming the step. Only record.ts
 * imports this module (rules.test.ts pins that).
 */
import type { BlockedPage, Logger } from '@gmt/core';
import type { PageBudget } from './budget.js';
import { CheapestStepFailed, type Driver, type PageLike, type StepOptions } from './driver.js';
import { exploreGraph, stripSnapshotQueries } from './graph.js';
import { exploreGrid } from './gridRecord.js';
import type { GuardState } from './guard.js';
import type { View } from './ready.js';
import { type GridDirection, RecordingRefused } from './recordArgs.js';
import { type StopFacts, stripQuery } from './recordWrite.js';
import type { Selectors } from './selectors.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

/** What the classifier saw on a page, for a stop record (diagnostics of 2026-10-18). */
export interface Seen {
  facts: StopFacts | null;
  clicked: string[];
  headings: string[];
}
/** One page's outcome: the facts read (or what appeared), or the stop it met. */
export type Outcome =
  | ({
      kind: 'read';
      data: Record<string, unknown>;
      noFlights: boolean;
      stepMs: Record<string, number>;
    } & Seen)
  | { kind: 'appeared'; data: Record<string, unknown>; stepMs: Record<string, number> }
  | ({
      kind: 'stop';
      page: BlockedPage;
      rule: string;
      landing: string;
      hops: string[];
      stepMs: Record<string, number>;
    } & Seen);

/** The page a dialog recording runs on, and the recorder's own stop handling. */
export interface DialogPage {
  driver: Driver;
  page: PageLike;
  guard: GuardState;
  budget: PageBudget;
  /** The page's current deadline. */
  d: Deadline;
  pageStart: number;
  t0: number;
  deps: { timers: Timers; log: Logger; pollMs: number; selectors: Selectors };
  stepMs: Record<string, number>;
  clicked: string[];
  stop(p: BlockedPage, rule: string, facts?: StopFacts | null): Promise<Outcome>;
  classifyAfterFailedStep(cur: Deadline, steps: StepOptions, view: View): Promise<Outcome | null>;
}

/** `record --grid`: the date grid's views and the named moves. */
export async function recordGrid(
  c: DialogPage,
  settled: 'results' | 'no-flights',
  moves: readonly GridDirection[],
): Promise<Outcome> {
  let d = c.d;

  if (settled !== 'results')
    throw new RecordingRefused('the results page shows no flights; there is no date grid to record');
  const steps: StepOptions = { timers: c.deps.timers, log: c.deps.log, startedAt: c.pageStart, flow: 'grid' };
  try {
    const g = await exploreGrid(c.driver, c.page, d, {
      timers: c.deps.timers,
      pollMs: c.deps.pollMs,
      S: c.deps.selectors,
      steps,
      clicked: c.clicked,
      moves,
      next: () => {
        d = c.budget.next();
        return d;
      },
      nextFor: (ms) => {
        d = c.budget.nextFor(ms);
        return d;
      },
    });
    if (g.kind === 'blocked') return await c.stop(g.page, g.rule, g.facts);
    c.stepMs.read = c.deps.timers.now() - c.t0;
    return {
      kind: 'read',
      data: {
        kind: 'grid',
        landing: stripQuery(c.page.url()),
        hops: c.guard.hops.map(stripQuery),
        results: g.results,
        views: g.views.map((v) => ({ ...v, snapshot: stripSnapshotQueries(v.snapshot) })),
        moves: g.moves,
        clicked: c.clicked,
        classification: g.classification,
      },
      noFlights: false,
      stepMs: c.stepMs,
      facts: g.facts,
      clicked: c.clicked,
      headings: [],
    };
  } catch (e) {
    if (e instanceof DeadlineExceeded) throw e;
    const blocked = await c.classifyAfterFailedStep(d, steps, 'best');
    if (blocked !== null) return blocked;
    const step = e instanceof CheapestStepFailed ? `${e.step} (${e.reason})` : 'grid';
    throw new RecordingRefused(
      `the date grid recording ended at the ${step} step; the debug log has the step lines`,
    );
  }
}

/** `record --graph-explore`: the Price graph dialog, its Dates tab and a scroll. */
export async function recordGraph(c: DialogPage, settled: 'results' | 'no-flights'): Promise<Outcome> {
  let d = c.d;

  // why: a no-flights page has no graph; nothing is clicked and nothing stopped the page, so no cool-down
  if (settled !== 'results')
    throw new RecordingRefused('the results page shows no flights; there is no Price graph to explore');
  // why: as the Cheapest flow: the click and the graph's settle have their own page budget from here
  d = c.budget.next();
  const steps: StepOptions = {
    timers: c.deps.timers,
    log: c.deps.log,
    startedAt: c.pageStart,
    flow: 'graph',
  };
  const before = c.deps.timers.now();
  try {
    const g = await exploreGraph(c.driver, c.page, d, {
      timers: c.deps.timers,
      pollMs: c.deps.pollMs,
      S: c.deps.selectors,
      steps,
      clicked: c.clicked,
      next: () => {
        d = c.budget.next();
        return d;
      },
    });
    if (g.kind === 'blocked') return await c.stop(g.page, g.rule, g.facts);
    c.stepMs.click = g.clickMs;
    c.stepMs.graph = c.deps.timers.now() - before - g.datesMs - g.scrollMs;
    if (g.dates !== null) c.stepMs.dates = g.datesMs;
    if (g.scrolled !== null && 'snapshot' in g.scrolled) c.stepMs.scroll = g.scrollMs;
    c.stepMs.read = c.deps.timers.now() - c.t0;
    return {
      kind: 'read',
      data: {
        kind: 'graph-explore',
        landing: stripQuery(c.page.url()),
        hops: c.guard.hops.map(stripQuery),
        region: g.region,
        snapshot: stripSnapshotQueries(g.snapshot),
        controls: g.controls,
        unnamedControls: g.unnamed,
        // why: graph.ts strips the queries from the chart text and every panel snapshot as it reads them
        chart: g.chart,
        datesTabs: g.datesTabs,
        dates: g.dates,
        scrollButtons: g.scrollButtons,
        scrolled: g.scrolled,
        clicked: c.clicked,
        polls: g.polls,
        classification: g.classification,
      },
      noFlights: false,
      stepMs: c.stepMs,
      facts: g.facts,
      clicked: c.clicked,
      headings: [],
    };
  } catch (e) {
    if (e instanceof DeadlineExceeded) throw e;
    const blocked = await c.classifyAfterFailedStep(d, steps, 'best');
    if (blocked !== null) return blocked;
    // why: the step ends the recording plainly, naming it; no cool-down (nothing stopped the page)
    const step = e instanceof CheapestStepFailed ? `${e.step} (${e.reason})` : 'graph';
    throw new RecordingRefused(
      e instanceof CheapestStepFailed && e.step === 'graph-settle'
        ? `the Price graph did not settle within its budget (${step}); the debug log has the poll lines`
        : `the Price graph exploration ended at the ${step} step; the debug log has the step lines`,
    );
  }
}
