/**
 * The locator-based page driver (decision 69 round 2, items 5 and 6; brief §7 and §9). Roles and accessible names are
 * read through Playwright locators (`getByRole(role, { name })`, `getByText`, a link's `aria-label` or, when absent,
 * its text); the printed aria snapshot is never parsed. Every call takes the remaining page deadline as its own
 * `timeout` where the API has one, and races the deadline, whose expiry closes the page.
 *
 * The browser shapes below are the narrow structural subset of playwright-core 1.59.1's `BrowserContext`, `Page`,
 * `Frame`, `Locator`, `Route` and `Request` the worker uses (verified in `types/types.d.ts`); the real objects satisfy
 * them, and the tests' fakes implement them.
 */
import { createHash } from 'node:crypto';
import type { BlockedPage, Logger } from '@gmt/core';
import {
  type ClassifyRule,
  cheapestTabPriceMinor,
  classifyPageWithRule,
  type PageFacts,
  type PageKind,
} from './classify.js';
import { type GuardState, onAllowlist, urlOf } from './guard.js';
import { isSettled, type Previous, stableAcross, type View } from './ready.js';
import { type Role, SELECTORS, type Selectors } from './selectors.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

export interface LocatorLike {
  count(): Promise<number>;
  nth(index: number): LocatorLike;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  inputValue(options?: { timeout?: number }): Promise<string>;
  click(options?: { timeout?: number }): Promise<void>;
  /** WP21 Task 21.0 (the outbound's keyboard activation): focus the element, then press a key on it. */
  focus(options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  /** WP21 Task 21.0 (the outbound's probe, researchProbe.ts): the element's box in the page, or null when not rendered. */
  boundingBox(options?: {
    timeout?: number;
  }): Promise<{ x: number; y: number; width: number; height: number } | null>;
  isEnabled(options?: { timeout?: number }): Promise<boolean>;
  /** A page function run on the element (the probe's hit test only; it returns tokens and booleans, never text). */
  evaluate<R>(
    pageFunction: (element: never) => R,
    arg?: undefined,
    options?: { timeout?: number },
  ): Promise<R>;
  /** The printed accessibility snapshot: stored by the graph exploration only, never parsed (graph.ts). */
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
  /** The rendered text (the graph exploration's chart region only; never HTML). */
  innerText(options?: { timeout?: number }): Promise<string>;
  /** Every element below this one (`*`, the graph exploration's chart region only). */
  locator(selector: '*'): LocatorLike;
  getByRole(
    role: Role,
    options?: { name?: string | RegExp; exact?: boolean; selected?: boolean; level?: number },
  ): LocatorLike;
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike;
}
export interface FrameLike {
  url(): string;
  parentFrame(): FrameLike | null;
}
export interface PageLike {
  goto(url: string, options?: { timeout?: number; waitUntil?: 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  frames(): FrameLike[];
  on(event: 'framenavigated', listener: (frame: FrameLike) => void): unknown;
  getByRole(
    role: Role,
    options?: { name?: string | RegExp; exact?: boolean; selected?: boolean; level?: number },
  ): LocatorLike;
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike;
  close(): Promise<void>;
}
export interface RequestLike {
  url(): string;
  method(): string;
  /** A form POST's body (the consent research reads its field names); absent on the fakes that send none. */
  postData?(): string | null;
  /** The request's headers, lower-cased names (the consent research reads the content type only). */
  headers?(): Record<string, string>;
  isNavigationRequest(): boolean;
  redirectedFrom(): RequestLike | null;
  frame(): FrameLike;
}
export interface RouteLike {
  request(): RequestLike;
  abort(errorCode?: string): Promise<void>;
  fallback(): Promise<void>;
}
export interface CookieLike {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** The attributes the consent capture reads (Playwright's cookie carries them; the fakes may not). */
  expires?: number;
  secure?: boolean;
  sameSite?: string;
}
export interface CookieInput {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}
export interface ContextLike {
  cookies(urls?: string | string[]): Promise<CookieLike[]>;
  addCookies(cookies: CookieInput[]): Promise<void>;
  route(url: string, handler: (route: RouteLike, request: RequestLike) => unknown): Promise<void>;
  on(event: 'request', listener: (request: RequestLike) => void): unknown;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** The consent window's page: Playwright's `Page.isClosed()` says when the person has closed it. */
export interface HeadedPageLike extends PageLike {
  isClosed(): boolean;
}
/** A headed context (the consent window): a person may close it, which the consent driver observes. */
export interface HeadedContextLike extends ContextLike {
  on(event: 'request', listener: (request: RequestLike) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  newPage(): Promise<HeadedPageLike>;
}

/** Readiness facts (spec §2 "settled"; brief §9): read beside the page facts on every poll. */
export interface SettleFacts {
  resultsReturned: boolean;
  /** "Fetching results" visible outside the tab (ruling of 2026-10-18). */
  fetching: boolean;
  cheapestPriced: boolean;
  /** The Cheapest tab is the selected one (`aria-selected`), which settles the Cheapest view (ruling of 2026-10-18). */
  cheapestSelected: boolean;
  /** WP21 Task 21.0: a heading matches the return view's (`S.returns.heading`), as `PageFacts.text.returnHeading`. */
  returnHeading: boolean;
  /** A short hash of the result links' names, compared across polls (stable content). */
  linkSignature: string;
}
/** The list reader's input (brief Task 14.3): one `names` entry per result link, `null` when unreadable or too long. */
export interface ListFacts {
  names: Array<string | null>;
  cheapestTabName: string;
  resultsStated: number | null;
  currencyName: string | null;
  locationName: string | null;
  /**
   * WP21 Task 21.0: the View more button is on the page (`S.results.viewMoreButton`, exact). Always set by `listFacts`;
   * optional on the type so a reader's own literal need not state it (preflight P7).
   */
  viewMore?: boolean;
}
/** What the driver reads of a booking view (`bookingFacts`; offers.ts reads it): the offer buttons' names and two control counts. */
export interface BookingFacts {
  /** Each offer button's name in page order (`S.booking.offer` in main); null when unreadable or over the length cap. */
  offerNames: Array<string | null>;
  /** The "<count> more booking options" controls in main (`S.booking.moreOptions`; pressed only when exactly one). */
  moreOptions: number;
  /** The grouped "View <seller>, …" controls (`S.booking.grouped`): counted, never activated, their fares never read. */
  grouped: number;
}

/** The search form's fields as the page shows them (brief Task 14.3), or null when the controls are absent. */
export type FormFacts = { tripType: string; passengers: string; departure: string; return: string } | null;

export interface Driver {
  goto(url: string, d: Deadline): Promise<void>;
  /** The page's heading names (what a recording stores of a page it could not classify). */
  headingNames(d: Deadline): Promise<string[]>;
  /**
   * One poll: the page facts, the settle facts and the result names the signature hashes (never recorded twice).
   * `view` (WP21 Task 21.0): on the return view the links, names and signature are read by the return pattern; every
   * view also reports the outbound pattern's count (`outboundLinks`) and the return heading.
   */
  readFacts(
    d: Deadline,
    o?: LookupBound,
    view?: View,
  ): Promise<{ page: PageFacts; settle: SettleFacts; names: Array<string | null> }>;
  resultNames(d: Deadline): Promise<Array<string | null>>;
  /** The list reader's input; `view` 'returns' (WP21 Task 21.0) reads the return view's links. */
  listFacts(d: Deadline, view?: View): Promise<ListFacts>;
  formFacts(d: Deadline): Promise<FormFacts>;
  click(role: Role, name: string, d: Deadline): Promise<void>;
  /**
   * The Cheapest flow's clicks (ruling of 2026-10-18): the tab's own information pop-up closed through its exact
   * close button when there is one, on the results page, then the tab. Returns what was clicked, in order.
   */
  clickCheapest(d: Deadline, o: StepOptions): Promise<string[]>;
  /**
   * WP21 Task 21.0: an outbound's selection. Step `find-outbound`: exactly one link in `main` with exactly that name,
   * which the outbound result pattern reads (preflight D6), else StepFailed('find-outbound', 'not-found' |
   * 'ambiguous', 'select-outbound') with nothing activated; then, by the controller's ruling after recording 2, the
   * link is activated from the keyboard: steps `focus-outbound` and `press-outbound` (Enter), each under
   * CLICK_TIMEOUT_MS, a failure carrying Playwright's reason as a word. `onActivate` is told once the link is found,
   * before the activation starts (so a caller records the activation however the steps after it end). Returns what it
   * activated.
   */
  clickOutbound(name: string, d: Deadline, o: StepOptions, onActivate?: () => void): Promise<string[]>;
  /**
   * Ian's ruling of 2026-11-01 (read the booking options): the return's selection, as clickOutbound's but by the
   * return pattern (`S.returns.resultLink`): steps `find-return`, `focus-return`, `press-return`, flow `select-return`.
   */
  clickReturn(name: string, d: Deadline, o: StepOptions, onActivate?: () => void): Promise<string[]>;
  /**
   * Ian's ruling of 2026-11-01 (open "more booking options"): the booking view's in-page expansion, the one button in
   * `main` named by `S.booking.moreOptions`, focused then Enter: steps `find-more-options`, `focus-more-options`,
   * `press-more-options`, flow `select-more-options`. Never an offer or any other control.
   */
  clickMoreOptions(d: Deadline, o: StepOptions, onActivate?: () => void): Promise<string[]>;
  /**
   * WP21 Task 21.3 (spec rev 56 §2 "The booking read"): the booking view's offer buttons' names in page order (in main,
   * by `S.booking.offer`; null when unreadable or over the length cap, counted unparsed upstream), the "more booking
   * options" controls in main (`S.booking.moreOptions`) and the grouped "View <seller>, …" controls
   * (`S.booking.grouped`). A read only: nothing here is ever activated.
   */
  bookingFacts(d: Deadline): Promise<BookingFacts>;
}

/** How a timed step runs: the timers, the debug log, and the page's start (for elapsed times). */
export interface StepOptions {
  timers: Timers;
  log?: Logger;
  startedAt?: number;
  /** The flow the step lines name (`<flow> step`); the Cheapest flow's by default. */
  flow?: string;
}

/** Each lookup's own bound in the Cheapest flow, inside the page deadline (ruling of 2026-10-18). */
export const LOOKUP_TIMEOUT_MS = 5000;
/**
 * Each Cheapest-view poll's own bound (ruling of 2026-10-18, after the rerun on 59115d9): a poll is about fifteen
 * lookups, which the larger Cheapest view slows, so the poll has 20 s and each lookup inside it keeps its 5 s.
 */
export const POLL_TIMEOUT_MS = 20_000;
/** What the Cheapest polling leaves of its budget for the fallback read (the Best view's list), ruling of 2026-10-18. */
export const FALLBACK_RESERVE_MS = POLL_TIMEOUT_MS;

/** Bounds each single lookup of a readFacts call (the Cheapest view's polls). */
export interface LookupBound {
  timers: Timers;
  lookupMs: number;
}

/** A single lookup that overran its own bound inside a bounded poll. */
export class LookupTimedOut extends Error {
  constructor(
    /** Which lookup overran (ruling of 2026-10-18), e.g. `cheapest-tab-selected`, `result-links`. */
    readonly lookup: string,
    readonly lookupMs: number,
  ) {
    super(`the ${lookup} lookup overran its bound`);
    this.name = 'LookupTimedOut';
  }
}

/** A deadline whose lookups are bounded one by one, and the name of the lookup in flight. */
interface Lookups {
  d: Deadline;
  /** Names the lookups that follow, until the next call (lookups run one at a time within a readFacts). */
  at(name: string): void;
}

/**
 * A deadline whose every `race` is also bounded on its own by `ms` (never past `d`): each lookup through it gets a fresh
 * bound, cleared once it answers. `remaining()` (the Playwright timeout) is the smaller of the two.
 */
function perLookup(d: Deadline, timers: Timers, ms: number): Lookups {
  let current = 'lookup';
  const bounded: Deadline = {
    signal: d.signal,
    remaining: () => Math.min(ms, d.remaining()),
    expired: () => d.expired(),
    onExpire: (fn) => d.onExpire(fn),
    clear: () => d.clear(),
    race: async <T>(p: Promise<T>): Promise<T> => {
      const one = timers.deadline(Math.max(1, Math.min(ms, d.remaining())));
      try {
        return await d.race(one.race(p));
      } catch (e) {
        if (one.expired() && !d.expired()) throw new LookupTimedOut(current, ms);
        throw e;
      } finally {
        one.clear();
      }
    },
  };
  return {
    d: bounded,
    at: (name) => {
      current = name;
    },
  };
}

/**
 * A timed step that failed or timed out, in any flow (the Cheapest flow's by default; the grid's, the graph's and the
 * outbound selection's name theirs); the caller falls back or ends plainly (never a hang to the page deadline). WP21
 * Task 21.0 renamed it from the Cheapest flow's own error in one go.
 */
export class StepFailed extends Error {
  constructor(
    readonly step: string,
    readonly reason: 'timed-out' | 'failed' | 'not-found' | 'not-selected' | 'ambiguous',
    readonly flow: string = 'cheapest',
    /** WP21 Task 21.0: why a click could not land, as one word (`ClickFailure`), when the step knows it. */
    readonly detail?: ClickFailure,
  ) {
    super(`the ${flow} flow's ${step} step ${reason}`);
    this.name = 'StepFailed';
  }
}

/**
 * Runs one step under its own bound (`ms`, never past the page deadline `d`), logging its start and end at debug with
 * the elapsed ms since the page started (ruling of 2026-10-18). A step that overruns logs its name and throws
 * StepFailed naming the options' flow; the page deadline's own expiry still surfaces as DeadlineExceeded.
 */
export async function runStep<T>(
  name: string,
  ms: number,
  d: Deadline,
  o: StepOptions,
  fn: (step: Deadline) => Promise<T>,
): Promise<T> {
  const started = o.startedAt ?? o.timers.now();
  const elapsed = (): number => o.timers.now() - started;
  const timeoutMs = Math.max(1, Math.min(ms, d.remaining()));
  const step = o.timers.deadline(timeoutMs);
  const flow = o.flow ?? 'cheapest';
  o.log?.debug({ step: name, phase: 'start', elapsedMs: elapsed() }, `${flow} step`);
  try {
    const value = await d.race(step.race(fn(step)));
    o.log?.debug({ step: name, phase: 'end', elapsedMs: elapsed() }, `${flow} step`);
    return value;
  } catch (e) {
    if (d.expired()) throw e;
    if (step.expired()) {
      o.log?.debug({ step: name, elapsedMs: elapsed(), timeoutMs }, `${flow} step timed out`);
      throw new StepFailed(name, 'timed-out', flow);
    }
    // why: a failed step logs only the error class and the step, never a URL or a message holding one
    o.log?.debug(
      {
        step: name,
        error: e instanceof Error ? e.name : 'unknown',
        ...(e instanceof LookupTimedOut ? { lookup: e.lookup, lookupMs: e.lookupMs } : {}),
        elapsedMs: elapsed(),
      },
      `${flow} step failed`,
    );
    throw new StepFailed(name, 'failed', flow, e instanceof ClickRefused ? e.word : undefined);
  } finally {
    step.clear();
  }
}

/** Each click's own bound, always inside the page deadline (ruling of 2026-10-18). */
export const CLICK_TIMEOUT_MS = 10_000;

/**
 * WP21 Task 21.0 (after the first live select-outbound recording, whose outbound click timed out): the outbound's click
 * runs this far inside its step, so Playwright's own timeout, whose call log says why the action could not land,
 * answers before the step's bound does.
 */
export const CLICK_LOG_MARGIN_MS = 1000;

/** Why a click could not land, from Playwright's call log, as one word. */
export type ClickFailure =
  | 'not-visible'
  | 'intercepted'
  | 'not-stable'
  | 'outside-viewport'
  | 'detached'
  | 'not-enabled'
  | 'other';

const CLICK_REASONS: ReadonlyArray<readonly [RegExp, ClickFailure]> = [
  [/intercepts pointer events/, 'intercepted'],
  [/element is not visible/, 'not-visible'],
  [/element is not stable/, 'not-stable'],
  [/outside of the viewport/, 'outside-viewport'],
  [/detached from the DOM|not attached to the DOM/, 'detached'],
  [/element is not enabled|element is disabled/, 'not-enabled'],
];

/**
 * A click error's reason as one word: the last call-log line that names one (Playwright retries, so the last is the
 * state the action ended on), else `other`. Only the word leaves this function, never the message, which can quote
 * the page's markup.
 */
export function clickFailureOf(e: unknown): ClickFailure {
  if (!(e instanceof Error)) return 'other';
  for (const line of e.message.split('\n').reverse())
    for (const [re, word] of CLICK_REASONS) if (re.test(line)) return word;
  return 'other';
}

/** A click Playwright refused inside its step, carrying the reason's word to the step's StepFailed. */
class ClickRefused extends Error {
  constructor(readonly word: ClickFailure) {
    super(`the click could not land: ${word}`);
    this.name = 'ClickRefused';
  }
}

/** The deadline's remaining time as a Playwright timeout; never 0, which Playwright reads as "no timeout". */
export const timeoutOf = (d: Deadline): { timeout: number } => ({ timeout: Math.max(1, d.remaining()) });
/** A click's timeout: its own bound, within what the deadline has left. */
export const clickTimeoutOf = (d: Deadline): { timeout: number } => ({
  timeout: Math.max(1, Math.min(CLICK_TIMEOUT_MS, d.remaining())),
});

/** A locator's accessible name as the brief reads it: `aria-label`, else the text; `null` when neither is readable. */
export async function nameOf(l: LocatorLike, d: Deadline): Promise<string | null> {
  const label = await d.race(l.getAttribute('aria-label', timeoutOf(d)));
  if (label !== null) return label;
  return d.race(l.textContent(timeoutOf(d)));
}

export async function countOf(l: LocatorLike, d: Deadline): Promise<number> {
  return d.race(l.count());
}

/** The driver over one page; `guard` is that page's guard state (hops and frame URLs). */
export function createDriver(page: PageLike, guard: GuardState, S: Selectors = SELECTORS): Driver {
  // why: WP21 Task 21.0: the return view's links are read by the return pattern; every other view's by the outbound one
  // why: Ian's ruling of 2026-11-01: on the booking view the offers count: buttons in main by the offer pattern
  // (select-return/2026-11-01/1 and 2 showed every offer so; the view's links are not offers)
  const resultLinks = (view: View = 'best'): LocatorLike =>
    view === 'booking'
      ? page.getByRole('main').getByRole('button', { name: S.booking.offer })
      : page
          .getByRole('main')
          .getByRole('link', { name: view === 'returns' ? S.returns.resultLink : S.results.resultLink });
  const has = async (l: LocatorLike, d: Deadline): Promise<boolean> => (await countOf(l, d)) > 0;
  // why: ruling of 2026-10-18: a hidden label (the Cheapest tab keeps "Fetching results" in its name once loaded) is
  // never read as the page still loading; only the matches a visitor would see count
  const visibleCount = async (l: LocatorLike, d: Deadline): Promise<number> => {
    let v = 0;
    for (let i = 0, n = await countOf(l, d); i < n; i++) if (await d.race(l.nth(i).isVisible())) v++;
    return v;
  };
  const firstName = async (l: LocatorLike, d: Deadline): Promise<string | null> =>
    (await countOf(l, d)) === 0 ? null : nameOf(l.nth(0), d);

  async function resultNames(d: Deadline, view: View = 'best'): Promise<Array<string | null>> {
    const links = resultLinks(view);
    const n = await countOf(links, d);
    const names: Array<string | null> = [];
    for (let i = 0; i < n; i++) {
      const name = await nameOf(links.nth(i), d);
      // why: PIE-R2-10: a name too long is counted as unparsed upstream, never parsed and never dropped.
      names.push(name === null || name.length > S.maxNameLength ? null : name);
    }
    return names;
  }

  /**
   * One option's selection: exactly one link in `main` with exactly that name, which `pattern` (a selectors-module
   * pattern) reads, else StepFailed('find-<what>', 'not-found' | 'ambiguous', flow) with nothing activated; then, by the
   * controller's ruling after recording 2 (the pointer click's centre was covered by another element of the row,
   * which intercepted it), the link itself is focused and activated with Enter, as a keyboard user would: never force,
   * coordinates, the covering element or a synthetic event. Each action runs CLICK_LOG_MARGIN_MS inside its step, so
   * Playwright's own error, whose call log names why, answers first. `onActivate` is told once the link is found.
   */
  async function activateLink(
    name: string,
    pattern: RegExp,
    what: 'outbound' | 'return',
    flow: string,
    d: Deadline,
    o: StepOptions,
    onActivate?: () => void,
  ): Promise<string[]> {
    // why: preflight D6: only a result-shaped name is ever looked for, so nothing but an option's own link is activated
    if (!pattern.test(name)) throw new StepFailed(`find-${what}`, 'not-found', flow);
    const links = page.getByRole('main').getByRole('link', { name, exact: true });
    await activateOne(links, what, flow, d, o, onActivate);
    return [`link:${name}`];
  }

  /**
   * Exactly one match of `matches`, else StepFailed('find-<what>', 'not-found' | 'ambiguous', flow) with nothing
   * activated; then the match itself focused and activated with Enter, as a keyboard user would (the controller's ruling
   * after recording 2: the pointer click's centre was covered by another element of the row): never force, coordinates,
   * a covering element or a synthetic event. Each action runs CLICK_LOG_MARGIN_MS inside its step, so Playwright's own
   * error, whose call log names why, answers first. `onActivate` is told once the match is found.
   */
  async function activateOne(
    matches: LocatorLike,
    what: string,
    flow: string,
    d: Deadline,
    o: StepOptions,
    onActivate?: () => void,
  ): Promise<void> {
    const steps: StepOptions = { ...o, flow };
    // why: the page's own URL is never read here, so a selection reads nothing a poll would
    const found = await runStep(`find-${what}`, LOOKUP_TIMEOUT_MS, d, steps, (st) => countOf(matches, st));
    if (found === 0) throw new StepFailed(`find-${what}`, 'not-found', flow);
    if (found > 1) throw new StepFailed(`find-${what}`, 'ambiguous', flow);
    const one = matches.nth(0);
    onActivate?.();
    const act = (step: string, action: (timeout: number) => Promise<void>) =>
      runStep(step, CLICK_TIMEOUT_MS, d, steps, async (st) => {
        const timeout = Math.max(1, Math.min(CLICK_TIMEOUT_MS, st.remaining()) - CLICK_LOG_MARGIN_MS);
        try {
          await st.race(action(timeout));
        } catch (e) {
          if (e instanceof DeadlineExceeded) throw e;
          throw new ClickRefused(clickFailureOf(e));
        }
      });
    await act(`focus-${what}`, (timeout) => one.focus({ timeout }));
    await act(`press-${what}`, (timeout) => one.press('Enter', { timeout }));
  }

  return {
    async headingNames(d) {
      const h = page.getByRole('heading');
      const out: string[] = [];
      for (let i = 0, n = await countOf(h, d); i < n; i++) out.push((await nameOf(h.nth(i), d)) ?? '');
      return out;
    },

    async goto(url, d) {
      await d.race(page.goto(url, { ...timeoutOf(d), waitUntil: 'domcontentloaded' }));
    },

    async readFacts(outer, o, view = 'best') {
      // why: inside a bounded poll every single lookup keeps its own 5 s bound and is named, so an overrun says which
      // (rulings of 2026-10-18); outside one, `at` names nothing
      const bound = o === undefined ? null : perLookup(outer, o.timers, o.lookupMs);
      const d = bound?.d ?? outer;
      const at = (name: string): void => bound?.at(name);
      const url = page.url();
      at('account-control');
      const accountButtons = await countOf(page.getByRole('button', { name: S.blocked.accountControl }), d);
      const accountLinks = await countOf(page.getByRole('link', { name: S.blocked.accountControl }), d);
      const allTabs = page.getByRole('tab', { name: S.results.cheapestTab });
      const tabsInList = page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab });
      at('cheapest-tabs');
      const total = await countOf(allTabs, d);
      const inList = await countOf(tabsInList, d);
      // why: ruling of 2026-10-18: the selected state through the role query (counting the selected Cheapest tab),
      // never getAttribute on a node the page may have replaced
      at('cheapest-tab-selected');
      const selectedInList = await countOf(
        page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab, selected: true }),
        d,
      );
      const oneSelected = inList === 1 && selectedInList === 1;
      const cheapestTabs: PageFacts['cheapestTabs'] = [];
      at('cheapest-tab-name');
      for (let i = 0; i < inList; i++)
        cheapestTabs.push({
          name: (await nameOf(tabsInList.nth(i), d)) ?? '',
          inTablist: true,
          selected: oneSelected,
        });
      for (let i = inList; i < total; i++) cheapestTabs.push({ name: '', inTablist: false });
      at('unusual-traffic-text');
      const unusualTraffic = await has(page.getByText(S.blocked.unusualTraffic), d);
      at('consent-heading');
      const consentHeading = await has(page.getByRole('heading', { name: S.consent.heading }), d);
      at('sign-in-heading');
      const signInHeading = await has(page.getByRole('heading', { name: S.blocked.signInHeading }), d);
      at('challenge-text');
      const challenge = await has(page.getByText(S.blocked.challenge), d);
      // why: ruling of 2026-10-18: visible only, as the loading check (a hidden status line never counts)
      at('no-flights-text');
      const noFlights = (await visibleCount(page.getByText(S.results.noFlights), d)) > 0;
      // why: WP17 Task 17.4: the consent command's landing view (a hypothesis until LANDING_VERIFIED)
      at('landing-heading');
      const landingHeading = await has(page.getByRole('heading', { name: S.landing.heading }), d);
      // why: WP21 Task 21.0: the return view's heading (a hypothesis until recorded), read on every view
      at('return-heading');
      const returnHeading = await has(page.getByRole('heading', { name: S.returns.heading }), d);
      at('date-grid-buttons');
      const dateGridButtons = await countOf(
        page.getByRole('button', { name: S.results.dateGridButton, exact: true }),
        d,
      );
      at('result-links');
      const outboundLinks = await countOf(resultLinks(), d);
      const links =
        view === 'returns' || view === 'booking' ? await countOf(resultLinks(view), d) : outboundLinks;
      // why: WP21 Task 21.3: the booking view's price-range heading, read on that view only (the classifier's fact)
      at('price-range-heading');
      const priceRangeHeading =
        view === 'booking'
          ? await has(page.getByRole('heading', { name: S.booking.priceRangeHeading }), d)
          : null;
      const facts: PageFacts = {
        url,
        hops: [...guard.hops],
        frameUrls: [...new Set([...page.frames().map((f) => f.url()), ...guard.frameUrls])],
        text: {
          unusualTraffic,
          consentHeading,
          signInHeading,
          challenge,
          noFlights,
          landingHeading,
          returnHeading,
          ...(priceRangeHeading === null ? {} : { priceRangeHeading }),
        },
        accountControl: accountButtons + accountLinks > 0,
        cheapestTabs,
        dateGridButtons,
        resultLinks: links,
        outboundLinks,
      };
      // why: ruling of 2026-10-18: the loading text counts only when visible and outside the tab (never the tab's name)
      at('fetching-text');
      const visibleFetching = await visibleCount(page.getByText(S.results.fetching), d);
      const visibleInTabs = await visibleCount(page.getByRole('tab').getByText(S.results.fetching), d);
      at('result-names');
      const names = await resultNames(d, view);
      at('results-returned');
      const resultsReturned = await has(page.getByText(S.results.resultsReturned), d);
      const settle: SettleFacts = {
        resultsReturned,
        fetching: visibleFetching > visibleInTabs,
        cheapestPriced:
          cheapestTabs.length === 1 && cheapestTabs.every((t) => cheapestTabPriceMinor(t.name, S) !== null),
        cheapestSelected: oneSelected,
        returnHeading,
        linkSignature: createHash('sha256').update(JSON.stringify(names)).digest('hex').slice(0, 16),
      };
      return { page: facts, settle, names };
    },

    resultNames,

    async listFacts(d, view = 'best') {
      const names = await resultNames(d, view);
      const tab = await firstName(
        page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab }),
        d,
      );
      const stated = Number.parseInt(
        (await firstText(page.getByText(S.results.resultsReturned), d)) ?? '',
        10,
      );
      return {
        names,
        cheapestTabName: tab ?? '',
        resultsStated: Number.isNaN(stated) ? null : stated,
        currencyName: await firstName(page.getByRole('button', { name: S.results.currencyButton }), d),
        locationName: await firstName(page.getByRole('button', { name: S.results.locationButton }), d),
        // why: WP21 Task 21.0 (R-viewmore): its presence is read on every view, never clicked here
        viewMore: await has(page.getByRole('button', { name: S.results.viewMoreButton, exact: true }), d),
      };
    },

