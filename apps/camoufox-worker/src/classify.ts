import type { BlockedPage } from '@gmt/core';
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
export function classifyPage(f: PageFacts, S: Selectors = SELECTORS): PageKind {
  const all = [f.url, ...f.hops].map(urlOf);
  const onHost = (h: string): boolean => all.some((u) => u !== null && u.hostname === h);
  const captchaFrame = f.frameUrls.some((x) => {
    const u = urlOf(x);
    return u !== null && u.hostname === S.hosts.results && u.pathname.startsWith(S.blocked.captchaPath);
  });
  if (captchaFrame || f.text.challenge) return { kind: 'blocked', page: 'captcha' };
  if (all.some((u) => u?.pathname.startsWith(S.blocked.sorryPathPrefix)) || f.text.unusualTraffic)
    return { kind: 'blocked', page: 'unusual-traffic' };
  if (f.accountControl) return { kind: 'blocked', page: 'signed-in' };
  if (onHost(S.hosts.consent) || f.text.consentHeading) return { kind: 'blocked', page: 'consent-unhandled' };
  if (onHost(S.hosts.signIn) || f.text.signInHeading) return { kind: 'blocked', page: 'sign-in' };
  const allowed = (u: URL | null): boolean =>
    u !== null &&
    u.protocol === 'https:' &&
    u.hostname === S.hosts.results &&
    (u.pathname === S.resultsPath || u.pathname.startsWith(`${S.resultsPath}/`));
  if (!all.every(allowed)) return { kind: 'blocked', page: 'off-allowlist' };
  if (S.NO_FLIGHTS_VERIFIED && f.text.noFlights) return { kind: 'no-flights' };
  const tabs = f.cheapestTabs;
  if (tabs.length === 1 && tabs.every((x) => x.inTablist) && f.dateGridButtons === 1 && f.resultLinks > 0)
    return { kind: 'results' };
  return { kind: 'blocked', page: 'unrecognised' };
}
