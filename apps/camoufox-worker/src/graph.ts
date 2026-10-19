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
import type { ClassifyRule } from './classify.js';
import {
  type Blocked,
  type Control,
  type Facts,
  MAX_CONTROLS_PER_ROLE,
  panelOf,
  readCells,
  type SettleOptions,
  type Skipped,
  settle,
  soft,
} from './dialogSettle.js';
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
export { type Control, MAX_CONTROLS_PER_ROLE, type Skipped } from './dialogSettle.js';

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

/**
 * The chart region, by text and attributes only (never HTML): its rendered text (10 s), its own aria-label and the
 * counts of its elements, images and buttons (5 s), then the first MAX_CHART_ELEMENTS elements' role and aria-label
 * (5 s). A part that overruns is null, listed in `skipped`, and `timedOut` is set.
 */
export interface ChartRead {
  text: string | null;
  ariaLabel: string | null;
  count: number | null;
  imgCount: number | null;
  buttonCount: number | null;
  elements: Array<{ role: string | null; ariaLabel: string | null }> | null;
  timedOut?: true;
  skipped?: Skipped[];
}
/** One settled view of the Dates tab: its panel, its printed snapshot, and its buttons' and day cells' names. */
export interface DatesRead {
  /** How many tabpanels the dialog held, and which (the first visible) was read; `index` null means the dialog. */
  panel: { found: number; index: number | null };
  snapshot: string;
  cells: Control[];
  polls: number;
}