    clickOutbound: (name, d, o, onActivate) =>
      activateLink(name, S.results.resultLink, 'outbound', 'select-outbound', d, o, onActivate),
    clickReturn: (name, d, o, onActivate) =>
      activateLink(name, S.returns.resultLink, 'return', 'select-return', d, o, onActivate),
    async clickMoreOptions(d, o, onActivate) {
      // why: the expansion's own pattern only (it can never name an offer: the selectors test pins that), inside main,
      // where select-return/2026-11-01/3 and 4 show it (main's button count moves with it, the rest of the page's does not)
      const more = page.getByRole('main').getByRole('button', { name: S.booking.moreOptions });
      await activateOne(more, 'more-options', 'select-more-options', d, o, onActivate);
      return ['button:more-options'];
    },

    async bookingFacts(d) {
      const inMain = page.getByRole('main');
      const offers = inMain.getByRole('button', { name: S.booking.offer });
      const offerNames: Array<string | null> = [];
      for (let i = 0, n = await countOf(offers, d); i < n; i++) {
        const name = await nameOf(offers.nth(i), d);
        // why: PIE-R2-10, as a result link: a name too long is counted unparsed upstream, never parsed and never dropped
        offerNames.push(name === null || name.length > S.maxNameLength ? null : name);
      }
      return {
        offerNames,
        moreOptions: await countOf(inMain.getByRole('button', { name: S.booking.moreOptions }), d),
        grouped: await countOf(inMain.getByRole('button', { name: S.booking.grouped }), d),
      };
    },

