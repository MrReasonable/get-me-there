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
  role: (typeof CONTROL_ROLES)[number];
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
      facts: { page: PageFacts; settle: SettleFacts };
      clickMs: number;
    }
  | {
      kind: 'blocked';
      page: BlockedPage;
      rule: ClassifyRule;
      facts: { page: PageFacts; settle: SettleFacts };
    };

export interface GraphOptions {
  timers: Timers;
  pollMs: number;
  S: Selectors;
  steps: StepOptions;
  /** What was clicked, appended in order (kept by the caller for a stop record). */
  clicked: string[];
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
  let previous: { key: string; at: number } | null = null;
  for (let polls = 1; ; polls++) {
    if (d.remaining() < GRAPH_RESERVE_MS) throw new CheapestStepFailed('graph-settle', 'timed-out');
    const poll = await runStep('graph-poll', POLL_TIMEOUT_MS, d, steps, async (st) => {
      const read = await driver.readFacts(st, { timers, lookupMs: LOOKUP_TIMEOUT_MS });
      const ref = appeared(before, await listRegions(page, st));
      const snapshot = await st.race(
        regionOf(page, ref).ariaSnapshot({ timeout: Math.max(1, st.remaining()) }),
      );
      return { read, ref, snapshot };
    });
    const facts = { page: poll.read.page, settle: poll.read.settle };
    const { kind, rule } = classifyPageWithRule(facts.page, S);
    if (kind.kind === 'blocked' && kind.page !== 'unrecognised')
      return { kind: 'blocked', page: kind.page, rule, facts };
    const ref = poll.ref;
    const key = `${ref?.role ?? 'main'}:${ref?.index ?? 0}:${ref?.name ?? ''}:${createHash('sha256').update(poll.snapshot).digest('hex')}`;
    const at = timers.now();
    // why: settled means stable content: the same region and the same printed snapshot across two polls 2 s apart
    const stable =
      poll.snapshot.trim() !== '' &&
      previous !== null &&
      previous.key === key &&
      at - previous.at >= STABLE_MS;
    steps.log?.debug(
      {
        view: 'graph',
        elapsedMs: at - (steps.startedAt ?? at),
        region: ref?.role ?? 'main',
        snapshotLength: poll.snapshot.length,
        stable,
      },
      'graph poll',
    );
    if (stable) {
      const region = regionOf(page, ref);
      const read = await runStep('read-controls', READ_CONTROLS_MS, d, steps, (st) =>
        readControls(region, st, S),
      );
      return {
        kind: 'explored',
        region:
          ref === null
            ? { role: 'main', name: '', appeared: false }
            : { role: ref.role, name: ref.name, appeared: true },
        snapshot: poll.snapshot,
        controls: read.controls,
        unnamed: read.unnamed,
        polls,
        classification: { kind: kind.kind, rule },
        facts,
        clickMs,
      };
    }
    previous = { key, at };
    await timers.sleep(o.pollMs, d.signal);
  }
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
