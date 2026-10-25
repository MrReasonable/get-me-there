import type { Logger } from '@gmt/core';
import type { ContextLike, PageLike } from './driver.js';
import { decideRoute, installWith, plainHttps, type RouteDecision, urlOf } from './guard.js';
import { SELECTORS, type Selectors } from './selectors.js';

/**
 * The consent capture's guard (spec §2 "Consent"; decision 74; brief WP17 Task 17.4), built only for the `consent`
 * command and the `consent-research` recorder kind, where a person clicks in a visible window. It is the server path's
 * allowlist widened by exactly the main frame's document navigations and form POSTs to `https://consent.google.com`
 * (its `/save` included, which records the person's choice) and, through the allowlist itself, the redirect back to
 * `www.google.com/travel/flights`; every other host is refused as on the server path, and the server path's guard never
 * admits the consent host at all. The tool never navigates there itself: these are the person's clicks.
 */
export function decideConsentCaptureRoute(
  url: string,
  isNavigation: boolean,
  method = 'GET',
  mainFrame = true,
  S: Selectors = SELECTORS,
): RouteDecision {
  const u = urlOf(url);
  if (
    isNavigation &&
    mainFrame &&
    u !== null &&
    plainHttps(u, S.hosts.consent) &&
    (method === 'GET' || method === 'POST')
  )
    return { action: 'continue' };
  return decideRoute(url, isNavigation, mainFrame, S);
}

/** Wires the consent capture's guard onto a context and its page (consentDriver.ts only). */
export function installConsentCaptureGuard(
  context: ContextLike,
  page: PageLike,
  log: Logger,
  S: Selectors = SELECTORS,
) {
  return installWith(context, page, log, (u, n, m, main) => decideConsentCaptureRoute(u, n, m, main, S));
}
