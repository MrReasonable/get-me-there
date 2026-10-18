/**
 * The Price graph exploration (step 1 of a "graph" mode; observed 2026-10-18). Nobody yet knows how Google builds the
 * graph in the accessibility tree, so this module only looks: on a settled Best view it clicks the one button named
 * "Price graph" in the main frame, finds whichever dialog or region appeared after the click (no role names inside the
 * graph are assumed), polls until that region's printed snapshot holds still across two polls at least 2 s apart, and
 * lists the names and roles of the controls inside it. Every await is a timed step, logged as the Cheapest flow's are.
 *
 * The printed snapshot is stored for people to read, never parsed: nothing in the provider path imports this module
 * (rules.test.ts pins that), and only `record --graph-explore` calls it.
 */
import { createHash } from 'node:crypto';
import type { BlockedPage } from '@gmt/core';
import type { PageFacts } from './classify.js';
import { type ClassifyRule, classifyPageWithRule } from './classify.js';
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
  type SettleFacts,
  type StepOptions,
  timeoutOf,
} from './driver.js';
import { STABLE_MS } from './ready.js';
import type { Selectors } from './selectors.js';
import type { Deadline, Timers } from './timers.js';

/** The roles a graph container may take; whichever appeared after the click is the one recorded. */
export const REGION_ROLES = ['dialog', 'alertdialog', 'region'] as const;
export type RegionRole = (typeof REGION_ROLES)[number];
/** The controls listed inside the region, in this order. */
export const CONTROL_ROLES = ['button', 'tab', 'slider', 'option', 'link'] as const;
/** The bound on reading every control's name once the graph has settled. */
export const READ_CONTROLS_MS = 25_000;
/** Polling stops while this much of the deadline is left: one more poll and the control read must still fit. */
export const GRAPH_RESERVE_MS = POLL_TIMEOUT_MS + READ_CONTROLS_MS;
/** At most this many controls of one role are named (a graph may hold one per day); the rest are counted. */
export const MAX_CONTROLS_PER_ROLE = 1000;

/** One dialog or region on the page: its role, its index among that role's matches, and its accessible name. */
export interface RegionRef {
  role: RegionRole;
  index: number;
  name: string;
}

/** The dialogs and regions on the page, in role order then document order. */
async function listRegions(page: PageLike, d: Deadline): Promise<RegionRef[]> {
  const out: RegionRef[] = [];
  for (const role of REGION_ROLES) {
    const l = page.getByRole(role);
    for (let i = 0, n = await countOf(l, d); i < n; i++)
      out.push({ role, index: i, name: (await nameOf(l.nth(i), d)) ?? '' });
  }
  return out;
}

/** The first region in `after` beyond what `before` held of its role and name (a multiset difference). */
export function appeared(before: readonly RegionRef[], after: readonly RegionRef[]): RegionRef | null {
  const left = new Map<string, number>();
  for (const r of before)
    left.set(`${r.role}\u0000${r.name}`, (left.get(`${r.role}\u0000${r.name}`) ?? 0) + 1);
  for (const r of after) {
    const k = `${r.role}\u0000${r.name}`;
    const n = left.get(k) ?? 0;
    if (n === 0) return r;
    left.set(k, n - 1);
  }
  return null;
}

/** The region's locator, or the main landmark's when none appeared. */
function regionOf(page: PageLike, ref: RegionRef | null): LocatorLike {
  return ref === null ? page.getByRole('main').nth(0) : page.getByRole(ref.role).nth(ref.index);
}

/** A control inside the region: its role and accessible name (`null` when unreadable or longer than the limit). */
export interface Control {
  role: (typeof CONTROL_ROLES)[number] | 'gridcell';
  name: string | null;
}

async function readControls(
  region: LocatorLike,
  d: Deadline,
  S: Selectors,
): Promise<{ controls: Control[]; unnamed: Record<string, number> }> {
  const controls: Control[] = [];
  const unnamed: Record<string, number> = {};
  for (const role of CONTROL_ROLES) {
    const l = region.getByRole(role);
    const n = await countOf(l, d);
    for (let i = 0; i < Math.min(n, MAX_CONTROLS_PER_ROLE); i++) {
      const name = await nameOf(l.nth(i), d);
      controls.push({ role, name: name === null || name.length > S.maxNameLength ? null : name });
    }
    if (n > MAX_CONTROLS_PER_ROLE) unnamed[role] = n - MAX_CONTROLS_PER_ROLE;
  }
  return { controls, unnamed };
}