    async formFacts(d) {
      const trip = page.getByRole('combobox', { name: S.form.tripType });
      const pax = page.getByRole('button', { name: S.form.passengers });
      const dep = page.getByRole('textbox', { name: S.form.departure, exact: true });
      const ret = page.getByRole('textbox', { name: S.form.return, exact: true });
      const counts = [
        await countOf(trip, d),
        await countOf(pax, d),
        await countOf(dep, d),
        await countOf(ret, d),
      ];
      if (counts.some((c) => c !== 1)) return null;
      return {
        tripType: (await nameOf(trip, d)) ?? '',
        passengers: (await nameOf(pax, d)) ?? '',
        departure: await d.race(dep.inputValue(timeoutOf(d))),
        return: await d.race(ret.inputValue(timeoutOf(d))),
      };
    },

    async click(role, name, d) {
      await d.race(page.getByRole(role, { name, exact: true }).nth(0).click(clickTimeoutOf(d)));
    },

    async clickCheapest(d, o) {
      const clicked: string[] = [];
      const tabs = page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab });
      const tab = tabs.nth(0);
      // why: every await is its own timed step (ruling of 2026-10-18): 5 s for a lookup, 10 s for a click
      const click = (name: string, l: LocatorLike, target: string): Promise<void> =>
        runStep(name, CLICK_TIMEOUT_MS, d, o, async (st) => {
          await st.race(l.click(clickTimeoutOf(st)));
          clicked.push(target);
        });
      // why: page locators reach the main frame only; the close button must sit inside the Cheapest tab itself, have
      // exactly the selector's name, be the only one there, and the page must be on the results allowlist
      if (onAllowlist(page.url(), S)) {
        const close = tab.getByRole('button', { name: S.results.cheapestPopupClose, exact: true });
        const found = await runStep('find-popup', LOOKUP_TIMEOUT_MS, d, o, (st) => countOf(close, st));
        if (found === 1) await click('close-popup', close.nth(0), `button:${S.results.cheapestPopupClose}`);
      }
      const tabCount = await runStep('find-tab', LOOKUP_TIMEOUT_MS, d, o, (st) => countOf(tabs, st));
      if (tabCount !== 1) throw new StepFailed('find-tab', 'not-found');
      await click('click-tab', tab, 'tab:Cheapest');
      // why: ruling of 2026-10-18: through the role query, never getAttribute on a node the page may replace
      const selected = await runStep('confirm-selected', LOOKUP_TIMEOUT_MS, d, o, (st) =>
        countOf(
          page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab, selected: true }),
          st,
        ),
      );
      if (selected !== 1) throw new StepFailed('confirm-selected', 'not-selected');
      return clicked;
    },
  };
}

