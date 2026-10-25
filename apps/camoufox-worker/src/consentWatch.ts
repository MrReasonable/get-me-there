import type { BlockedPage } from '@gmt/core';
import { classifyLanding } from './classify.js';
import type { ConsentDriver, PageView, SocsFields } from './consentDriver.js';
import { SELECTORS, type Selectors } from './selectors.js';
import type { Timers } from './timers.js';

/**
 * Watching a consent window (spec §2 "Consent"; decision 74; brief WP17 Task 17.4), shared by the research recorder and
 * the `consent` command: after the one load, the first view is classified once (`classifyLanding`), then, once a tick,
 * the driver's read-only observations: the main frame's hosts, SOCS by name and domain, and an account cookie. It ends
 * when the person closes the window, when an account cookie appears, when the first view is a blocking page (a
 * challenge, a sign-in or anything the classifier stops on but the expected consent page), or after 10 minutes. The
 * ticks are the injected timers', so tests drive them with fake timers. It never clicks, types or navigates.
 */
export const SOCS_CAPTURE_LIMIT_MS = 10 * 60_000;
export const WATCH_TICK_MS = 1000;
export const CONSENT_HOST = 'consent.google.com';

export interface Watched {
  ended: 'closed' | 'timed-out' | 'account-cookie' | 'blocked';
  blocked: BlockedPage | null;
  /** The classifier's reading of the first view: `landing`, the expected consent page, or anything else. */
  firstView: 'landing' | 'consent' | 'other';
  firstFacts: PageView | null;
  /** The view once the main frame is back on the results host after the consent host (the landing view, recorded). */
  afterFacts: PageView | null;
  consentHostSeen: boolean;
  /** The SOCS last read, and whether it was read after the consent host was seen. */
  socs: SocsFields | null;
  socsAfterConsent: boolean;
  hosts: string[];
}

export async function watchConsentWindow(
  d: ConsentDriver,
  o: { timers: Timers; selectors?: Selectors; limitMs?: number; tickMs?: number },
): Promise<Watched> {
  const S = o.selectors ?? SELECTORS;
  const limit = o.limitMs ?? SOCS_CAPTURE_LIMIT_MS;
  const tick = o.tickMs ?? WATCH_TICK_MS;
  const started = o.timers.now();
  const w: Watched = {
    ended: 'closed',
    blocked: null,
    firstView: 'other',
    firstFacts: null,
    afterFacts: null,
    consentHostSeen: false,
    socs: null,
    socsAfterConsent: false,
    hosts: [],
  };
  const facts = await d.snapshotView();
  w.firstFacts = facts;
  const k = classifyLanding(facts, S).kind;
  if (k.kind === 'landing') w.firstView = 'landing';
  else if (k.kind === 'blocked' && k.page === 'consent-unhandled') w.firstView = 'consent';
  else if (k.kind === 'blocked' && k.page !== 'unrecognised') {
    return { ...w, ended: 'blocked', blocked: k.page };
  }
  for (;;) {
    if (d.closed()) return { ...w, ended: 'closed' };
    try {
      w.hosts = [...d.mainFrameHosts()];
      if (w.hosts.includes(CONSENT_HOST) || w.firstView === 'consent') w.consentHostSeen = true;
      if (w.consentHostSeen && w.afterFacts === null && w.hosts.at(-1) === S.hosts.results)
        w.afterFacts = await d.snapshotView();
      if (await d.accountCookieSeen()) return { ...w, ended: 'account-cookie' };
      const socs = await d.socsCookie();
      if (socs !== null) {
        w.socs = socs;
        if (w.consentHostSeen) w.socsAfterConsent = true;
      }
    } catch (e) {
      // why: a window the person closed between ticks reads as closed, whatever the read was doing then
      if (d.closed()) return { ...w, ended: 'closed' };
      throw e;
    }
    if (o.timers.now() - started >= limit) return { ...w, ended: 'timed-out' };
    await o.timers.sleep(tick);
  }
}