/** The chart region's rendered text and the elements inside it, by role and aria-label attribute (never HTML). */
export interface ChartRead {
  text: string;
  count: number;
  elements: Array<{ role: string | null; ariaLabel: string | null }>;
}
/** One settled view of the Dates tab: its panel, its printed snapshot, and its buttons' and day cells' names. */
export interface DatesRead {
  /** How many tabpanels the dialog held, and which (the first visible) was read; `index` null means the dialog. */
  panel: { found: number; index: number | null };
  snapshot: string;
  cells: Control[];
  polls: number;
}

type Facts = { page: PageFacts; settle: SettleFacts };
type Blocked = { kind: 'blocked'; page: BlockedPage; rule: ClassifyRule; facts: Facts };

/** What the exploration found, or the stop the classifier made on one of its polls. */
export type GraphOutcome =
  | {
      kind: 'explored';
      region: { role: RegionRole | 'main'; name: string; appeared: boolean };
      snapshot: string;
      controls: Control[];
      /** Controls past MAX_CONTROLS_PER_ROLE, by role, counted and not named. */
      unnamed: Record<string, number>;
      polls: number;
      classification: { kind: string; rule: ClassifyRule };
      facts: Facts;
      clickMs: number;
      /** The chart region's text and elements, or null when the dialog holds no such region. */
      chart: ChartRead | null;
      /** How many Dates tabs the dialog held; the tab is clicked only when there is exactly one. */
      datesTabs: number;
      dates: DatesRead | null;
      /** How many Scroll forwards buttons the dialog held; it is clicked once only when there is exactly one. */
      scrollButtons: number;
      scrolled: DatesRead | null;
      datesMs: number;
      scrollMs: number;
    }
  | Blocked;

export interface GraphOptions {
  timers: Timers;
  pollMs: number;
  S: Selectors;
  steps: StepOptions;
  /** What was clicked, appended in order (kept by the caller for a stop record). */
  clicked: string[];
  /** The page budget's next deadline (capped as the Cheapest flow's), started for the Dates tab; `d` otherwise. */
  next?: () => Deadline;
}

/** At most this many elements of the chart region are read. */
export const MAX_CHART_ELEMENTS = 1000;

async function readChart(region: LocatorLike, d: Deadline): Promise<ChartRead> {
  const text = await d.race(region.innerText(timeoutOf(d)));
  const all = region.locator('*');
  const count = await countOf(all, d);
  const elements: ChartRead['elements'] = [];
  for (let i = 0; i < Math.min(count, MAX_CHART_ELEMENTS); i++) {
    const el = all.nth(i);
    elements.push({
      role: await d.race(el.getAttribute('role', timeoutOf(d))),
      ariaLabel: await d.race(el.getAttribute('aria-label', timeoutOf(d))),
    });
  }
  return { text, count, elements };
}

/** The names of every button and day cell in the panel, buttons first. */
async function readCells(panel: LocatorLike, d: Deadline, S: Selectors): Promise<Control[]> {
  const out: Control[] = [];
  for (const role of ['button', 'gridcell'] as const) {
    const l = panel.getByRole(role);
    for (let i = 0, n = Math.min(await countOf(l, d), MAX_CONTROLS_PER_ROLE); i < n; i++) {
      const name = await nameOf(l.nth(i), d);
      out.push({ role, name: name === null || name.length > S.maxNameLength ? null : name });
    }
  }
  return out;
}

/** The first visible tabpanel in the container, or the container itself when none is. */
async function panelOf(
  container: LocatorLike,
  d: Deadline,
): Promise<{ locator: LocatorLike; found: number; index: number | null }> {
  const panels = container.getByRole('tabpanel');
  const found = await countOf(panels, d);
  for (let i = 0; i < found; i++)
    if (await d.race(panels.nth(i).isVisible())) return { locator: panels.nth(i), found, index: i };
  return { locator: container, found, index: null };
}

/**
 * Polls `find` (classified on every poll) until the printed snapshot it names holds still across two polls at least
 * STABLE_MS apart. `name` names the steps (`<name>-poll`) and the overrun (`<name>-settle`).
 */