async function firstText(l: LocatorLike, d: Deadline): Promise<string | null> {
  if ((await countOf(l, d)) === 0) return null;
  return d.race(l.nth(0).textContent(timeoutOf(d)));
}

/**
 * The consent probe's page (Task 14.2; SEC-R2-003): the driver without `click`, `clickCheapest` or (WP21 Task 21.0)
 * `clickOutbound`, so a click on a consent page does not compile. Imported only by
 * record.ts (rules.test.ts pins that).
 */
export type ProbePage = Omit<
  Driver,
  'click' | 'clickCheapest' | 'clickOutbound' | 'clickReturn' | 'clickMoreOptions' | 'bookingFacts'
>;
export function probePage(d: Driver): ProbePage {
  return {
    goto: d.goto,
    headingNames: d.headingNames,
    readFacts: d.readFacts,
    resultNames: d.resultNames,
    listFacts: d.listFacts,
    formFacts: d.formFacts,
  };
}

/** A blocked kind a failed step's page showed: what the stop records (the kind, the rule, the facts). */
export interface FailedStepBlock {
  page: BlockedPage;
  rule: ClassifyRule;
  facts: { page: PageFacts; settle: SettleFacts };
}

/**
 * A failed step's page classified once, under its own bounded step (WP21 Task 21.0: the recorder's closure made a
 * driver function; the session switches to it in Task 21.3). A failed step may be no results page at all (a challenge
 * after the click): a blocked kind other than `unrecognised` is returned for the caller's stop, with its cool-down;
 * anything else, or a read that fails or overruns, is null (the caller ends the step plainly). The deadline's own
 * expiry is rethrown.
 */
