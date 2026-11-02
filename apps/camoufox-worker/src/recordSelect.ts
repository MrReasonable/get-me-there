/**
 * `record --select-outbound` (WP21 Task 21.0; spec §2 rev 55 "Recordings first"; the brief's §5 record.ts): the
 * return leg's research, on one results page under every rule the recorder applies. It runs the SERVED sequence
 * exactly as the page session does (the Best view settled and classified, the search form checked, the Cheapest flow
 * where the entry's CHEAPEST_FLOW_VERIFIED is set, falling back to the Best view as the session does), picks the
 * cheapest option on the departure day (the recorder has no airport names, so the day is its only cell check; ties by
 * page order), activates its link (focused, then Enter: the controller's ruling after recording 2) and records what
 * Google shows next. It then loads the list page afresh (the worker's own URL), runs the served sequence again and
 * selects the next-cheapest. Before each selection and the reload the pacer is re-claimed (the spacing waited out under
 * its own budget), and each step has its own page timeout, inside the page's cap of 6 page timeouts and 3 spacings.
 *
 * What it records is facts only: counts, booleans, the names the locators read (local-only recordings, decision 61),
 * the document loads the guard counted, and timings. A step that does not complete (a selection that finds no single
 * link, a view that never changes, a spacing wait past its budget, a step's own deadline) is recorded as such and ends
 * the page plainly, never as a stop and never as a page that did not settle; a blocked kind on any poll after an
 * activation or the reload is the stop it always is, with its cool-down. Nothing is clicked but the Cheapest flow's
 * names, and nothing activated but an option's own link. Only record.ts imports this module (rules.test.ts pins that).
 */
import type { BlockedPage, IsoDate, Logger } from '@gmt/core';
import type { PageBudget } from './budget.js';
import { type ClassifyRule, classifyPageWithRule, type PageFacts, type PageKind } from './classify.js';
import {
  classifyAfterFailedStep,
  type Driver,
  type FormFacts,
  type ListFacts,
  type PageLike,
  pathField,
  pathMoved,
  pathOf,
  pollUntilSettled,
  type SettleFacts,
  StepFailed,
  type StepOptions,
} from './driver.js';
import type { GuardState, HeldRefusal } from './guard.js';
import { parseOptionName } from './names.js';
import type { Pacer } from './pacer.js';
import { currencyOf, minorOf } from './pence.js';
import type { View } from './ready.js';
import type { Outcome } from './recordDialogs.js';
import { type StopFacts, stripQuery } from './recordWrite.js';
import {
  buttonNames,
  headingLevels,
  linkNames,
  mainButtonNames,
  roleCounts,
  tabNames,
} from './researchNames.js';
import { probeTarget, type TargetProbe } from './researchProbe.js';
import type { Selectors } from './selectors.js';
import { servedSequence } from './served.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

/**
 * The page's overall cap (ruling D7): six page timeouts (the first view, its Cheapest flow, a selection, the reload's
 * view, its Cheapest flow, a selection) and three spacings (before each selection and the reload), so every step can
 * spend its own page timeout.
 */
export function selectOutboundCapMs(pageTimeoutMs: number, spacingMs: number): number {
  return 6 * pageTimeoutMs + 3 * spacingMs;
}

/**
 * `--select-return`'s cap (Ian's rulings of 2026-11-01, D7 style): five page timeouts (the first view, its Cheapest
 * flow, the outbound's selection, the return's selection, the expansion) and three spacings (before each activation).
 */
export function selectReturnCapMs(pageTimeoutMs: number, spacingMs: number): number {
  return 5 * pageTimeoutMs + 3 * spacingMs;
}

/**
 * WP21 Task 21.3 (ruling A18, R-e2e): `--select-return --force-second`'s cap, the session's own budget for the full
 * served path: eight page timeouts (the first view, its Cheapest flow, the first selection, the reload, its Cheapest
 * flow, the second selection, the return's selection, the expansion) and one spacing (the reload's): 750,000 ms at the
 * defaults.
 */
export function selectForceSecondCapMs(pageTimeoutMs: number, spacingMs: number): number {
  return 8 * pageTimeoutMs + 1 * spacingMs;
}

/**
 * The bound on the one more read after a step's deadline, and on a step's research reads after its settle (twice the
 * recorder's finally bound, the --no-flights pattern).
 */
const LAST_READ_MS = 10_000;

