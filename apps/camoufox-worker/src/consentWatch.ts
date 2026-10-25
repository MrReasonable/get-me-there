import type { BlockedPage } from '@gmt/core';
import { classifyLanding } from './classify.js';
import type { ConsentDriver, PageView, SocsFields } from './consentDriver.js';
import { SELECTORS, type Selectors } from './selectors.js';
import type { Timers } from './timers.js';

/**
 * Watching a consent window (spec §2 "Consent"; decision 74; brief WP17 Task 17.4), shared by the research recorder and
 * the `consent` command. After the one load, the first view is classified once it settles (W8; pa-b1-004): snapshots a
 * tick apart until the landing rule decides (the landing view, the expected consent page, or a blocking page) or the
 * settle bound passes, as the server path's settle does. Then, once a tick, the driver's read-only observations: a
 * guard refusal, the main frame's hosts, the consent host's `/save` submissions, SOCS by name and domain, and an
 * account cookie. Once the person's choice was saved and the main frame is back on the results host, that view is
 * settled the same way and classified with the consent host's hops left out, so a challenge reached after consent
 * stops (and cools down) as it would on the server path. It ends when the person closes the window, when an account
 * cookie appears, on a blocking page or a guard refusal, or after 10 minutes. The ticks are the injected timers', so
 * tests drive them with fake timers. It never clicks, types or navigates.
 */
export const SOCS_CAPTURE_LIMIT_MS = 10 * 60_000;
/** How long a view may take to settle before it is taken as it stands (a backstop; the landing rule decides first). */
export const VIEW_SETTLE_MS = 30_000;
export const WATCH_TICK_MS = 1000;
export const CONSENT_HOST = 'consent.google.com';

export interface Watched {
  ended: 'closed' | 'timed-out' | 'account-cookie' | 'blocked';
  blocked: BlockedPage | null;
  /** The classifier's reading of the settled first view: `landing`, the expected consent page, or anything else. */
  firstView: 'landing' | 'consent' | 'other';
  firstFacts: PageView | null;
  /** The settled view once the choice was saved and the main frame is back on the results host. */
  afterView: 'landing' | 'other' | null;
  afterFacts: PageView | null;
  /** The consent host's `/save` submissions seen: the person's choice. */
  saves: number;
  /** Whether a SOCS was already there before the first submission (its value is never kept). */
  socsBeforeChoice: boolean;
  /** The SOCS first set, or changed, after the first submission; null when none was. */
  socs: SocsFields | null;
  hosts: string[];
}

type Decided = { kind: 'landing' | 'consent' | 'other' } | { kind: 'blocked'; page: BlockedPage };

const hostOf = (u: string): string | null => {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
};

/** The landing rule's reading of a view; `withoutConsent` leaves the consent host's hops out (the view after consent). */
function decide(facts: PageView, S: Selectors, withoutConsent: boolean): Decided {
  const f = withoutConsent ? { ...facts, hops: facts.hops.filter((h) => hostOf(h) !== CONSENT_HOST) } : facts;
  const k = classifyLanding(f, S).kind;
  if (k.kind === 'landing') return { kind: 'landing' };
  if (k.kind === 'blocked' && k.page === 'consent-unhandled')
    return { kind: withoutConsent ? 'other' : 'consent' };
  if (k.kind === 'blocked' && k.page !== 'unrecognised') return { kind: 'blocked', page: k.page };
  return { kind: 'other' };
}

export async function watchConsentWindow(
  d: ConsentDriver,
  o: { timers: Timers; selectors?: Selectors; limitMs?: number; tickMs?: number; settleMs?: number },
): Promise<Watched> {
  const S = o.selectors ?? SELECTORS;
  const limit = o.limitMs ?? SOCS_CAPTURE_LIMIT_MS;
  const tick = o.tickMs ?? WATCH_TICK_MS;
  const settleMs = o.settleMs ?? VIEW_SETTLE_MS;
  const started = o.timers.now();
  const w: Watched = {
    ended: 'closed',
    blocked: null,
    firstView: 'other',
    firstFacts: null,
    afterView: null,
    afterFacts: null,
    saves: 0,
    socsBeforeChoice: false,
    socs: null,
    hosts: [],
  };
  /** Snapshots a tick apart until the rule decides or the bound passes; the last view and its reading. */
  const settled = async (withoutConsent: boolean): Promise<{ facts: PageView; decided: Decided }> => {
    const from = o.timers.now();
    for (;;) {
      const facts = await d.snapshotView();
      const decided = decide(facts, S, withoutConsent);
      if (decided.kind !== 'other' || o.timers.now() - from >= settleMs || d.closed())
        return { facts, decided };
      await o.timers.sleep(tick);
    }
  };
  const first = await settled(false);
  w.firstFacts = first.facts;
  if (first.decided.kind === 'blocked') return { ...w, ended: 'blocked', blocked: first.decided.page };
  w.firstView =
    first.decided.kind === 'landing' ? 'landing' : first.decided.kind === 'consent' ? 'consent' : 'other';
  let socsBefore: string | null = null;
  for (;;) {
    if (d.closed()) return { ...w, ended: 'closed' };
    try {
      const refused = d.refused();
      if (refused !== null) return { ...w, ended: 'blocked', blocked: refused };
      w.hosts = [...d.mainFrameHosts()];
      w.saves = d.consentSaves();
      if (w.saves > 0 && w.afterFacts === null && w.hosts.at(-1) === S.hosts.results) {
        const after = await settled(true);
        w.afterFacts = after.facts;
        if (after.decided.kind === 'blocked') return { ...w, ended: 'blocked', blocked: after.decided.page };
        w.afterView = after.decided.kind === 'landing' ? 'landing' : 'other';
      }
      if (await d.accountCookieSeen()) return { ...w, ended: 'account-cookie' };
      const socs = await d.socsCookie();
      // why: W8 (pa-b1-005): only a SOCS set or changed after the choice was submitted is the choice's
      if (w.saves === 0) {
        if (socs !== null) {
          w.socsBeforeChoice = true;
          socsBefore = socs.value;
        }
      } else if (socs !== null && socs.value !== socsBefore) w.socs = socs;
    } catch (e) {
      // why: a window the person closed between ticks reads as closed, whatever the read was doing then
      if (d.closed()) return { ...w, ended: 'closed' };
      throw e;
    }
    if (o.timers.now() - started >= limit) return { ...w, ended: 'timed-out' };
    await o.timers.sleep(tick);
  }
}