export async function classifyAfterFailedStep(
  driver: Pick<Driver, 'readFacts'>,
  cur: Deadline,
  steps: StepOptions,
  S: Selectors,
  view: View,
): Promise<FailedStepBlock | null> {
  const lookups = { timers: steps.timers, lookupMs: LOOKUP_TIMEOUT_MS };
  const seen = await runStep('classify-after-failed-step', POLL_TIMEOUT_MS, cur, steps, (st) =>
    driver.readFacts(st, lookups, view),
  ).catch((err: unknown) => {
    if (err instanceof DeadlineExceeded || cur.expired()) throw err;
    return null;
  });
  if (seen === null) return null;
  const k = classifyPageWithRule(seen.page, S, view);
  if (k.kind.kind === 'blocked' && k.kind.page !== 'unrecognised')
    return { page: k.kind.page, rule: k.rule, facts: { page: seen.page, settle: seen.settle } };
  return null;
}

/** Why `pollUntilSettled` stopped: a blocked kind, a no-flights page, or a settled page and how it classified. */
export interface Settled {
  kind: PageKind;
  /** The classifier rule that decided `kind` (diagnostics of 2026-10-18). */
  rule: ClassifyRule;
  facts: { page: PageFacts; settle: SettleFacts };
  polls: number;
}

