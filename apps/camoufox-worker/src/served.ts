import type { BlockedPage, Logger } from '@gmt/core';
import type { PageFacts } from './classify.js';
import {
  classifyAfterFailedStep,
  type Driver,
  type FormFacts,
  pollUntilSettled,
  type Settled,
  type SettleFacts,
  type StepOptions,
} from './driver.js';
import { checkForm } from './form.js';
import type { Selectors } from './selectors.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

/**
 * The served sequence (spec §2 rev 55 "The flight-list read", revision 56 "A second outbound"; WP21 Task 21.3, preflight
 * row T21.3): the Best view polled until settled (a blocked kind is the stop; Google's no-flights line ends it), the
 * search form checked (a mismatch is `unrecognised`), then the Cheapest flow where the entry verified it: its clicks and
 * its poll, a failed step classified once (driver.ts's `classifyAfterFailedStep`: a blocked kind is the stop), otherwise
 * the Best view as it stands (the honesty rule: `best-fallback`). One module, so the page session's first view, the
 * return phase's reload and the recorder's research all run it alike. Its Cheapest deadline is a parameter
 * (prov-int-r3-004): `budget.next` on the first view, `() => budget.nextFor(pageTimeoutMs)` on the reload, so the
 * reload's Cheapest flow has a full page period of its own however late it starts. A leaf beside the driver: imported
 * by session.ts, returnPhase.ts and recordSelect.ts (rules.test.ts pins the three).
 */
export interface ServedPage {
  driver: Pick<Driver, 'readFacts' | 'formFacts' | 'clickCheapest'>;
  S: Selectors;
  timers: Timers;
  log?: Logger;
  pollMs: number;
  /** timers.now() when the page started: every poll and step line carries the elapsed time from it. */
  startedAt: number;
  /** The request the search form must show (round trip, one adult, its dates). */
  request: Parameters<typeof checkForm>[1];
}

/** The facts a stop keeps (what the classifier saw). */
export interface ServedFacts {
  page: PageFacts;
  settle: SettleFacts;
}

/** How the served sequence ended: a stop, Google's no-flights line, or the view a reader reads. */
export type ServedEnd =
  | { kind: 'stop'; page: BlockedPage; rule: string; facts: ServedFacts }
  | { kind: 'no-flights'; best: Settled; d: Deadline }
  | {
      kind: 'read';
      best: Settled;
      /** The settled Cheapest view when the flow ran and settled; null otherwise. */
      cheapest: Settled | null;
      /** `cheapest`: the Cheapest view; `best-fallback`: the Best view after the flow failed; null: no flow ran. */
      view: 'cheapest' | 'best-fallback' | null;
      /** The view the reader reads (the Cheapest view when it settled, else the Best view). */
      shown: Settled;
      /** The deadline current at the end (the Cheapest flow's when it ran): the reads after it race this one. */
      d: Deadline;
    };

/** What a caller may do inside the sequence: the recorder reads each view there, the moment it settles. */
export interface ServedHooks {
  /**
   * After the Best view settles (results or no-flights), before the form check; a caller that reads the form itself
   * returns it, so the form is read once (the recorder), else the sequence reads it.
   */
  afterBest?(s: Settled, d: Deadline): Promise<FormFacts | undefined>;
  /** After the Cheapest view settles as results. */
  afterCheapest?(s: Settled, d: Deadline): Promise<void>;
  /** What the Cheapest flow clicked, as soon as it clicked it (so a stop after the click still names it). */
  clicked?(names: string[]): void;
}

/**
 * Runs the served sequence from the loaded page under `d0`. A blocked kind on any poll, a page that is not results
 * after the Cheapest click, and a form mismatch end as `stop`; the deadline's own expiry surfaces as DeadlineExceeded,
 * as it always has (the caller's not-ready, or the return phase's transient end).
 */
export async function servedSequence(
  p: ServedPage,
  d0: Deadline,
  cheapestDeadline: () => Deadline,
  hooks: ServedHooks = {},
): Promise<ServedEnd> {
  const { driver, S, timers, log, pollMs, startedAt } = p;
  let d = d0;
  const poll = (view: 'best' | 'cheapest') =>
    pollUntilSettled(driver, d, timers, pollMs, S, {
      view,
      ...(log === undefined ? {} : { log }),
      startedAt,
    });
  const best = await poll('best');
  if (best.kind.kind === 'blocked')
    return { kind: 'stop', page: best.kind.page, rule: best.rule, facts: best.facts };
  const read = await hooks.afterBest?.(best, d);
  // why: ruling B8: Google's own no-flights line is answered before any reader runs
  if (best.kind.kind === 'no-flights') return { kind: 'no-flights', best, d };
  const form = checkForm(read === undefined ? await driver.formFacts(d) : read, p.request);
  if (form !== 'ok')
    return { kind: 'stop', page: 'unrecognised', rule: `search-form:${form}`, facts: best.facts };
  // why: the worker clicks only flows its selectors module marks verified (PIE-09), re-reading the facts after each
  if (!S.CHEAPEST_FLOW_VERIFIED || best.facts.page.cheapestTabs.length !== 1)
    return { kind: 'read', best, cheapest: null, view: null, shown: best, d };
  d = cheapestDeadline();
  const steps: StepOptions = { timers, ...(log === undefined ? {} : { log }), startedAt };
  try {
    // why: the click runs whether or not a caller listens (an optional call would skip its argument)
    const clicked = await driver.clickCheapest(d, steps);
    hooks.clicked?.(clicked);
    // why: rulings of 2026-10-18: every Cheapest poll is a 20 s step with 5 s lookups inside it; one that overruns is
    // polled again, and only the budget's end fails the flow (then it falls back)
    const after = await poll('cheapest');
    if (after.kind.kind !== 'results')
      return {
        kind: 'stop',
        page: after.kind.kind === 'blocked' ? after.kind.page : 'unrecognised',
        // why: a no-flights page after a click names that (`no-flights-after-click`), as the recorder always did
        rule: after.kind.kind === 'blocked' ? after.rule : `${after.kind.kind}-after-click`,
        facts: after.facts,
      };
    await hooks.afterCheapest?.(after, d);
    return { kind: 'read', best, cheapest: after, view: 'cheapest', shown: after, d };
  } catch (e) {
    // why: the honesty rule (rulings of 2026-10-18): a Cheapest flow whose step fails or times out is read as the Best
    // view stands, and the tab's lower price goes with it; the deadline still ends the page (or the step)
    if (e instanceof DeadlineExceeded || d.expired()) throw e;
    // why: a failed step may be a page that is no results page at all (a challenge after the click): it is classified
    // once, under its own step, and a blocked kind stops the page with its cool-down, as on any poll
    const blocked = await classifyAfterFailedStep(driver, d, steps, S, 'cheapest');
    if (blocked !== null)
      return { kind: 'stop', page: blocked.page, rule: blocked.rule, facts: blocked.facts };
    return { kind: 'read', best, cheapest: null, view: 'best-fallback', shown: best, d };
  }
}
