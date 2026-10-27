import type { BlockedPage } from '@gmt/core';
import { onAllowlist } from './guard.js';
import type { View } from './ready.js';
import { SELECTORS, type Selectors } from './selectors.js';

/**
 * What the driver reads from a page through locators (decision 69 round 2, item 5): each field one locator query
 * with its own timeout. `hops` are the main frame's navigation URLs and redirect hops the guard recorded.
 */
export interface PageFacts {
  url: string;
  hops: string[];
  frameUrls: string[];
  text: {
    unusualTraffic: boolean;
    consentHeading: boolean;
    signInHeading: boolean;
    challenge: boolean;
    noFlights: boolean;
    /** The landing view's heading (WP17 Task 17.4; a hypothesis until LANDING_VERIFIED). */
    landingHeading: boolean;
  };
  accountControl: boolean;
  /** `selected`: the tab is the selected one (aria-selected), read for the tabs in the tablist. */
  cheapestTabs: Array<{ name: string; inTablist: boolean; selected?: boolean }>;
  dateGridButtons: number;
  resultLinks: number;
}
export type PageKind = { kind: 'results' } | { kind: 'no-flights' } | { kind: 'blocked'; page: BlockedPage };

function urlOf(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Brief §9 (spec §2 "Navigation and the stops"): blocked kinds first, in the table's order, the first match winning;
 * total over any input (an unparsable URL is `off-allowlist`); anything not positively recognised as a results page
 * is `unrecognised`. Selectors are injected (the module's by default) so every flag is testable both ways (TS2-04).
 */
/** The rule that decided a page (diagnostics of 2026-10-18: a stop names the rule that fired). */
export type ClassifyRule =
  | 'captcha-frame'
  | 'challenge-text'
  | 'sorry-path'
  | 'unusual-traffic-text'
  | 'account-control'
  | 'consent-host'
  | 'consent-heading'
  | 'sign-in-host'
  | 'sign-in-heading'
  | 'off-allowlist'
  | 'no-flights-line'
  | 'results'
  | 'cheapest-tab-count'
  | 'cheapest-tab-outside-tablist'
  | 'date-grid-buttons'
  | 'cheapest-tab-not-selected'
  | 'cheapest-tab-unpriced'
  | 'no-result-links'
  | 'landing'
  | 'not-landing';

/**
 * The tab price in pence, read from the start of the Cheapest tab's name (`S.results.cheapestTabPrice`), or null when
 * the name states none there. The name also carries an information pop-up's text, so a price or digit later in it is
 * never the tab's (CodeRabbit on PR #33).
 */
export function cheapestTabPriceMinor(name: string, S: Selectors = SELECTORS): number | null {
  const m = S.results.cheapestTabPrice.exec(name);
  const digits = m?.[1] ?? m?.[2];
  return digits === undefined ? null : Number(digits.replaceAll(',', '')) * 100;
}

export function classifyPage(f: PageFacts, S: Selectors = SELECTORS, view: View = 'best'): PageKind {
  return classifyPageWithRule(f, S, view).kind;
}

/**
 * The same decision as classifyPage, with the rule that fired. `view` (ruling of 2026-10-18): the Best view is a results page with exactly one Date grid button; the Cheapest view
 * has none and is recognised by its one tab in the tablist being selected and priced. Either needs result links.
 */
export function classifyPageWithRule(
  f: PageFacts,
  S: Selectors = SELECTORS,
  view: View = 'best',
): { kind: PageKind; rule: ClassifyRule } {
  const b = blockedRule(f, S);
  if (b !== null) return b;
  const blocked = (page: BlockedPage, rule: ClassifyRule) => ({
    kind: { kind: 'blocked' as const, page },
    rule,
  });
  // why: ruling of 2026-10-18: the line counts only on a page with no result links, so the flag can never misread a
  // results page (the Cheapest view carries a status line matching it beside 21 links)
  if (S.NO_FLIGHTS_VERIFIED && f.text.noFlights && f.resultLinks === 0)
    return { kind: { kind: 'no-flights' }, rule: 'no-flights-line' };
  const tabs = f.cheapestTabs;
  if (tabs.length !== 1) return blocked('unrecognised', 'cheapest-tab-count');
  if (!tabs.every((x) => x.inTablist)) return blocked('unrecognised', 'cheapest-tab-outside-tablist');
  if (view === 'best' && f.dateGridButtons !== 1) return blocked('unrecognised', 'date-grid-buttons');
  if (view === 'cheapest' && !tabs.every((x) => x.selected === true))
    return blocked('unrecognised', 'cheapest-tab-not-selected');
  if (view === 'cheapest' && !tabs.every((x) => cheapestTabPriceMinor(x.name, S) !== null))
    return blocked('unrecognised', 'cheapest-tab-unpriced');
  if (f.resultLinks <= 0) return blocked('unrecognised', 'no-result-links');
  return { kind: { kind: 'results' }, rule: 'results' };
}

/** The blocked kinds, in the table's order, the first match winning; null when none applies (total over any input). */
function blockedRule(f: PageFacts, S: Selectors): { kind: PageKind; rule: ClassifyRule } | null {
  const blocked = (page: BlockedPage, rule: ClassifyRule) => ({
    kind: { kind: 'blocked' as const, page },
    rule,
  });
  const all = [f.url, ...f.hops].map(urlOf);
  const onHost = (h: string): boolean => all.some((u) => u !== null && u.hostname === h);
  const captchaFrame = f.frameUrls.some((x) => {
    const u = urlOf(x);
    return u !== null && u.hostname === S.hosts.results && u.pathname.startsWith(S.blocked.captchaPath);
  });
  if (captchaFrame) return blocked('captcha', 'captcha-frame');
  if (f.text.challenge) return blocked('captcha', 'challenge-text');
  if (all.some((u) => u?.pathname.startsWith(S.blocked.sorryPathPrefix)))
    return blocked('unusual-traffic', 'sorry-path');
  if (f.text.unusualTraffic) return blocked('unusual-traffic', 'unusual-traffic-text');
  if (f.accountControl) return blocked('signed-in', 'account-control');
  if (onHost(S.hosts.consent)) return blocked('consent-unhandled', 'consent-host');
  if (f.text.consentHeading) return blocked('consent-unhandled', 'consent-heading');
  if (onHost(S.hosts.signIn)) return blocked('sign-in', 'sign-in-host');
  if (f.text.signInHeading) return blocked('sign-in', 'sign-in-heading');
  // why: the guard's one allowlist rule (fix round 1: the port and user checks live there once)
  if (![f.url, ...f.hops].every((x) => onAllowlist(x, S))) return blocked('off-allowlist', 'off-allowlist');
  return null;
}

/**
 * The consent command's first view (WP17 Task 17.4; spec §2 "Consent"): the blocked kinds first, as on every page;
 * then `landing` only when it is positively recognised (LANDING_VERIFIED, the URL the command opened with no query,
 * the landing heading, and no results page structure); anything else is `unrecognised`. Pure.
 */
export function classifyLanding(
  f: PageFacts,
  S: Selectors = SELECTORS,
): { kind: { kind: 'landing' } | PageKind; rule: ClassifyRule } {
  const b = blockedRule(f, S);
  if (b !== null) return b;
  const u = urlOf(f.url);
  const bare =
    u !== null && u.pathname === S.resultsPath && !u.searchParams.has('q') && !u.searchParams.has('tfs');
  const landing =
    S.LANDING_VERIFIED &&
    bare &&
    f.text.landingHeading &&
    f.resultLinks === 0 &&
    f.cheapestTabs.length === 0 &&
    f.dateGridButtons === 0;
  return landing
    ? { kind: { kind: 'landing' }, rule: 'landing' }
    : { kind: { kind: 'blocked', page: 'unrecognised' }, rule: 'not-landing' };
}