/** How a poll settles and what it logs: the view, the debug log, and the page's start (for elapsed times). */
export interface PollOptions {
  view?: View;
  log?: Logger;
  /** timers.now() when the page started; debug lines carry elapsed ms from it. */
  startedAt?: number;
  /**
   * WP21 Task 21.0 (R-settle), the return view: the view the selection was made on (its link signature, read by the
   * return pattern, and the guard's document loads then). A poll counts as changed when its signature differs, a return
   * heading shows, or `loads()` has grown; an unchanged view never settles, so it runs to the deadline. `path`
   * (WP21 Task 21.3, review M1): the URL path the activation was made on; on the booking view a poll whose URL path
   * differs counts as changed (the return's selection moves the URL to the booking path, recorded), so a booking view
   * with no offer is a changed view that never settles, not an activation that did nothing. The expansion's polls start
   * on the booking path and stay there, so for them the path is no change.
   */
  changedFrom?: { signature: string; documentLoads: number; path?: string };
  /** The guard's document loads now (`guard.documentLoads`); with `changedFrom`. */
  loads?: () => number;
  /**
   * WP21 Task 21.3 (R-refused): read before every poll's classification; true ends the polling with PollStopped (the
   * return phase passes "the guard refused or held a navigation", so a refused hop is never classified as a block).
   */
  stopWhen?: () => boolean;
  /** WP21 Task 21.3: set `changed` once any poll saw the view changed from `changedFrom` (no-activation vs not-settled). */
  track?: { changed: boolean };
}