/** What the recorder needs of the page and its own stop handling. */
export interface SelectPage {
  driver: Driver;
  page: PageLike;
  guard: GuardState;
  budget: PageBudget;
  pageStart: number;
  deps: { timers: Timers; log: Logger; pollMs: number; selectors: Selectors };
  /** The selectors the polls after a selection run under: the recorder's reading of the return view (flag on). */
  returnsS: Selectors;
  pacer: Pick<Pacer, 'reclaim' | 'spacingMs'>;
  pageMs: number;
  /** The worker's own list URL for the request (loaded again for the second selection). */
  url: string;
  request: { departureDate: IsoDate; returnDate: IsoDate };
  stepMs: Record<string, number>;
  clicked: string[];
  stop(p: BlockedPage, rule: string, facts?: StopFacts | null): Promise<Outcome>;
  /**
   * WP21 Task 21.3 (R-e2e): the first outbound's returns treated as not fitting, so the reload and the second
   * selection run before the return's selection and the expansion (`--select-return --force-second`).
   */
  forceSecond?: boolean;
  /**
   * WP21 Task 21.3 (R-worst): whether a spacing wait precedes each activation, as the research kinds of Task 21.0 did
   * (true by default); the end-to-end recording runs the served path, which spaces only the reload.
   */
  spaceActivations?: boolean;
}

/** One view's facts as the results kinds record them. */
interface ViewRead {
  page: PageFacts;
  settle: SettleFacts;
  names: Array<string | null>;
  list: ListFacts;
  form: FormFacts;
  headings: string[];
}

/** The steps after the first view, in order. */
type StepName = 'first-selection' | 'reload' | 'second-selection' | 'return-selection' | 'more-options';

/** Which option a selection activates, and how its views are read (Ian's ruling of 2026-11-01 adds the return). */
interface Selection {
  what: 'outbound' | 'return' | 'more-options';
  /** The target is a named link the probe can find (the expansion is a button by pattern: not probed). */
  probe: boolean;
  /** The view the pre-click signature and every poll after the activation read (preflight P5: the same one). */
  view: View;
  activate: Driver['clickOutbound'];
}
const outboundSelection = (c: SelectPage): Selection => ({
  what: 'outbound',
  probe: true,
  view: 'returns',
  activate: c.driver.clickOutbound,
});
const returnSelection = (c: SelectPage): Selection => ({
  what: 'return',
  probe: true,
  view: 'booking',
  activate: c.driver.clickReturn,
});
/** Ian's ruling of 2026-11-01 (open "more booking options"): the booking view's in-page expansion. */
const moreOptionsSelection = (c: SelectPage): Selection => ({
  what: 'more-options',
  probe: false,
  view: 'booking',
  activate: (_name, d, o, onActivate) => c.driver.clickMoreOptions(d, o, onActivate),
});

/** What a step showed once it settled, or (settled false) what one more read saw after its deadline. */
interface After {
  /**
   * The view's URL without its query, and whether the full URL differs from the one before the step (null when the
   * view before the step could not be read: unknown, never a change).
   */
  url: string;
  urlChanged: boolean | null;
  documentLoadsBefore: number;
  documentLoads: number;
  /**
   * R-settle's rule against the view before the step: another link signature, a return heading, or a further load;
   * null when the view before the step could not be read.
   */
  changedFromPreClick: boolean | null;
  classification: { kind: PageKind['kind']; rule: ClassifyRule };
  /** The reload's view: which view the served sequence read (absent after a selection). */
  view?: 'cheapest' | 'best-fallback' | 'best';
  page: PageFacts;
  settle: SettleFacts;
  /** The research reads, each null when their bound ran out before it (`readsOverran`). */
  names: Array<string | null> | null;
  list: ListFacts | null;
  form: FormFacts;
  linkNames: string[] | null;
  headings: string[] | null;
  buttonNames: string[] | null;
  tabNames: string[] | null;
  /** The research reads ran past their own bound; `settled` still says how the step itself ended. */
  readsOverran: boolean;
  /**
   * The booking view's structure (after the return's selection only): the headings at each level 1 to 6 and the
   * counts of the roles inside `main`; null when the reads' bound ran out before it.
   */
  booking?: { headingLevels: number[]; roleCounts: Record<string, number> } | null;
  /**
   * WP21 Task 21.3 (review M9), on a booking view: every button name in `main`, the scope the driver's `bookingFacts`
   * reads (the page-wide `buttonNames` may hold buttons outside it); null when the reads' bound ran out before it.
   */
  mainButtonNames?: string[] | null;
  /**
   * Ian's ruling of 2026-11-01 (open "more booking options"), on a booking view: the offers counted, the buttons the offer
   * pattern reads, further expansion controls, the cheapest offer against the return's "From" price as a word, and the
   * dialogs in main (counts and words only).
   */
  expansion?: {
    offers: number;
    offerGrammar: number;
    furtherMore: number;
    cheapestVsFrom: 'equal' | 'above' | 'below' | 'unknown';
    dialogs: number;
  };
  /** From the click (or the goto) to the settle; the spacing wait is apart, in `waitMs`. */
  stepMs: number;
  waitMs: number;
  settled: boolean;
}

