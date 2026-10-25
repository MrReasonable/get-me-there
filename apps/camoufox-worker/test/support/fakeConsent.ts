// A scripted ConsentDriver for the consent window's tests: no browser, no page. Each watcher tick reads the hosts once,
// so the script is indexed by tick: the hosts the main frame has seen by then, when SOCS and an account cookie appear,
// and when the person closes the window. `load` sends the scripted requests to the listener, as a session would.
import type { BlockedPage } from '@gmt/core';
import type { ConsentDriver, DisplayEnv, PageView, SocsFields } from '../../src/consentDriver.js';
import type { RequestLike } from '../../src/driver.js';

export const LANDING_URL = 'https://www.google.com/travel/flights?hl=en-GB&gl=GB';
export const CONSENT_URL = 'https://consent.google.com/ml?continue=https://www.google.com/travel/flights';

export function view(o: Partial<PageView> = {}): PageView {
  return {
    url: LANDING_URL,
    hops: [LANDING_URL],
    frameUrls: [],
    text: {
      unusualTraffic: false,
      consentHeading: false,
      signInHeading: false,
      challenge: false,
      noFlights: false,
      landingHeading: true,
    },
    accountControl: false,
    cheapestTabs: [],
    dateGridButtons: 0,
    resultLinks: 0,
    headings: ['Flights'],
    ...o,
  };
}
export const consentView = (): PageView =>
  view({
    url: CONSENT_URL,
    hops: [LANDING_URL, CONSENT_URL],
    text: { ...view().text, consentHeading: true, landingHeading: false },
    headings: ['Before you continue to Google'],
  });

export const SOCS: SocsFields = {
  value: 'synthetic-socs-reject',
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
};

export interface Script {
  first?: PageView;
  after?: PageView;
  /** Snapshots in order, before `first`/`after` take over (a view that settles late). */
  views?: PageView[];
  /** The tick after which the person's choice has been submitted, and how many times. */
  saveAt?: number;
  saves?: number;
  /** The tick after which the guard has refused a main-frame navigation, and as what. */
  refusedAt?: number;
  refused?: BlockedPage;
  /** The hosts by tick (the last repeats). */
  hosts?: string[][];
  socs?: SocsFields;
  socsAt?: number;
  accountAt?: number;
  closeAt?: number;
  requests?: RequestLike[];
  launchThrows?: Error;
}

export type FakeConsentDriver = ConsentDriver & {
  calls: string[];
  displays: DisplayEnv[];
  loads: string[];
  ticks(): number;
};

export function fakeConsentDriver(
  s: Script,
  onRequest: (r: RequestLike) => void = () => undefined,
): FakeConsentDriver {
  let tick = 0;
  let shut = false;
  let snapshots = 0;
  const calls: string[] = [];
  const displays: DisplayEnv[] = [];
  const loads: string[] = [];
  const hosts = s.hosts ?? [['consent.google.com'], ['consent.google.com', 'www.google.com']];
  return {
    calls,
    displays,
    loads,
    ticks: () => tick,
    async launchHeaded(display) {
      calls.push('launchHeaded');
      displays.push(display);
      if (s.launchThrows !== undefined) throw s.launchThrows;
    },
    async load(url) {
      calls.push('load');
      loads.push(url);
      for (const r of s.requests ?? []) onRequest(r);
    },
    mainFrameHosts() {
      calls.push('mainFrameHosts');
      const h = hosts[Math.min(tick, hosts.length - 1)] ?? [];
      tick++;
      return h;
    },
    consentSaves: () => (s.saveAt !== undefined && tick > s.saveAt ? (s.saves ?? 1) : 0),
    refused: () => (s.refusedAt !== undefined && tick > s.refusedAt ? (s.refused ?? 'off-allowlist') : null),
    async snapshotView() {
      calls.push('snapshotView');
      snapshots++;
      const scripted = s.views?.[snapshots - 1];
      if (scripted !== undefined) return scripted;
      return snapshots === 1 ? (s.first ?? consentView()) : (s.after ?? view());
    },
    async socsCookie() {
      calls.push('socsCookie');
      return s.socsAt !== undefined && tick > s.socsAt ? (s.socs ?? SOCS) : null;
    },
    async accountCookieSeen() {
      calls.push('accountCookieSeen');
      return s.accountAt !== undefined && tick > s.accountAt;
    },
    closed: () => shut || (s.closeAt !== undefined && tick > s.closeAt),
    async close() {
      calls.push('close');
      shut = true;
    },
  };
}

/** A request as the listener sees it: a navigation, or a POST with a body (URL-encoded unless `type` says otherwise). */
export function request(o: {
  url: string;
  method?: string;
  nav?: boolean;
  body?: string;
  type?: string;
}): RequestLike {
  return {
    url: () => o.url,
    method: () => o.method ?? 'GET',
    isNavigationRequest: () => o.nav ?? true,
    redirectedFrom: () => null,
    frame: () => ({ url: () => o.url, parentFrame: () => null }),
    postData: () => o.body ?? null,
    headers: () => ({ 'content-type': o.type ?? 'application/x-www-form-urlencoded;charset=utf-8' }),
  };
}