/** WP21 Task 21.3 (review M1): a URL's path, or null when it cannot be parsed (then never equal to a path read). */
export function pathOf(url: string): string | null {
  return urlOf(url)?.pathname ?? null;
}

/** Whether `url`'s path differs from `from` (review M1); false when either is unknown. */
export function pathMoved(url: string, from: string | null | undefined): boolean {
  const path = pathOf(url);
  return from !== undefined && from !== null && path !== null && path !== from;
}

/** `changedFrom.path` for the URL an activation is made on: absent when it cannot be parsed (then nothing compares). */
export function pathField(url: string): { path?: string } {
  const path = pathOf(url);
  return path === null ? {} : { path };
}

/** WP21 Task 21.3: pollUntilSettled stopped by its `stopWhen` before classifying a poll. */
export class PollStopped extends Error {
  constructor() {
    super('the poll was stopped before its classification');
    this.name = 'PollStopped';
  }
}

/** The first 60 characters of each name present in one poll's links and absent from the other's. */
function changedNames(before: ReadonlyArray<string | null>, after: ReadonlyArray<string | null>): string[] {
  const a = new Set(before);
  const b = new Set(after);
  const out = [...after.filter((x) => !a.has(x)), ...before.filter((x) => !b.has(x))];
  return [...new Set(out)].map((x) => (x ?? '(unreadable)').slice(0, 60));
}