interface StepRecord {
  step: StepName;
  waitMs?: number;
  waitTimedOut?: true;
  selectFailed?: string;
  /** After recording 1: the outbound's link as the probe read it just before the click (selections only). */
  target?: TargetProbe;
  /** After recording 1: why the activation could not land, as Playwright's call log named it (one word). */
  clickFailure?: string;
  /** After recording 2 (the controller's ruling): how the outbound's link was activated, once it was found. */
  activation?: 'keyboard';
  after?: After;
  /** The step's deadline passed and the one more read overran too. */
  lastReadOverran?: true;
  /** WP21 Task 21.3 (R-worst): a navigation the guard held back during the step (the gate, or past the reservation). */
  held?: HeldRefusal;
  /**
   * WP21 Task 21.3 (the controller's ruling on review I2): the main-frame documents the gate aborted during the step,
   * 0 included; an in-app activation has none, which the recorded suites assert.
   */
  gateRefusals?: number;
  /**
   * The same ruling: the main-frame documents the page started during the step, counted by the guard before the gate
   * (`documentStarts`), 0 included: 0 for an in-app activation, 1 for the reload. Unlike `documentLoads`, which the gate
   * keeps at 0 by construction, this can show an activation that tried to load a document.
   */
  documentStarts?: number;
}

type StepResult = { record: StepRecord; end: boolean } | { stop: Outcome };

/** The view before a step, for R-settle's rule and the URL comparison; url and signature null when it was not read. */
interface Before {
  url: string | null;
  loads: number;
  signature: string | null;
}

/** The served sequence's end: a stop, Google's no-flights line, or the view the session would read. */
type Served =
  | { kind: 'stop'; outcome: Outcome }
  | { kind: 'no-flights'; best: ViewRead }
  | {
      kind: 'read';
      best: ViewRead;
      cheapest: ViewRead | null;
      view: 'cheapest' | 'best-fallback' | null;
      shown: ViewRead;
    };

/** A pick: an option's whole link name and its index among the view's result links. */
export interface OutboundPick {
  name: string;
  linkIndex: number;
}

/**
 * The cheapest option the grammar reads whose departure day is the request's, ties by page order, never `exclude`
 * (the first pick, for the second selection); null when there is none.
 */
export function pickOf(
  list: Pick<ListFacts, 'names'>,
  /** The day the option must leave on: the request's departure date (an outbound) or its return date (a return). */
  on: IsoDate,
  exclude: string | null,
): OutboundPick | null {
  const month = Number(on.slice(5, 7));
  const day = Number(on.slice(8, 10));
  let best: (OutboundPick & { minor: number }) | null = null;
  for (const [linkIndex, name] of list.names.entries()) {
    if (name === null || name === exclude) continue;
    const o = parseOptionName(name);
    if (o === null || o.departsOn.month !== month || o.departsOn.day !== day) continue;
    // why: strictly cheaper only, so the first in page order wins a tie
    if (best === null || o.amountMinor < best.minor) best = { name, linkIndex, minor: o.amountMinor };
  }
  return best === null ? null : { name: best.name, linkIndex: best.linkIndex };
}

async function readView(c: SelectPage, facts: StopFacts, d: Deadline): Promise<ViewRead> {
  return {
    page: facts.page,
    settle: facts.settle,
    names: await c.driver.resultNames(d),
    list: await c.driver.listFacts(d),
    form: await c.driver.formFacts(d),
    headings: await c.driver.headingNames(d),
  };
}

/**
 * The served sequence (served.ts, the one the page session and the return phase run: WP21 Task 21.3 replaced this
 * module's copy), with each view read the moment it settles: the Best view (its form read there and handed back, so it
 * is read once), and the Cheapest view; a stop is recorded through the recorder's own stop handling. On a failed
 * Cheapest flow the Best view as it stands is read again (the session's honesty rule). The view-more click the session
 * makes only under VIEW_MORE_ADDS_CHEAPER is false on every entry and is not made.
 */
