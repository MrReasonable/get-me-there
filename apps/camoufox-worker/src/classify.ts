import type { BlockedPage } from '@gmt/core';
import { onAllowlist } from './guard.js';
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
  };
  accountControl: boolean;
  cheapestTabs: Array<{ name: string; inTablist: boolean }>;
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
  | 'no-result-links';

export function classifyPage(f: PageFacts, S: Selectors = SELECTORS): PageKind {
  return classifyPageWithRule(f, S).kind;
}

/** The same decision as classifyPage, with the rule that fired. */
export function classifyPageWithRule(
  f: PageFacts,
  S: Selectors = SELECTORS,
): { kind: PageKind; rule: ClassifyRule } {
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
  if (S.NO_FLIGHTS_VERIFIED && f.text.noFlights)
    return { kind: { kind: 'no-flights' }, rule: 'no-flights-line' };
  const tabs = f.cheapestTabs;
  if (tabs.length !== 1) return blocked('unrecognised', 'cheapest-tab-count');
  if (!tabs.every((x) => x.inTablist)) return blocked('unrecognised', 'cheapest-tab-outside-tablist');
  if (f.dateGridButtons !== 1) return blocked('unrecognised', 'date-grid-buttons');
  if (f.resultLinks <= 0) return blocked('unrecognised', 'no-result-links');
  return { kind: { kind: 'results' }, rule: 'results' };
}
