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
import type { Logger } from '@gmt/core';
import { classifyPage, type PageFacts, type PageKind } from './classify.js';
import type { GuardState } from './guard.js';
import { isSettled, type Previous, stableAcross } from './ready.js';
import { type Role, SELECTORS, type Selectors } from './selectors.js';
import type { Deadline, Timers } from './timers.js';

export interface LocatorLike {
  count(): Promise<number>;
  nth(index: number): LocatorLike;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  inputValue(options?: { timeout?: number }): Promise<string>;
  click(options?: { timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  getByRole(role: Role, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike;
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
  getByRole(role: Role, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike;
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike;
  close(): Promise<void>;
}
export interface RequestLike {
  url(): string;
  method(): string;
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

/** Readiness facts (spec §2 "settled"; brief §9): read beside the page facts on every poll. */
export interface SettleFacts {
  resultsReturned: boolean;
  /** "Fetching results" visible outside the tab (ruling of 2026-10-18). */
  fetching: boolean;
  cheapestPriced: boolean;
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
}
/** The search form's fields as the page shows them (brief Task 14.3), or null when the controls are absent. */
export type FormFacts = { tripType: string; passengers: string; departure: string; return: string } | null;

export interface Driver {
  goto(url: string, d: Deadline): Promise<void>;
  /** The page's heading names (what a recording stores of a page it could not classify). */
  headingNames(d: Deadline): Promise<string[]>;
  readFacts(d: Deadline): Promise<{ page: PageFacts; settle: SettleFacts }>;
  resultNames(d: Deadline): Promise<Array<string | null>>;
  listFacts(d: Deadline): Promise<ListFacts>;
  formFacts(d: Deadline): Promise<FormFacts>;
  click(role: Role, name: string, d: Deadline): Promise<void>;
}

/** The deadline's remaining time as a Playwright timeout; never 0, which Playwright reads as "no timeout". */
const timeoutOf = (d: Deadline): { timeout: number } => ({ timeout: Math.max(1, d.remaining()) });

/** A locator's accessible name as the brief reads it: `aria-label`, else the text; `null` when neither is readable. */
async function nameOf(l: LocatorLike, d: Deadline): Promise<string | null> {
  const label = await d.race(l.getAttribute('aria-label', timeoutOf(d)));
  if (label !== null) return label;
  return d.race(l.textContent(timeoutOf(d)));
}

async function countOf(l: LocatorLike, d: Deadline): Promise<number> {
  return d.race(l.count());
}

/** The driver over one page; `guard` is that page's guard state (hops and frame URLs). */
export function createDriver(page: PageLike, guard: GuardState, S: Selectors = SELECTORS): Driver {
  const resultLinks = (): LocatorLike =>
    page.getByRole('main').getByRole('link', { name: S.results.resultLink });
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

  async function resultNames(d: Deadline): Promise<Array<string | null>> {
    const links = resultLinks();
    const n = await countOf(links, d);
    const names: Array<string | null> = [];
    for (let i = 0; i < n; i++) {
      const name = await nameOf(links.nth(i), d);
      // why: PIE-R2-10: a name too long is counted as unparsed upstream, never parsed and never dropped.
      names.push(name === null || name.length > S.maxNameLength ? null : name);
    }
    return names;
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

    async readFacts(d) {
      const url = page.url();
      const accountButtons = await countOf(page.getByRole('button', { name: S.blocked.accountControl }), d);
      const accountLinks = await countOf(page.getByRole('link', { name: S.blocked.accountControl }), d);
      const allTabs = page.getByRole('tab', { name: S.results.cheapestTab });
      const tabsInList = page.getByRole('tablist').getByRole('tab', { name: S.results.cheapestTab });
      const total = await countOf(allTabs, d);
      const inList = await countOf(tabsInList, d);
      const cheapestTabs: PageFacts['cheapestTabs'] = [];
      for (let i = 0; i < inList; i++)
        cheapestTabs.push({ name: (await nameOf(tabsInList.nth(i), d)) ?? '', inTablist: true });
      for (let i = inList; i < total; i++) cheapestTabs.push({ name: '', inTablist: false });
      const facts: PageFacts = {
        url,
        hops: [...guard.hops],
        frameUrls: [...new Set([...page.frames().map((f) => f.url()), ...guard.frameUrls])],
        text: {
          unusualTraffic: await has(page.getByText(S.blocked.unusualTraffic), d),
          consentHeading: await has(page.getByRole('heading', { name: S.consent.heading }), d),
          signInHeading: await has(page.getByRole('heading', { name: S.blocked.signInHeading }), d),
          challenge: await has(page.getByText(S.blocked.challenge), d),
          noFlights: await has(page.getByText(S.results.noFlights), d),
        },
        accountControl: accountButtons + accountLinks > 0,
        cheapestTabs,
        dateGridButtons: await countOf(
          page.getByRole('button', { name: S.results.dateGridButton, exact: true }),
          d,
        ),
        resultLinks: await countOf(resultLinks(), d),
      };
      // why: ruling of 2026-10-18: the loading text counts only when visible and outside the tab (never the tab's name)
      const visibleFetching = await visibleCount(page.getByText(S.results.fetching), d);
      const visibleInTabs = await visibleCount(page.getByRole('tab').getByText(S.results.fetching), d);
      const names = await resultNames(d);
      const settle: SettleFacts = {
        resultsReturned: await has(page.getByText(S.results.resultsReturned), d),
        fetching: visibleFetching > visibleInTabs,
        cheapestPriced: cheapestTabs.length === 1 && cheapestTabs.every((t) => /\d/.test(t.name)),
        linkSignature: createHash('sha256').update(JSON.stringify(names)).digest('hex').slice(0, 16),
      };
      return { page: facts, settle };
    },

    resultNames,

    async listFacts(d) {
      const names = await resultNames(d);
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
      await d.race(page.getByRole(role, { name, exact: true }).nth(0).click(timeoutOf(d)));
    },
  };
}

async function firstText(l: LocatorLike, d: Deadline): Promise<string | null> {
  if ((await countOf(l, d)) === 0) return null;
  return d.race(l.nth(0).textContent(timeoutOf(d)));
}

/**
 * The consent probe's page (Task 14.2; SEC-R2-003): the driver without `click`, so a click on a consent page does not
 * compile. Imported only by record.ts (rules.test.ts pins that).
 */
export type ProbePage = Omit<Driver, 'click'>;
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

/** Why `pollUntilSettled` stopped: a blocked kind, a no-flights page, or a settled page and how it classified. */
export interface Settled {
  kind: PageKind;
  facts: { page: PageFacts; settle: SettleFacts };
  polls: number;
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
  log?: Logger,
): Promise<Settled> {
  let previous: Previous | null = null;
  for (let polls = 1; ; polls++) {
    const facts = await driver.readFacts(d);
    const kind = classifyPage(facts.page, S);
    if (kind.kind === 'no-flights' || (kind.kind === 'blocked' && kind.page !== 'unrecognised'))
      return { kind, facts, polls };
    const current = {
      signature: facts.settle.linkSignature,
      links: facts.page.resultLinks,
      at: timers.now(),
    };
    const settled = isSettled(facts.page, facts.settle);
    // why: ruling of 2026-10-18: settled means stable content: the same links across two polls at least 2 s apart
    const stable = settled && stableAcross(previous, current);
    // why: one debug line a poll, the four booleans and the link count only, so a page that never settles is diagnosable
    log?.debug(
      {
        resultsReturned: facts.settle.resultsReturned,
        fetching: facts.settle.fetching,
        cheapestPriced: facts.settle.cheapestPriced,
        stable,
        resultLinks: facts.page.resultLinks,
      },
      'settle poll',
    );
    if (stable) return { kind, facts, polls };
    previous = settled ? current : null;
    await timers.sleep(pollMs, d.signal);
  }
}