/** What the exploration found, or the stop the classifier made on one of its polls. */
export type GraphOutcome =
  | {
      kind: 'explored';
      region: { role: RegionRole | 'main'; name: string; appeared: boolean };
      snapshot: string;
      controls: Control[] | Skipped;
      /** Controls past MAX_CONTROLS_PER_ROLE, by role, counted and not named. */
      unnamed: Record<string, number>;
      polls: number;
      classification: { kind: string; rule: ClassifyRule };
      facts: Facts;
      clickMs: number;
      /** The chart region's text and elements, or null when the dialog holds no such region. */
      chart: ChartRead | Skipped | null;
      /** How many Dates tabs the dialog held (null when the lookup overran); clicked only when exactly one. */
      datesTabs: number | null;
      dates: DatesRead | Skipped | null;
      /** How many Scroll forwards buttons the panel's dialog held (null when the lookup overran); clicked once only when exactly one. */
      scrollButtons: number | null;
      scrolled: DatesRead | Skipped | null;
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

/** At most this many elements of the chart region are read (ruling of 2026-10-18). */
export const MAX_CHART_ELEMENTS = 200;
/** The chart text's own bound (ruling of 2026-10-18). */
export const CHART_TEXT_MS = 10_000;

async function readChart(region: LocatorLike, d: Deadline, steps: StepOptions): Promise<ChartRead> {
  const skipped: Skipped[] = [];
  const part = async <T>(r: { ok: true; value: T } | { ok: false; skipped: Skipped }): Promise<T | null> => {
    if (r.ok) return r.value;
    skipped.push(r.skipped);
    return null;
  };
  const text = await part(
    await soft(() =>
      runStep('chart-text', CHART_TEXT_MS, d, steps, async (st) =>
        stripSnapshotQueries(await st.race(region.innerText(timeoutOf(st)))),
      ),
    ),
  );
  const all = region.locator('*');
  const summary = await part(
    await soft(() =>
      runStep('chart-summary', LOOKUP_TIMEOUT_MS, d, steps, async (st) => ({
        ariaLabel: await st.race(region.getAttribute('aria-label', timeoutOf(st))),
        count: await countOf(all, st),
        imgCount: await countOf(region.getByRole('img'), st),
        buttonCount: await countOf(region.getByRole('button'), st),
      })),
    ),
  );
  const elements =
    summary === null
      ? null
      : await part(
          await soft(() =>
            runStep('chart-elements', LOOKUP_TIMEOUT_MS, d, steps, async (st) => {
              const out: Array<{ role: string | null; ariaLabel: string | null }> = [];
              for (let i = 0; i < Math.min(summary.count, MAX_CHART_ELEMENTS); i++) {
                const el = all.nth(i);
                out.push({
                  role: await st.race(el.getAttribute('role', timeoutOf(st))),
                  ariaLabel: await st.race(el.getAttribute('aria-label', timeoutOf(st))),
                });
              }
              return out;
            }),
          ),
        );
  return {
    text,
    ariaLabel: summary?.ariaLabel ?? null,
    count: summary?.count ?? null,
    imgCount: summary?.imgCount ?? null,
    buttonCount: summary?.buttonCount ?? null,
    elements,
    ...(skipped.length === 0 ? {} : { timedOut: true as const, skipped }),
  };
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
  const so: SettleOptions = { timers, pollMs: o.pollMs, S, reserveMs: GRAPH_RESERVE_MS };
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
  const graph = await settle('graph', driver, d, so, steps, async (st) => {
    const ref = appeared(before, await listRegions(page, st));
    const snapshot = await st.race(
      regionOf(page, ref).ariaSnapshot({ timeout: Math.max(1, st.remaining()) }),
    );
    return { value: ref, id: `${ref?.role ?? 'main'}:${ref?.index ?? 0}:${ref?.name ?? ''}`, snapshot };
  });
  if (graph.kind === 'blocked') return graph;
  const ref = graph.value;
  const container = regionOf(page, ref);
  const read = await soft(() =>
    runStep('read-controls', READ_CONTROLS_MS, d, steps, (st) => readControls(container, st, S)),
  );
  const G = S.results.graphDialog;
  // why: rulings of 2026-10-18: the chart region by text and attributes only, each part bounded and never fatal
  const region = container.getByRole('region', { name: G.chartRegion, exact: true });
  const charts = await soft(() =>
    runStep('chart-find', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(region, st)),
  );
  const chart = !charts.ok
    ? charts.skipped
    : charts.value === 0
      ? null
      : await readChart(region.nth(0), d, steps);
  const base = {
    kind: 'explored' as const,
    region:
      ref === null
        ? { role: 'main' as const, name: '', appeared: false }
        : { role: ref.role, name: ref.name, appeared: true },
    snapshot: graph.snapshot,
    controls: read.ok ? read.value.controls : read.skipped,
    unnamed: read.ok ? read.value.unnamed : {},
    polls: graph.polls,
    classification: { kind: graph.pageKind, rule: graph.rule },
    facts: graph.facts,
    clickMs,
    chart,
  };
  const none = { datesTabs: 0, dates: null, scrollButtons: 0, scrolled: null, datesMs: 0, scrollMs: 0 };
  if (ref === null) return { ...base, ...none };
  // why: the Dates tab and the scroll are exploration only; a dialog without them is recorded as it is, counted, and
  // a step of theirs that overruns is recorded and the file still written
  const tab = container.getByRole('tab', { name: G.datesTab, exact: true });
  const tabs = await soft(() =>
    runStep('find-dates-tab', LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(tab, st)),
  );
  if (!tabs.ok) return { ...base, ...none, datesTabs: null, dates: tabs.skipped };
  if (tabs.value !== 1) return { ...base, ...none, datesTabs: tabs.value };
  // why: as the Cheapest flow: the Dates tab has its own budget from here, within twice the page timeout
  const dd = o.next?.() ?? d;
  const datesAt = timers.now();
  const view = async (name: string, readStep: string): Promise<DatesRead | Blocked> => {
    const s = await settle(name, driver, dd, so, steps, async (st) => {
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
      snapshot: stripSnapshotQueries(s.snapshot),
      cells,
      polls: s.polls,
    };
  };
  const flat = (r: { ok: true; value: DatesRead | Blocked } | { ok: false; skipped: Skipped }) =>
    r.ok ? r.value : r.skipped;
  const dates = flat(
    await soft(async () => {
      await runStep('click-dates-tab', CLICK_TIMEOUT_MS, dd, steps, async (st) => {
        await st.race(tab.nth(0).click(clickTimeoutOf(st)));
        o.clicked.push(`tab:${G.datesTab}`);
      });
      return view('dates', 'read-dates-cells');
    }),
  );
  if ('kind' in dates) return dates;
  const datesMs = timers.now() - datesAt;
  const after = { ...base, ...none, datesTabs: 1, dates, datesMs };
  if (!('snapshot' in dates)) return after;
  const scroll = container.getByRole('button', { name: G.scrollForwards, exact: true });
  const buttons = await soft(() =>
    runStep('find-scroll-forwards', LOOKUP_TIMEOUT_MS, dd, steps, (st) => countOf(scroll, st)),
  );
  if (!buttons.ok) return { ...after, scrollButtons: null, scrolled: buttons.skipped };
  if (buttons.value !== 1) return { ...after, scrollButtons: buttons.value };
  const scrollAt = timers.now();
  const scrolled = flat(
    await soft(async () => {
      await runStep('click-scroll-forwards', CLICK_TIMEOUT_MS, dd, steps, async (st) => {
        await st.race(scroll.nth(0).click(clickTimeoutOf(st)));
        o.clicked.push(`button:${G.scrollForwards}`);
      });
      return view('scroll', 'read-scrolled-cells');
    }),
  );
  if ('kind' in scrolled) return scrolled;
  return { ...after, scrollButtons: 1, scrolled, scrollMs: timers.now() - scrollAt };
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