async function served(c: SelectPage, d0: Deadline, cheapestDeadline: () => Deadline): Promise<Served> {
  const { timers, log, pollMs } = c.deps;
  // why: assigned inside the hooks, so held in an object (a plain `let` would read as never assigned after the call)
  const views: { best: ViewRead | null; cheapest: ViewRead | null } = { best: null, cheapest: null };
  const end = await servedSequence(
    {
      driver: c.driver,
      S: c.deps.selectors,
      timers,
      log,
      pollMs,
      startedAt: c.pageStart,
      request: c.request,
    },
    d0,
    cheapestDeadline,
    {
      afterBest: async (s, d) => {
        views.best = await readView(c, s.facts, d);
        return views.best.form;
      },
      afterCheapest: async (s, d) => {
        views.cheapest = await readView(c, s.facts, d);
      },
      clicked: (names) => {
        c.clicked.push(...names);
      },
    },
  );
  if (end.kind === 'stop') return { kind: 'stop', outcome: await c.stop(end.page, end.rule, end.facts) };
  const best = views.best;
  // why: the sequence calls afterBest on every Best view it settles before any other end, so it is set here
  if (best === null) throw new Error('the served sequence ended without its Best view');
  if (end.kind === 'no-flights') return { kind: 'no-flights', best };
  if (end.view === 'cheapest' && views.cheapest !== null)
    return { kind: 'read', best, cheapest: views.cheapest, view: 'cheapest', shown: views.cheapest };
  if (end.view === 'best-fallback') {
    // why: the session's honesty rule: a failed Cheapest flow reads the Best view as it stands
    const shown = {
      ...best,
      names: await c.driver.resultNames(end.d),
      list: await c.driver.listFacts(end.d),
    };
    return { kind: 'read', best, cheapest: null, view: 'best-fallback', shown };
  }
  return { kind: 'read', best, cheapest: null, view: null, shown: best };
}

/** R-settle's rule, as pollUntilSettled applies it; null when the view before the step was not read. */
function changedOf(facts: StopFacts, before: Before, loads: number, view: View): boolean | null {
  if (before.signature === null) return null;
  return (
    facts.settle.linkSignature !== before.signature ||
    // why: as pollUntilSettled: the return heading is a change only into the return view
    (view === 'returns' && facts.page.text.returnHeading) ||
    // why: as pollUntilSettled (review M1): on the booking view the URL's move off the path before the step
    (view === 'booking' && before.url !== null && pathMoved(facts.page.url, pathOf(before.url))) ||
    loads > before.loads
  );
}

/**
 * The step's after: the settled (or last read) facts, then every research read under a bound of its own, so a read
 * that overruns never turns a settled step into an unsettled one (it is recorded as `readsOverran`).
 */
async function afterOf(
  c: SelectPage,
  o: {
    facts: StopFacts;
    before: Before;
    classification: { kind: PageKind['kind']; rule: ClassifyRule };
    listView: View;
    stepMs: number;
    waitMs: number;
    settled: boolean;
    view?: After['view'];
  },
): Promise<After> {
  // why: the step's facts are fixed before any research read, under a bound of the reads' own
  const documentLoads = c.guard.documentLoads;
  const h = c.deps.timers.deadline(LAST_READ_MS);
  let list: ListFacts | null = null;
  let form: FormFacts = null;
  let links: string[] | null = null;
  let headings: string[] | null = null;
  let buttons: string[] | null = null;
  let tabs: string[] | null = null;
  let booking: After['booking'] = null;
  let mainButtons: string[] | null = null;
  let readsOverran = false;
  try {
    list = await c.driver.listFacts(h, o.listView);
    form = await c.driver.formFacts(h);
    links = await linkNames(c.page, h);
    headings = await c.driver.headingNames(h);
    buttons = await buttonNames(c.page, h);
    tabs = await tabNames(c.page, h);
    if (o.listView === 'booking') {
      booking = { headingLevels: await headingLevels(c.page, h), roleCounts: await roleCounts(c.page, h) };
      mainButtons = await mainButtonNames(c.page, h);
    }
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    readsOverran = true;
  } finally {
    h.clear();
  }
  return {
    url: stripQuery(o.facts.page.url),
    urlChanged: o.before.url === null ? null : o.facts.page.url !== o.before.url,
    documentLoadsBefore: o.before.loads,
    documentLoads,
    changedFromPreClick: changedOf(o.facts, o.before, documentLoads, o.listView),
    classification: o.classification,
    ...(o.view === undefined ? {} : { view: o.view }),
    page: o.facts.page,
    settle: o.facts.settle,
    names: list?.names ?? null,
    list,
    form,
    linkNames: links,
    headings,
    buttonNames: buttons,
    tabNames: tabs,
    readsOverran,
    ...(o.listView === 'booking' ? { booking, mainButtonNames: mainButtons } : {}),
    stepMs: o.stepMs,
    waitMs: o.waitMs,
    settled: o.settled,
  };
}

/** The pacer re-claimed under its own budget (`budget.nextFor(spacingMs)`); a wait past it is the step's end. */
async function spacing(c: SelectPage): Promise<{ waitMs: number; timedOut: boolean }> {
  const { timers } = c.deps;
  const d = c.budget.nextFor(c.pacer.spacingMs);
  const t = timers.now();
  try {
    await c.pacer.reclaim(d, timers);
    return { waitMs: timers.now() - t, timedOut: false };
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    return { waitMs: timers.now() - t, timedOut: true };
  }
}