async function settle<T>(
  name: string,
  driver: Pick<Driver, 'readFacts'>,
  d: Deadline,
  o: GraphOptions,
  steps: StepOptions,
  find: (st: Deadline) => Promise<{ value: T; id: string; snapshot: string }>,
): Promise<
  | {
      kind: 'settled';
      value: T;
      snapshot: string;
      polls: number;
      facts: Facts;
      rule: ClassifyRule;
      pageKind: string;
    }
  | Blocked
> {
  let previous: { key: string; at: number } | null = null;
  for (let polls = 1; ; polls++) {
    if (d.remaining() < GRAPH_RESERVE_MS) throw new CheapestStepFailed(`${name}-settle`, 'timed-out');
    const poll = await runStep(`${name}-poll`, POLL_TIMEOUT_MS, d, steps, async (st) => {
      const read = await driver.readFacts(st, { timers: o.timers, lookupMs: LOOKUP_TIMEOUT_MS });
      return { read, ...(await find(st)) };
    });
    const facts = { page: poll.read.page, settle: poll.read.settle };
    const { kind, rule } = classifyPageWithRule(facts.page, o.S);
    if (kind.kind === 'blocked' && kind.page !== 'unrecognised')
      return { kind: 'blocked', page: kind.page, rule, facts };
    const key = `${poll.id}:${createHash('sha256').update(poll.snapshot).digest('hex')}`;
    const at = o.timers.now();
    // why: settled means stable content: the same container and the same printed snapshot across two polls 2 s apart
    const stable =
      poll.snapshot.trim() !== '' &&
      previous !== null &&
      previous.key === key &&
      at - previous.at >= STABLE_MS;
    steps.log?.debug(
      {
        view: name,
        elapsedMs: at - (steps.startedAt ?? at),
        container: poll.id,
        snapshotLength: poll.snapshot.length,
        stable,
      },
      'graph poll',
    );
    if (stable)
      return {
        kind: 'settled',
        value: poll.value,
        snapshot: poll.snapshot,
        polls,
        facts,
        rule,
        pageKind: kind.kind,
      };
    previous = { key, at };
    await o.timers.sleep(o.pollMs, d.signal);
  }
}

/**
 * The exploration under the deadline `d`. A step that overruns or fails throws CheapestStepFailed naming it; the
 * deadline's own expiry surfaces as DeadlineExceeded. A poll the classifier reads as a blocked kind (other than
 * unrecognised, which a graph over the results may well read as) returns that stop at once.
 */
