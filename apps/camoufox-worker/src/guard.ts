import type { BlockedPage, Logger } from '@gmt/core';
import type { ContextLike, FrameLike, PageLike, RequestLike, RouteLike } from './driver.js';
import { SELECTORS, type Selectors } from './selectors.js';

/**
 * The navigation allowlist (brief §6; spec §2 "Navigation and the stops"; decision 69 round 2, item 3). A document
 * or frame navigation is allowed only to `https://www.google.com` with a path equal to `/travel/flights` or under
 * `/travel/flights/`. It is enforced three ways, because `context.route` sees only a redirect's first URL and nothing a
 * service worker answers: the launch blocks service workers; the route aborts any navigation off the allowlist; and the
 * `request` and `framenavigated` listeners record every main-frame navigation's URL and each redirect hop, so a 302 to
 * another host stops the page however it arrived (the classifier reads `hops`). Subresources load as in any browser.
 */
export type RouteDecision = { action: 'continue' } | { action: 'abort'; kind: BlockedPage };

/** What the guard saw on one page: main-frame hops and sub-frame navigation URLs, plus the first refused main-frame navigation. */
export interface GuardState {
  hops: string[];
  frameUrls: string[];
  refused: BlockedPage | null;
}

function urlOf(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** True when `u` is https on `host` with the default port and no user or password (fix round 1, sec M2). */
function plainHttps(u: URL, host: string): boolean {
  return (
    u.protocol === 'https:' && u.hostname === host && u.port === '' && u.username === '' && u.password === ''
  );
}

/** True when `raw` is on the results allowlist; the classifier reads the same rule. */
export function onAllowlist(raw: string, S: Selectors = SELECTORS): boolean {
  const u = urlOf(raw);
  return (
    u !== null &&
    plainHttps(u, S.hosts.results) &&
    (u.pathname === S.resultsPath || u.pathname.startsWith(`${S.resultsPath}/`))
  );
}

/** The kind an off-allowlist navigation implies: the consent and sign-in hosts are their own kinds. */
export function refusalKind(raw: string, S: Selectors = SELECTORS): BlockedPage {
  const host = urlOf(raw)?.hostname;
  if (host === S.hosts.consent) return 'consent-unhandled';
  if (host === S.hosts.signIn) return 'sign-in';
  return 'off-allowlist';
}

/** The pure route rule: a navigation off the allowlist is aborted with its kind; a subresource always continues. */
export function decideRoute(url: string, isNavigation: boolean, S: Selectors = SELECTORS): RouteDecision {
  if (!isNavigation || onAllowlist(url, S)) return { action: 'continue' };
  return { action: 'abort', kind: refusalKind(url, S) };
}

/** The consent host's path that records a choice; the probe never navigates there (fix round 1, sec M3). */
const CONSENT_SAVE_PATH = '/save';

/**
 * The consent probe's variant (Task 14.2; the recorder only): also admits GET document navigations to
 * `https://consent.google.com/`, except its `/save` path, and nothing else. Never reachable from the server path
 * (rules.test.ts pins that only record.ts imports it).
 */
export function decideProbeRoute(
  url: string,
  isNavigation: boolean,
  method = 'GET',
  S: Selectors = SELECTORS,
): RouteDecision {
  const u = urlOf(url);
  const save =
    u !== null && (u.pathname === CONSENT_SAVE_PATH || u.pathname.startsWith(`${CONSENT_SAVE_PATH}/`));
  if (isNavigation && u !== null && method === 'GET' && !save && plainHttps(u, S.hosts.consent))
    return { action: 'continue' };
  return decideRoute(url, isNavigation, S);
}

function isMainFrame(frame: FrameLike): boolean {
  return frame.parentFrame() === null;
}

/** The request's frame, or null when it has none (a service-worker request, which the launch blocks anyway). */
function frameOf(r: RequestLike): FrameLike | null {
  try {
    return r.frame();
  } catch {
    return null;
  }
}

interface Installed {
  state: GuardState;
  ready: Promise<void>;
}
// why: one persistent context serves page after page (concurrency 1); the route and the request listener are
// registered once per context and the state is reset for each page, so handlers never pile up.
const installed = new WeakMap<ContextLike, Installed>();

function install(
  context: ContextLike,
  page: PageLike,
  log: Logger,
  decide: (url: string, isNavigation: boolean, method: string) => RouteDecision,
): Promise<GuardState> {
  let entry = installed.get(context);
  if (entry === undefined) {
    const state: GuardState = { hops: [], frameUrls: [], refused: null };
    context.on('request', (r: RequestLike) => {
      if (!r.isNavigationRequest()) return;
      const chain: string[] = [];
      for (let x: RequestLike | null = r; x !== null; x = x.redirectedFrom()) chain.unshift(x.url());
      const frame = frameOf(r);
      // why: a sub-frame's URL feeds the captcha rule; only the main frame's navigations are hops of the page.
      if (frame !== null && !isMainFrame(frame)) state.frameUrls.push(...chain);
      else for (const u of chain) if (!state.hops.includes(u)) state.hops.push(u);
    });
    const ready = context.route('**/*', async (route: RouteLike) => {
      const req = route.request();
      const d = decide(req.url(), req.isNavigationRequest(), req.method());
      if (d.action === 'continue') return route.fallback();
      // why: the first main-frame refusal names the page kind the session answers with (a refused sub-frame is aborted
      // but never names the page, fix round 1 prov-int M6; a frameless one counts as the main frame's, failing closed);
      // the host only, never the URL (spec §14).
      const frame = frameOf(req);
      if (frame === null || isMainFrame(frame)) state.refused ??= d.kind;
      log.warn({ kind: d.kind, host: urlOf(req.url())?.hostname ?? 'unparsable' }, 'navigation refused');
      return route.abort('blockedbyclient');
    });
    entry = { state, ready };
    installed.set(context, entry);
  }
  const { state } = entry;
  state.hops = [];
  state.frameUrls = [];
  state.refused = null;
  page.on('framenavigated', (frame: FrameLike) => {
    if (!isMainFrame(frame)) state.frameUrls.push(frame.url());
    else if (!state.hops.includes(frame.url())) state.hops.push(frame.url());
  });
  return entry.ready.then(() => state);
}

/** Wires the server path's guard onto a context and its page; resolves once the route is registered. */
export function installGuard(context: ContextLike, page: PageLike, log: Logger, S: Selectors = SELECTORS) {
  return install(context, page, log, (u, n) => decideRoute(u, n, S));
}

/** The consent probe's guard (record.ts only). */
export function installProbeGuard(
  context: ContextLike,
  page: PageLike,
  log: Logger,
  S: Selectors = SELECTORS,
) {
  return install(context, page, log, (u, n, m) => decideProbeRoute(u, n, m, S));
}