/**
 * A step whose own deadline passed: one more read under its own bound (the --no-flights pattern), classified (a
 * blocked kind is the stop), recorded `settled: false`, and the page ends plainly.
 */
async function unsettled(
  c: SelectPage,
  step: StepName,
  view: View,
  before: Before,
  started: number,
  waitMs: number,
): Promise<StepResult> {
  const { timers } = c.deps;
  const stepMs = timers.now() - started;
  const h = timers.deadline(LAST_READ_MS);
  try {
    const read = await c.driver.readFacts(h, undefined, view);
    const facts = { page: read.page, settle: read.settle };
    const k = classifyPageWithRule(
      read.page,
      view === 'returns' || view === 'booking' ? c.returnsS : c.deps.selectors,
      view,
    );
    if (k.kind.kind === 'blocked' && k.kind.page !== 'unrecognised')
      return { stop: await c.stop(k.kind.page, k.rule, facts) };
    const after = await afterOf(c, {
      facts,
      before,
      classification: { kind: k.kind.kind, rule: k.rule },
      listView: view,
      stepMs,
      waitMs,
      settled: false,
    });
    return { record: { step, waitMs, after }, end: true };
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    return { record: { step, waitMs, lastReadOverran: true }, end: true };
  } finally {
    h.clear();
  }
}

/** The guard's counters a step's record states the growth of (the ruling on review I2, M7). */
interface GuardCounts {
  gateRefusals: number;
  documentStarts: number;
  documentLoads: number;
  held: HeldRefusal | null;
}
function countsOf(g: GuardState): GuardCounts {
  return {
    gateRefusals: g.gateRefusals,
    documentStarts: g.documentStarts,
    documentLoads: g.documentLoads,
    held: g.held,
  };
}
/** Sets the step's `gateRefusals` and `documentStarts` to their growth since `before` (0 included); returns it. */
function withCounts(
  r: StepRecord,
  g: GuardState,
  before: GuardCounts,
): { gateRefusals: number; documentStarts: number } {
  r.gateRefusals = g.gateRefusals - before.gateRefusals;
  r.documentStarts = g.documentStarts - before.documentStarts;
  return { gateRefusals: r.gateRefusals, documentStarts: r.documentStarts };
}
/**
 * Review M7: whether the guard held a navigation since `before`: its first held refusal was set now, or a document
 * started that neither loaded nor was refused (the guard keeps only the page's first held kind, so a later hold shows
 * only in the counts). Never an older step's hold.
 */
function heldSince(g: GuardState, before: GuardCounts): boolean {
  if (g.held === null || g.refused !== null) return false;
  if (before.held === null) return true;
  return g.documentStarts - before.documentStarts > g.documentLoads - before.documentLoads;
}

/** One selection: spaced, the pre-click view read, the option's link activated, the view after it polled and read. */
async function selection(
  c: SelectPage,
  step: StepName,
  pick: OutboundPick,
  sel: Selection = outboundSelection(c),
): Promise<StepResult> {
  let target: TargetProbe | undefined;
  const before = countsOf(c.guard);
  const r = await selectionSteps(c, step, pick, sel, (t) => {
    target = t;
  });
  // why: the probe goes with the step's record however the step ended
  if ('record' in r && target !== undefined) r.record.target = target;
  if ('record' in r) {
    const grew = withCounts(r.record, c.guard, before);
    // why: WP21 Task 21.3: a navigation the gate held back during this step is recorded with it (a word, never a URL)
    if (grew.gateRefusals > 0 && c.guard.held !== null) r.record.held = c.guard.held;
  }
  if ('record' in r) {
    const rec = r.record;
    // why: the controller's ruling after recording 2: an Enter that left the view as it was within the step is a
    // selection that did not activate (the last read is kept beside it)
    if (
      rec.activation === 'keyboard' &&
      rec.after?.settled === false &&
      rec.after.changedFromPreClick === false
    )
      rec.selectFailed = `press-${sel.what}:no-activation`;
  }
  return r;
}