/**
 * Polls `readFacts` every `pollMs` within the deadline (spec §2 "settled"; brief Task 14.4 rule 4): a blocked kind other
 * than `unrecognised` stops at once on any poll; a no-flights page stops; a settled page returns however it classified
 * (`results` or `unrecognised`). The deadline's expiry surfaces as DeadlineExceeded (the caller's `not-ready`).
 */
export async function pollUntilSettled(
  driver: Pick<Driver, 'readFacts'>,
  d: Deadline,
  timers: Timers,
  pollMs: number,
  S: Selectors = SELECTORS,
  o: PollOptions = {},
): Promise<Settled> {
  const view = o.view ?? 'best';
  const log = o.log;
  const startedAt = o.startedAt ?? timers.now();
  let previous: Previous | null = null;
  let previousNames: Array<string | null> | null = null;
  for (let polls = 1; ; polls++) {
    // why: ruling of 2026-10-18 (the rerun on 51c2992): Cheapest polling goes on until only the reserve the fallback
    // needs is left; then the flow fails as a step and the caller falls back
    if (view === 'cheapest' && d.remaining() < FALLBACK_RESERVE_MS)
      throw new StepFailed('cheapest-poll', 'timed-out');
    const pollStart = timers.now();
    // why: ruling of 2026-10-18: each Cheapest-view poll is its own 20 s step with 5 s lookups inside it; one that
    // overruns (a lookup or the poll) is "not settled yet", polled again at the normal interval
    let read: Awaited<ReturnType<typeof driver.readFacts>>;
    try {
      read =
        view === 'cheapest'
          ? await runStep(
              'cheapest-poll',
              POLL_TIMEOUT_MS,
              d,
              { timers, ...(log === undefined ? {} : { log }), startedAt },
              (st) => driver.readFacts(st, { timers, lookupMs: LOOKUP_TIMEOUT_MS }),
            )
          : view === 'returns' || view === 'booking'
            ? await driver.readFacts(d, undefined, view)
            : await driver.readFacts(d);
    } catch (e) {
      if (!(e instanceof StepFailed) || view !== 'cheapest') throw e;
      // an unsettled poll: the links must hold still across two good polls from here
      previous = null;
      previousNames = null;
      await timers.sleep(pollMs, d.signal);
      continue;
    }
    const pollDurationMs = timers.now() - pollStart;
    const facts = { page: read.page, settle: read.settle };
    // why: R-refused: the guard's refusal is read before this poll is classified
    if (o.stopWhen?.() === true) throw new PollStopped();
    const { kind, rule } = classifyPageWithRule(facts.page, S, view);
    if (kind.kind === 'no-flights' || (kind.kind === 'blocked' && kind.page !== 'unrecognised'))
      return { kind, rule, facts, polls };
    const current = {
      signature: facts.settle.linkSignature,
      links: facts.page.resultLinks,
      at: timers.now(),
    };
    // why: R-settle: a return view must first differ from the view the click was made on, then hold still
    const changedFrom = o.changedFrom;
    const changed =
      changedFrom !== undefined &&
      (facts.settle.linkSignature !== changedFrom.signature ||
        // why: a return heading is the change to the return view; the booking view is selected from a view that has
        // one, so there it is no change (Ian's ruling of 2026-11-01)
        (view === 'returns' && facts.page.text.returnHeading) ||
        (view === 'booking' && pathMoved(facts.page.url, changedFrom.path)) ||
        (o.loads?.() ?? changedFrom.documentLoads) > changedFrom.documentLoads);
    if (changed && o.track !== undefined) o.track.changed = true;
    const settled = isSettled(facts.page, facts.settle, view, changed);
    // why: ruling of 2026-10-18: settled means stable content: the same links across two polls at least 2 s apart
    const stable = settled && stableAcross(previous, current);
    const elapsedMs = timers.now() - startedAt;
    // why: one debug line a poll: the view, the booleans, the link count and the elapsed time only, so a page that
    // never settles is diagnosable
    log?.debug(
      {
        view,
        elapsedMs,
        pollDurationMs,
        resultsReturned: facts.settle.resultsReturned,
        fetching: facts.settle.fetching,
        cheapestPriced: facts.settle.cheapestPriced,
        cheapestSelected: facts.settle.cheapestSelected,
        stable,
        resultLinks: facts.page.resultLinks,
        ...(view === 'returns' ? { changed, outboundLinks: facts.page.outboundLinks } : {}),
      },
      'settle poll',
    );
    if (stable) return { kind, rule, facts, polls };
    // why: ruling of 2026-10-18: on the Cheapest view, which names moved between two settled polls (60 characters
    // each), so a view that never holds still shows why
    if (
      view === 'cheapest' &&
      settled &&
      previous !== null &&
      previousNames !== null &&
      previous.signature !== current.signature
    )
      log?.debug(
        { view, elapsedMs, changed: changedNames(previousNames, read.names) },
        'settle names changed',
      );
    // why: fix round 1 (TS 8): the first poll of a run of matching ones is kept, so a short poll interval still needs
    // two matching polls STABLE_MS apart
    const same: boolean =
      previous !== null && previous.signature === current.signature && previous.links === current.links;
    previous = !settled ? null : same ? previous : current;
    previousNames = settled ? read.names : null;
    await timers.sleep(pollMs, d.signal);
  }
}