export async function exploreGraph(
  driver: Pick<Driver, 'readFacts'>,
  page: PageLike,
  d: Deadline,
  o: GraphOptions,
): Promise<GraphOutcome> {
  const { timers, S } = o;
  const steps: StepOptions = { ...o.steps, flow: 'graph' };
  const button = page.getByRole('button', { name: S.results.priceGraphButton, exact: true });
  // why: page locators reach the main frame only; exactly one button by its exact name, or nothing is clicked
  const found = await runStep('find-graph-button', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(button, st));
  if (found !== 1) throw new CheapestStepFailed('find-graph-button', 'not-found');
  const before = await runStep('list-regions', LOOKUP_TIMEOUT_MS, d, steps, (st) => listRegions(page, st));
  const clickAt = timers.now();
  await runStep('click-graph', CLICK_TIMEOUT_MS, d, steps, async (st) => {
    await st.race(button.nth(0).click(clickTimeoutOf(st)));
    o.clicked.push(`button:${S.results.priceGraphButton}`);
  });
  const clickMs = timers.now() - clickAt;
  const graph = await settle('graph', driver, d, o, steps, async (st) => {
    const ref = appeared(before, await listRegions(page, st));
    const snapshot = await st.race(
      regionOf(page, ref).ariaSnapshot({ timeout: Math.max(1, st.remaining()) }),
    );
    return { value: ref, id: `${ref?.role ?? 'main'}:${ref?.index ?? 0}:${ref?.name ?? ''}`, snapshot };
  });
  if (graph.kind === 'blocked') return graph;
  const ref = graph.value;
  const container = regionOf(page, ref);
  const read = await runStep('read-controls', READ_CONTROLS_MS, d, steps, (st) =>
    readControls(container, st, S),
  );
  const G = S.results.graphDialog;
  // why: request of 2026-10-18: the chart region's text and its elements' role and aria-label, bounded at 5 s
  const chart = await runStep('chart-text', LOOKUP_TIMEOUT_MS, d, steps, async (st) => {
    const region = container.getByRole('region', { name: G.chartRegion, exact: true });
    return (await countOf(region, st)) === 0 ? null : readChart(region.nth(0), st);
  });
  const base = {
    kind: 'explored' as const,
    region:
      ref === null
        ? { role: 'main' as const, name: '', appeared: false }
        : { role: ref.role, name: ref.name, appeared: true },
    snapshot: graph.snapshot,
    controls: read.controls,
    unnamed: read.unnamed,
    polls: graph.polls,
    classification: { kind: graph.pageKind, rule: graph.rule },
    facts: graph.facts,
    clickMs,
    chart,
  };
  // why: the Dates tab and the scroll are exploration only; a dialog without them is recorded as it is, counted
  const tab = container.getByRole('tab', { name: G.datesTab, exact: true });
  const datesTabs =
    ref === null ? 0 : await runStep('find-dates-tab', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(tab, st));
  const none = { datesTabs, dates: null, scrollButtons: 0, scrolled: null, datesMs: 0, scrollMs: 0 };
  if (datesTabs !== 1) return { ...base, ...none };
  // why: as the Cheapest flow: the Dates tab has its own budget from here, within twice the page timeout
  const dd = o.next?.() ?? d;
  const datesAt = timers.now();
  await runStep('click-dates-tab', CLICK_TIMEOUT_MS, dd, steps, async (st) => {
    await st.race(tab.nth(0).click(clickTimeoutOf(st)));
    o.clicked.push(`tab:${G.datesTab}`);
  });
  const view = async (name: string, readStep: string): Promise<DatesRead | Blocked> => {
    const s = await settle(name, driver, dd, o, steps, async (st) => {
      const p = await panelOf(container, st);
      const snapshot = await st.race(p.locator.ariaSnapshot({ timeout: Math.max(1, st.remaining()) }));
      return { value: p, id: `panel:${p.index ?? 'dialog'}`, snapshot };
    });
    if (s.kind === 'blocked') return s;
    const cells = await runStep(readStep, READ_CONTROLS_MS, dd, steps, (st) =>
      readCells(s.value.locator, st, S),
    );
    return {
      panel: { found: s.value.found, index: s.value.index },
      snapshot: s.snapshot,
      cells,
      polls: s.polls,
    };
  };
  const dates = await view('dates', 'read-dates-cells');
  if ('kind' in dates) return dates;
  const datesMs = timers.now() - datesAt;
  const scroll = container.getByRole('button', { name: G.scrollForwards, exact: true });
  const scrollButtons = await runStep('find-scroll-forwards', LOOKUP_TIMEOUT_MS, dd, steps, (st) =>
    countOf(scroll, st),
  );
  if (scrollButtons !== 1) return { ...base, ...none, datesTabs, dates, scrollButtons, datesMs };
  const scrollAt = timers.now();
  await runStep('click-scroll-forwards', CLICK_TIMEOUT_MS, dd, steps, async (st) => {
    await st.race(scroll.nth(0).click(clickTimeoutOf(st)));
    o.clicked.push(`button:${G.scrollForwards}`);
  });
  const scrolled = await view('scroll', 'read-scrolled-cells');
  if ('kind' in scrolled) return scrolled;
  return { ...base, datesTabs, dates, scrollButtons, scrolled, datesMs, scrollMs: timers.now() - scrollAt };
}

/** Matches a URL's query and fragment: from `?` or `#` to the next space, quote or line end. */
const QUERY = /[?#][^\s"'<>]*/g;
/**
 * The snapshot with every query string and fragment removed from the URLs it prints (a link's `/url:` line, or any
 * absolute URL in a name), so no query is ever written (the recorder's rule).
 */
export function stripSnapshotQueries(snapshot: string): string {
  return snapshot
    .split('\n')
    .map((line) => {
      const url = /^(\s*- \/url: )(.*)$/.exec(line);
      if (url !== null) return `${url[1]}${(url[2] ?? '').replace(QUERY, '')}`;
      return line.replace(/\bhttps?:\/\/[^\s"'<>]+/g, (u) => u.replace(QUERY, ''));
    })
    .join('\n');
}