async function selectionSteps(
  c: SelectPage,
  step: StepName,
  pick: OutboundPick,
  sel: Selection,
  probed: (t: TargetProbe) => void,
): Promise<StepResult> {
  const { timers, log, pollMs } = c.deps;
  // why: R-worst: an activation loads no document, so the served path spaces none; the 21.0 research kinds still do
  const spaced = c.spaceActivations === false ? { waitMs: 0, timedOut: false } : await spacing(c);
  const waitMs = spaced.waitMs;
  if (spaced.timedOut) return { record: { step, waitTimedOut: true, waitMs }, end: true };
  const d = c.budget.nextFor(c.pageMs);
  // why: until the pre-click read answers, the view before the step is unknown (never a change by default)
  let before: Before = { url: null, loads: c.guard.documentLoads, signature: null };
  /** The keyboard activation was attempted (the link found, its focus and Enter begun), however its steps ended. */
  let attempted = false;
  let started = timers.now();
  try {
    // why: preflight P5: the pre-click signature by the return pattern, the same pattern every poll after it reads
    const pre = await c.driver.readFacts(d, undefined, sel.view);
    before = { url: pre.page.url, loads: c.guard.documentLoads, signature: pre.settle.linkSignature };
    // why: recording 1's click timed out: the target is probed first (matches, box, visibility, the hit test at its
    // centre), under its own bound, so the next recording says why a click cannot land
    if (sel.probe) probed(await probeTarget(c.page, pick.name, timers));
    started = timers.now();
    const steps: StepOptions = { timers, log, startedAt: c.pageStart, flow: `select-${sel.what}` };
    // why: WP21 Task 21.3 (R-worst): the recorder's activations run under the session's gate, from the press until the
    // view settles (Task 21.0's research ran before it)
    c.guard.activationGate = true;
    try {
      c.clicked.push(
        ...(await sel.activate(pick.name, d, steps, () => {
          attempted = true;
        })),
      );
    } catch (e) {
      c.guard.activationGate = false;
      if (e instanceof DeadlineExceeded || d.expired()) throw e;
      // why: a failed click may have left a page that is no results page at all: classified once, a block is its stop
      const blocked = await classifyAfterFailedStep(c.driver, d, steps, c.returnsS, sel.view);
      if (blocked !== null) return { stop: await c.stop(blocked.page, blocked.rule, blocked.facts) };
      const selectFailed = e instanceof StepFailed ? `${e.step}:${e.reason}` : 'click';
      const clickFailure = e instanceof StepFailed ? e.detail : undefined;
      return {
        record: {
          step,
          waitMs,
          selectFailed,
          ...(clickFailure === undefined ? {} : { clickFailure }),
          ...(attempted ? { activation: 'keyboard' as const } : {}),
        },
        end: true,
      };
    }
    const settled = await pollUntilSettled(c.driver, d, timers, pollMs, c.returnsS, {
      view: sel.view,
      log,
      startedAt: c.pageStart,
      changedFrom: {
        signature: pre.settle.linkSignature,
        documentLoads: before.loads,
        // why: review M1, as the session's poll: the booking view's change includes the URL's move to its path
        ...pathField(pre.page.url),
      },
      loads: () => c.guard.documentLoads,
    }).finally(() => {
      c.guard.activationGate = false;
    });
    if (settled.kind.kind === 'blocked' && settled.kind.page !== 'unrecognised')
      return { stop: await c.stop(settled.kind.page, settled.rule, settled.facts) };
    const stepMs = timers.now() - started;
    const after = await afterOf(c, {
      facts: settled.facts,
      before,
      classification: { kind: settled.kind.kind, rule: settled.rule },
      listView: sel.view,
      stepMs,
      waitMs,
      settled: true,
    });
    return { record: { step, waitMs, activation: 'keyboard', after }, end: false };
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    const r = await unsettled(c, step, sel.view, before, started, waitMs);
    if (attempted && 'record' in r) r.record.activation = 'keyboard';
    return r;
  }
}

/** The list page loaded afresh (the worker's own URL), spaced, and the served sequence run on it again. */
async function reload(c: SelectPage, before: Before): Promise<StepResult & { shown?: ViewRead }> {
  const counts = countsOf(c.guard);
  const r = await reloadSteps(c, before);
  if ('record' in r) withCounts(r.record, c.guard, counts);
  return r;
}

async function reloadSteps(c: SelectPage, before: Before): Promise<StepResult & { shown?: ViewRead }> {
  const { timers } = c.deps;
  const step: StepName = 'reload';
  const spaced = await spacing(c);
  const waitMs = spaced.waitMs;
  if (spaced.timedOut) return { record: { step, waitTimedOut: true, waitMs }, end: true };
  const d = c.budget.nextFor(c.pageMs);
  const b: Before = { ...before, loads: c.guard.documentLoads };
  const started = timers.now();
  // why: review M7: the guard's state before the load, so only a hold this load met is recorded as one
  const pre = countsOf(c.guard);
  try {
    try {
      await c.driver.goto(c.url, d);
    } catch (e) {
      // why: WP21 Task 21.3: a load the guard held back (past the reservation) loaded nothing: recorded, never a stop
      if (heldSince(c.guard, pre) && c.guard.held !== null)
        return { record: { step, waitMs, held: c.guard.held }, end: true };
      if (c.guard.refused === null) throw e;
      return { stop: await c.stop(c.guard.refused, `guard-refused:${c.guard.refused}`) };
    }
    c.clicked.push('goto');
    // why: the reload's Cheapest flow has a page timeout of its own, inside the page's cap (budget.next() caps at
    // twice one page timeout from the page's start, which the reload is past)
    const s = await served(c, d, () => c.budget.nextFor(c.pageMs));
    if (s.kind === 'stop') return { stop: s.outcome };
    const shown = s.kind === 'read' ? s.shown : s.best;
    const stepMs = timers.now() - started;
    const after = await afterOf(c, {
      facts: { page: shown.page, settle: shown.settle },
      before: b,
      classification:
        s.kind === 'read'
          ? { kind: 'results', rule: 'results' }
          : { kind: 'no-flights', rule: 'no-flights-line' },
      listView: 'best',
      stepMs,
      waitMs,
      settled: true,
      view: s.kind === 'read' ? (s.view ?? 'best') : 'best',
    });
    return { record: { step, waitMs, after }, end: s.kind !== 'read', shown };
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    return unsettled(c, step, 'best', b, started, waitMs);
  }
}

/** A booking view's offers as the expansion step records them (counts and a word; never a name or a price). */
function expansionOf(c: SelectPage, a: After, fromMinor: number | null): NonNullable<After['expansion']> {
  // why: review M9: the driver's own scope (main), where it was read; the page's buttons only when it was not
  const buttons = a.mainButtonNames ?? a.buttonNames ?? [];
  const offers = buttons.filter((b) => c.deps.selectors.booking.offer.test(b));
  // why: the review and the 21.0 Lows: each offer's currency is read from its own phrase (pence.ts, never assumed),
  // prices compare in that currency's minor units (core's ISO 4217 table), and only in the return's currency, which its
  // grammar states as pounds; an offer in any other currency, or one the helper does not know, makes it unknown
  const parsed = offers.map((b) => /for ([\d,]+) ([A-Za-z ]+)$/.exec(b));
  const read = parsed.map((m) => {
    const code = m === null ? null : currencyOf(m[2] ?? '');
    return code === 'GBP' ? minorOf(m?.[1] ?? '', code) : null;
  });
  const prices = read.every((x) => x !== null) ? read.filter((x) => x !== null) : [];
  const cheapest = prices.length === 0 ? null : Math.min(...prices);
  return {
    offers: a.page.resultLinks,
    offerGrammar: offers.length,
    furtherMore: buttons.filter((b) => c.deps.selectors.booking.moreOptions.test(b)).length,
    cheapestVsFrom:
      cheapest === null || fromMinor === null
        ? 'unknown'
        : cheapest === fromMinor
          ? 'equal'
          : cheapest > fromMinor
            ? 'above'
            : 'below',
    dialogs: (a.booking?.roleCounts.dialog ?? 0) + (a.booking?.roleCounts.alertdialog ?? 0),
  };
}

/** The console line's word for a step: counts, booleans and rule words only (never a name or a URL). */
function wordOf(r: StepRecord): string {
  if (r.waitTimedOut === true) return `${r.step} wait-timed-out`;
  if (r.selectFailed !== undefined)
    return `${r.step} select-failed ${r.selectFailed}${r.clickFailure === undefined ? '' : ` ${r.clickFailure}`}`;
  if (r.after === undefined) return `${r.step} not-settled last-read-overran`;
  const a = r.after;
  return `${r.step} ${a.settled ? 'settled' : 'not-settled'} documentloads=${a.documentLoads} changed=${a.changedFromPreClick}`;
}

/** The kind's interaction, from the settled first view to the last step; see the module's comment. */
export async function recordSelectOutbound(
  c: SelectPage,
  /** `select-return` (Ian's ruling of 2026-11-01): after the first selection, the cheapest return and the booking view. */
  kind: 'select-outbound' | 'select-return' = 'select-outbound',
): Promise<Outcome> {
  const t0 = c.deps.timers.now();
  const s = await served(c, c.budget.d, () => c.budget.next());
  if (s.kind === 'stop') return s.outcome;
  c.stepMs.served = c.deps.timers.now() - t0;
  const steps: StepRecord[] = [];
  const picks: OutboundPick[] = [];
  let last: StopFacts = { page: s.best.page, settle: s.best.settle };
  let headings = s.best.headings;
  const finish = (): Outcome => {
    const summary =
      `${kind}: first view ${s.best.page.resultLinks} links; picks ${picks.length}` +
      (steps.length === 0 ? '' : `; ${steps.map(wordOf).join('; ')}`);
    return {
      kind: 'read',
      data: {
        kind,
        landing: s.best.page.url,
        hops: [...c.guard.hops],
        best: s.best,
        cheapest: s.kind === 'read' ? s.cheapest : null,
        cheapestView: s.kind === 'read' ? s.view : null,
        clicked: c.clicked,
        picks,
        steps,
        // why: WP21 Task 21.3 (R-e2e): the end-to-end recording names itself, so the research suites leave it out and the
        // served-path suites find it
        ...(c.forceSecond === true ? { forceSecond: true } : {}),
      },
      noFlights: s.kind === 'no-flights',
      stepMs: c.stepMs,
      facts: last,
      clicked: c.clicked,
      headings,
      summary,
    };
  };
  /** Records a step's result; true when the page goes on. */
  const keep = (r: { record: StepRecord; end: boolean }): boolean => {
    steps.push(r.record);
    if (r.record.after !== undefined) {
      last = { page: r.record.after.page, settle: r.record.after.settle };
      headings = r.record.after.headings ?? headings;
      c.stepMs[r.record.step] = r.record.after.stepMs;
    }
    return !r.end;
  };
  if (s.kind === 'no-flights') {
    steps.push({ step: 'first-selection', selectFailed: 'no-flights' });
    return finish();
  }
  const first = pickOf(s.shown.list, c.request.departureDate, null);
  if (first === null) {
    steps.push({ step: 'first-selection', selectFailed: 'no-pick' });
    return finish();
  }
  picks.push(first);
  const r1 = await selection(c, 'first-selection', first);
  if ('stop' in r1) return r1.stop;
  if (!keep(r1) || r1.record.after === undefined) return finish();
  const a1 = r1.record.after;
  /** The return view the return is picked from: the first selection's, or (forced) the second's. */
  let at = a1;
  // why: --select-outbound always reloads for a second selection; --select-return does only with --force-second (R-e2e:
  // the first outbound's returns treated as not fitting, as the served path does when none fits)
  if (kind === 'select-outbound' || c.forceSecond === true) {
    const r2 = await reload(c, {
      url: a1.page.url,
      loads: a1.documentLoads,
      signature: a1.settle.linkSignature,
    });
    if ('stop' in r2) return r2.stop;
    if (!keep(r2) || r2.shown === undefined) return finish();
    const second = pickOf(r2.shown.list, c.request.departureDate, first.name);
    if (second === null) {
      steps.push({ step: 'second-selection', selectFailed: 'no-pick' });
      return finish();
    }
    picks.push(second);
    const r3 = await selection(c, 'second-selection', second);
    if ('stop' in r3) return r3.stop;
    if (!keep(r3) || r3.record.after === undefined) return finish();
    at = r3.record.after;
  }
  if (kind === 'select-outbound') return finish();
  // why: Ian's ruling of 2026-11-01: the cheapest return on the return date, picked as the outbound was, selected the
  // same way, and the booking view after it recorded; nothing on the booking view is activated
  // why: the review: a return is picked only from a view the classifier read as the return view
  if (at.classification.kind !== 'results' || at.classification.rule !== 'returns') {
    steps.push({ step: 'return-selection', selectFailed: 'not-return-view' });
    return finish();
  }
  const ret = at.names === null ? null : pickOf({ names: at.names }, c.request.returnDate, null);
  if (ret === null) {
    steps.push({ step: 'return-selection', selectFailed: 'no-pick' });
    return finish();
  }
  picks.push(ret);
  const rr = await selection(c, 'return-selection', ret, returnSelection(c));
  if ('stop' in rr) return rr.stop;
  const fromMinor = parseOptionName(ret.name)?.amountMinor ?? null;
  if (rr.record.after !== undefined) rr.record.after.expansion = expansionOf(c, rr.record.after, fromMinor);
  if (!keep(rr) || rr.record.after === undefined) return finish();
  const b = rr.record.after;
  // why: Ian's ruling of 2026-11-01 (open "more booking options"): only from a settled booking view with offers, on
  // the booking path (the classification, under the dated booking branch, is recorded beside it)
  const onBookingPath = ((): boolean => {
    try {
      return new URL(b.page.url).pathname === c.deps.selectors.booking.path;
    } catch {
      return false;
    }
  })();
  if (!b.settled || b.page.resultLinks === 0 || !onBookingPath) {
    steps.push({ step: 'more-options', selectFailed: 'not-booking-view' });
    return finish();
  }
  const rm = await selection(
    c,
    'more-options',
    { name: 'more-options', linkIndex: -1 },
    moreOptionsSelection(c),
  );
  if ('stop' in rm) return rm.stop;
  if (rm.record.after !== undefined) rm.record.after.expansion = expansionOf(c, rm.record.after, fromMinor);
  keep(rm);
  return finish();
}
