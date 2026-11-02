import {
  type BlockedPage,
  type BookingRead,
  bookingReturnOf,
  FLIGHT_LIST_MAX_FLIGHTS,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightLimits,
  type FlightsRequest,
  fitsLimits,
  type ListedFlight,
  type Logger,
  type ReturnAttempt,
  type ReturnRead,
  type ReturnStatus,
  selectOutbound,
  stripUrlsInText,
} from '@gmt/core';
import type { PageBudget } from './budget.js';
import {
  classifyAfterFailedStep,
  type Driver,
  PollStopped,
  pathField,
  pollUntilSettled,
  type Settled,
  StepFailed,
  type StepOptions,
} from './driver.js';
import { type FlightsRead, readFlights } from './flights.js';
import type { GuardState } from './guard.js';
import { OFFER_GRAMMAR_VERSION, type OffersRead, readOffers } from './offers.js';
import type { Pacer } from './pacer.js';
import type { View } from './ready.js';
import { type ReturnsRead, readReturns } from './returns.js';
import type { Selectors } from './selectors.js';
import { servedSequence } from './served.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

/**
 * The return phase (spec revision 56 §2 "The return phase", "A second outbound", "The booking read", "Statuses"; WP21
 * Task 21.3). After the outbound read of a flights request carrying `returnLimits`, on an entry whose
 * RETURN_SELECT_VERIFIED is set: core's one selection rule (`selectOutbound`) picks the outbound among every flight read
 * for the cell, its link is activated from the keyboard under the guard's activation gate (R-worst: no document loads
 * while it settles), the view is polled until it has changed and settled, the return reader reads the returns, and,
 * when none fits and a further outbound does, the list page is loaded again (the one spaced document: the pacer
 * re-claimed first) and the served sequence run again before the next outbound is selected. Then, behind
 * BOOKING_SELECT_VERIFIED and when the request asks for it, core's `bookingReturnOf` picks the return on the view the
 * phase stands on, its link is activated the same way, the booking view's offers are read, its one "more booking
 * options" control is activated and every offer read again. No offer, grouped control or anything else on the booking
 * view is ever activated. After every activation and every poll the guard's refusal is read before classifying
 * (R-refused). Every deadline end inside the phase (`timedOut`) is a transient status, never rethrown; a genuine block is the
 * page's stop; any other error a step meets (the browser's own: a closed target, a destroyed context, an unwritable
 * pacer record) ends that step with its transient status and the rule `<step>:browser-error` (final review A-M1), so
 * the outbound read and every return read before it are kept. Only session.ts imports this module (rules.test.ts pins that); it is the only importer of returns.ts and
 * offers.ts.
 */
export interface ReturnPhaseInput {
  driver: Driver;
  guard: GuardState;
  budget: PageBudget;
  pacer: Pick<Pacer, 'reclaim' | 'spacingMs'>;
  /** The worker's own list URL for the request (loaded again for a second outbound). */
  url: string;
  req: FlightsRequest & { returnLimits: FlightLimits };
  /** The outbound read the session made (every flight read for the cell, with its name); null: Google's no-flights line. */
  outbound: FlightsRead | null;
  /** The view the outbound read stood on (R-view: the phase runs from the Cheapest view only). */
  view: 'cheapest' | 'best-fallback' | null;
  S: Selectors;
  timers: Timers;
  log: Logger;
  pollMs: number;
  /** timers.now() when the page started. */
  startedAt: number;
  /** The pages the month admitted for this request (R-reserve: the phase runs only with the whole worst case). */
  admitted: number;
  /** CAMOUFOX_PAGE_TIMEOUT_SECONDS in ms: every step's own budget. */
  pageTimeoutMs: number;
}

/** The phase's end: the return read and the answer's flights (the ≤ 30 with every pick kept), or the page's stop. */
export type ReturnPhaseResult =
  | {
      returns: ReturnRead;
      flights: ListedFlight[];
      /** The offer grammar's date when the offer reader ran (the answer then states `versions.offerGrammar`), else null. */
      offerGrammar: string | null;
    }
  | { stop: BlockedPage; rule: string };

/** A step's end other than a read: a transient status with its rule, or the page's stop. */
type StepEnd = { kind: 'end'; status: 'select-failed' | 'not-settled' | 'unrecognised'; rule: string } | Stop;
type Stop = { kind: 'stop'; page: BlockedPage; rule: string };

/** One read attempt: the outbound (by its index among every flight read), its returns and their names. */
interface Attempt {
  parsedIndex: number;
  fits: boolean;
  read: ReturnsRead;
}

/**
 * Whether `e` ended its step at the deadline (review I1): DeadlineExceeded, or any error that reached the phase once the
 * budget's current deadline had expired (the browser's own timeout firing with it, or a call the page's close at expiry
 * rejected), as served.ts and the session read the deadline's end. Such an end is the step's transient one, never
 * rethrown (spec rev 56 §2: the phase never answers `not-ready`).
 */
function timedOut(e: unknown, budget: Pick<PageBudget, 'd'>): boolean {
  return e instanceof DeadlineExceeded || budget.d.expired();
}

/**
 * Final review A-M1: runs one step of the phase; an error the step did not end itself (neither the deadline's end nor
 * a refusal, which every step reads where it can happen) is the guard's refusal when one was recorded, else the step's
 * `unrecognised` end with the rule `<flow>:browser-error` (a bounded token; the error's text is logged only).
 */
async function guarded<T>(
  p: Pick<ReturnPhaseInput, 'guard' | 'log'>,
  flow: string,
  run: () => Promise<T | StepEnd>,
  // why: the expansion's failure keeps the offers read before it (A10), which its caller reads from a status other
  // than `unrecognised`; every other step ends `unrecognised`
  status: 'unrecognised' | 'not-settled' = 'unrecognised',
): Promise<T | StepEnd> {
  try {
    return await run();
  } catch (e) {
    const refused = refusalOf(p.guard);
    if (refused !== null) return refused;
    p.log.warn(
      { flow, error: stripUrlsInText(e instanceof Error ? e.message : String(e)).slice(0, 200) },
      'return phase step failed in the browser',
    );
    return { kind: 'end', status, rule: `${flow}:browser-error` };
  }
}

/** A booking read with nothing selected, of a status that names no pairing. */
function bookingOf(status: BookingRead['status'], rule: string | null): BookingRead {
  return {
    status,
    rule,
    attempt: null,
    returnIndex: null,
    expanded: false,
    moreControl: false,
    grouped: 0,
    offers: [],
    unparsed: 0,
    nonGbp: 0,
    offersStated: null,
  };
}

/**
 * The guard's refusal, read before any classification (R-refused): a refusal to the consent or sign-in host is the
 * page's stop; any other refusal (off the allowlist) or a held navigation (the gate, the reservation) ends the step
 * `unrecognised` with its rule, never a cool-down, since nothing loaded. Null when the guard refused nothing.
 */
export function refusalOf(g: Pick<GuardState, 'refused' | 'held'>): StepEnd | null {
  const r = g.refused;
  if (r === 'consent-unhandled' || r === 'sign-in')
    return { kind: 'stop', page: r, rule: `guard-refused:${r}` };
  if (r !== null) return { kind: 'end', status: 'unrecognised', rule: `guard-refused:${r}` };
  if (g.held !== null) return { kind: 'end', status: 'unrecognised', rule: g.held };
  return null;
}

/**
 * The answer's flights with every pick kept (spec rev 56 §5.1, preflight P10/A11): the outbound read's kept flights
 * (the 30 cheapest), each pick outside them replacing the dearest kept flight that is no pick (ties: the later in page
 * order), all in page order; and each pick's index into them.
 */
export function flightsWithPicks(
  parsed: ReadonlyArray<{ flight: ListedFlight }>,
  kept: readonly ListedFlight[],
  picks: readonly number[],
): { flights: ListedFlight[]; indexOf: (parsedIndex: number) => number } {
  // why: the reader's kept flights are the very objects of `parsed` (flights.ts), so identity finds their positions
  const set = new Set(parsed.flatMap((p, i) => (kept.includes(p.flight) ? [i] : [])));
  const price = (i: number): number => parsed[i]?.flight.amountMinor ?? 0;
  for (const p of picks) {
    if (set.has(p)) continue;
    if (set.size >= FLIGHT_LIST_MAX_FLIGHTS) {
      let drop = -1;
      for (const k of set)
        if (
          !picks.includes(k) &&
          (drop < 0 || price(k) > price(drop) || (price(k) === price(drop) && k > drop))
        )
          drop = k;
      set.delete(drop);
    }
    set.add(p);
  }
  const order = [...set].sort((a, b) => a - b);
  return {
    flights: order.flatMap((i) => {
      const f = parsed[i]?.flight;
      return f === undefined ? [] : [f];
    }),
    indexOf: (i) => order.indexOf(i),
  };
}

/** Runs the whole return phase (see the module's comment). */
export async function returnPhase(p: ReturnPhaseInput): Promise<ReturnPhaseResult> {
  const { guard, req, outbound, S, timers, log } = p;
  const limits = req.returnLimits;
  const booking = req.booking === true;
  const parsed = outbound?.parsed ?? [];
  const kept = outbound?.flights ?? [];
  const tried: number[] = [];
  const attempts: Attempt[] = [];
  let offerGrammar: string | null = null;

  /**
   * The outbounds of the attempts made (review M4): only these are placed among the 30 and count as tried; `tried`
   * also holds a selection that failed, so the next selection never picks it again.
   */
  const picked = (): number[] => attempts.map((a) => a.parsedIndex);
  /** The answer: the attempts' outbounds placed in the flights, the rule and the booking given. */
  const done = (
    status: ReturnStatus,
    rule: string | null,
    bookingRead: BookingRead | null,
  ): ReturnPhaseResult => {
    const made = picked();
    const { flights, indexOf } = flightsWithPicks(parsed, kept, made);
    const out: ReturnAttempt[] = attempts.map((a) => ({
      outboundIndex: indexOf(a.parsedIndex),
      outboundFits: a.fits,
      listed: a.read.listed,
      moreListed: a.read.moreListed,
      returns: a.read.returns,
      optionsUnparsed: a.read.optionsUnparsed,
      optionsOtherCell: a.read.optionsOtherCell,
      resultsStated: a.read.resultsStated,
    }));
    // why: "no further outbound within the limits remained untried", over every flight read for the cell; an outbound
    // whose selection failed was not tried (review M4: triedAll follows the attempts made)
    const triedAll = !parsed.some((x, i) => !made.includes(i) && fitsLimits(x.flight, limits, 'outbound'));
    return {
      returns: { limits, status, rule, attempts: out, triedAll, booking: bookingRead },
      flights: attempts.length === 0 ? kept : flights,
      offerGrammar,
    };
  };
  /** A phase that made no attempt: the return status and, when one was asked, the booking with the same rule. */
  const none = (status: ReturnStatus, rule: string | null, bookingStatus: BookingRead['status']) =>
    done(status, rule, booking ? bookingOf(bookingStatus, rule) : null);
  const steps = (flow: string): StepOptions => ({ timers, log, startedAt: p.startedAt, flow });

  // R-refused: a navigation the guard refused or held during the outbound read is read first
  const before = refusalOf(guard);
  if (before?.kind === 'stop') return { stop: before.page, rule: before.rule };
  if (before !== null) return none(before.status, before.rule, 'skipped');
  // the outbound page listed no flight for the pair (Google's line, or every option another cell's): nothing activated
  if (outbound === null || outbound.listed !== 'flights' || parsed.length === 0)
    return none('no-outbound', null, 'no-pairing');
  // R-view: the recorded sequence runs from the Cheapest view only; a Best fallback runs no phase
  if (p.view !== 'cheapest') return none('skipped', 'not-cheapest-view', 'skipped');
  // R-reserve, P3: with fewer pages left than the worst case the request is an outbound-only read of one page
  if (p.admitted < FLIGHT_LIST_PAGES_PER_PAIR_MAX) return none('skipped', 'monthly-headroom', 'skipped');

  const flightsOf = parsed.map((x) => x.flight);
  const first = selectOutbound(flightsOf, limits);
  const a0 = await guarded(p, 'select-outbound', () => selectAndRead(p, first.index, first.fits, steps));
  if (a0.kind === 'stop') return { stop: a0.page, rule: a0.rule };
  tried.push(first.index);
  if (a0.kind === 'end') return none(a0.status, a0.rule, 'skipped');
  attempts.push(a0.attempt);

  // the second attempt (Ian's ruling 2): no return of the first fits, and a further outbound does
  let rule: string | null = null;
  let bookingSkip: string | null = null;
  const anyFits = a0.attempt.read.returns.some((r) => fitsLimits(r, limits, 'return'));
  // why: selectOutbound has nothing to select once every flight read was tried (it throws on an empty choice)
  const next =
    !anyFits && first.fits && tried.length < flightsOf.length
      ? selectOutbound(flightsOf, limits, new Set(tried))
      : null;
  if (next?.fits === true) {
    const reload = await guarded(p, 'reload', () => reloadList(p));
    if (reload.kind === 'stop') return { stop: reload.page, rule: reload.rule };
    if (reload.kind === 'end') {
      rule = reload.rule;
      // why: only the spacing end leaves the phase on attempt 0's view; a reload that began stands on no return view
      if (reload.rule !== 'spacing') bookingSkip = reload.rule;
    } else {
      const a1 = await guarded(p, 'select-outbound', () => selectAndRead(p, next.index, next.fits, steps));
      if (a1.kind === 'stop') return { stop: a1.page, rule: a1.rule };
      tried.push(next.index);
      if (a1.kind === 'end') {
        rule = a1.rule;
        // why: ruling A13: the phase stands on no return view after a failed second selection
        bookingSkip = 'second-selection';
      } else attempts.push(a1.attempt);
    }
  }

  if (!booking) return done('read', rule, null);
  if (!S.BOOKING_SELECT_VERIFIED) return done('read', rule, bookingOf('not-verified', null));
  if (bookingSkip !== null) return done('read', rule, bookingOf('skipped', bookingSkip));
  // R-pick: core's one return-pick rule over the attempts so far, restricted to the last (the view the phase stands on)
  const { flights } = flightsWithPicks(parsed, kept, picked());
  const placed = done('read', rule, null);
  if (!('returns' in placed)) return placed;
  const pick = bookingReturnOf(placed.returns, flights);
  const last = attempts.at(-1);
  const name = pick === null ? undefined : last?.read.names[pick.returnIndex];
  if (pick === null || name === undefined) return done('read', rule, bookingOf('no-pairing', null));
  const b = await readBooking(p, name, pick, steps);
  if ('stop' in b) return { stop: b.stop, rule: b.rule };
  offerGrammar = b.offerGrammar ? OFFER_GRAMMAR_VERSION : null;
  return done('read', rule, b.read);
}

/** The step's options factory: its flow names the step lines. */
type Steps = (flow: string) => StepOptions;

/**
 * One activation and the view after it, under a fresh page period: the view before read by `view`'s pattern (the
 * signature the polls compare: preflight P5), the gate on from the activation until the poll ends, the guard's refusal
 * read before classifying after the activation and every poll, a never-changed view told from an unsettled one.
 */
async function activate(
  p: ReturnPhaseInput,
  d: Deadline,
  flow: string,
  view: View,
  steps: Steps,
  press: (o: StepOptions) => Promise<string[]>,
): Promise<{ kind: 'settled'; settled: Settled } | StepEnd> {
  const { driver, guard, S, timers, log, pollMs } = p;
  const notSettled = (step: string): StepEnd => ({
    kind: 'end',
    status: 'not-settled',
    rule: `${flow}:${step}`,
  });
  let pre: Awaited<ReturnType<Driver['readFacts']>>;
  try {
    pre = await driver.readFacts(d, undefined, view);
  } catch (e) {
    if (timedOut(e, p.budget)) return notSettled('pre-read');
    throw e;
  }
  const loads = guard.documentLoads;
  const o = steps(flow);
  const track = { changed: false };
  // why: R-worst: from the activation until its view settles, no main-frame document may load
  guard.activationGate = true;
  try {
    try {
      await press(o);
    } catch (e) {
      if (timedOut(e, p.budget)) return refusalOf(guard) ?? notSettled('activate');
      if (!(e instanceof StepFailed)) throw e;
      guard.activationGate = false;
      const refused = refusalOf(guard);
      if (refused !== null) return refused;
      // why: a failed step may have left a page that is no results page at all: classified once, a block is the stop
      const blocked = await classifyAfterFailedStep(driver, d, o, S, view).catch((err: unknown) => {
        if (timedOut(err, p.budget)) return null;
        throw err;
      });
      if (blocked !== null) return { kind: 'stop', page: blocked.page, rule: blocked.rule };
      return { kind: 'end', status: 'select-failed', rule: `${flow}:${e.step}` };
    }
    let settled: Settled;
    try {
      settled = await pollUntilSettled(driver, d, timers, pollMs, S, {
        view,
        log,
        startedAt: p.startedAt,
        // why: review M1: on the booking view the URL's path moving is the return selection's change
        changedFrom: {
          signature: pre.settle.linkSignature,
          documentLoads: loads,
          ...pathField(pre.page.url),
        },
        loads: () => guard.documentLoads,
        stopWhen: () => guard.refused !== null || guard.held !== null,
        track,
      });
    } catch (e) {
      if (e instanceof PollStopped || timedOut(e, p.budget)) {
        const refused = refusalOf(guard);
        if (refused !== null) return refused;
        if (e instanceof PollStopped) throw new Error('a poll stopped with no refusal');
        // why: a view that never changed is an activation that did nothing; a changed one that never settled is that
        return notSettled(track.changed ? 'not-settled' : 'no-activation');
      }
      throw e;
    }
    guard.activationGate = false;
    const refused = refusalOf(guard);
    if (refused !== null) return refused;
    if (settled.kind.kind === 'blocked' && settled.kind.page !== 'unrecognised')
      return { kind: 'stop', page: settled.kind.page, rule: settled.rule };
    if (settled.kind.kind !== 'results') return { kind: 'end', status: 'unrecognised', rule: settled.rule };
    return { kind: 'settled', settled };
  } finally {
    guard.activationGate = false;
  }
}

/** The outbound's selection and its return view read (one attempt), under its own page period. */
async function selectAndRead(
  p: ReturnPhaseInput,
  parsedIndex: number,
  fits: boolean,
  steps: Steps,
): Promise<{ kind: 'read'; attempt: Attempt } | StepEnd> {
  const name = p.outbound?.parsed[parsedIndex]?.name;
  if (name === undefined) throw new RangeError(`no outbound ${parsedIndex} read`);
  const d = p.budget.nextFor(p.pageTimeoutMs);
  const flow = 'select-outbound';
  const a = await activate(p, d, flow, 'returns', steps, (o) => p.driver.clickOutbound(name, d, o));
  if (a.kind !== 'settled') return a;
  let read: ReturnsRead;
  try {
    read = readReturns(await p.driver.listFacts(d, 'returns'), p.req);
  } catch (e) {
    if (timedOut(e, p.budget)) return { kind: 'end', status: 'not-settled', rule: `${flow}:list-facts` };
    throw e;
  }
  const refused = refusalOf(p.guard);
  if (refused !== null) return refused;
  // why: decision 69: a view in another currency is not one this app reads (as the list readers end a page)
  if (read.currency !== 'GBP') return { kind: 'end', status: 'unrecognised', rule: 'currency' };
  return { kind: 'read', attempt: { parsedIndex, fits, read } };
}

/**
 * The second outbound's fresh load (spec rev 56 §2 "A second outbound"): the spacing waited out under its own budget
 * (the pacer re-claimed: the one spaced step), the worker's own list URL loaded again under a page period, and the served
 * sequence run on it with a full page period of its own for the Cheapest flow (prov-int-r3-004). Any end other than a
 * settled Cheapest view with flights read is `reload:<end>`; only a genuine block is the page's stop.
 */
async function reloadList(
  p: ReturnPhaseInput,
): Promise<{ kind: 'loaded' } | { kind: 'end'; rule: string } | Stop> {
  const { driver, guard, budget, timers } = p;
  const end = (rule: string) => ({ kind: 'end' as const, rule });
  try {
    await p.pacer.reclaim(budget.nextFor(p.pacer.spacingMs), timers);
  } catch (e) {
    if (timedOut(e, budget)) return end('spacing');
    throw e;
  }
  const d = budget.nextFor(p.pageTimeoutMs);
  const refusedEnd = (): { kind: 'end'; rule: string } | Stop | null => {
    const r = refusalOf(guard);
    if (r === null) return null;
    return r.kind === 'stop' ? r : end(`reload:${r.rule}`);
  };
  try {
    try {
      await driver.goto(p.url, d);
    } catch (e) {
      // why: review I1: a load the guard refused names its refusal; one the deadline ended is not-settled; any other
      // failure (a network error, the browser's own error) is the load's own end, never the page's
      const r = refusedEnd();
      if (r !== null) return r;
      return end(timedOut(e, budget) ? 'reload:not-settled' : 'reload:goto');
    }
    const served = await servedSequence(
      { driver, S: p.S, timers, log: p.log, pollMs: p.pollMs, startedAt: p.startedAt, request: p.req },
      d,
      () => budget.nextFor(p.pageTimeoutMs),
    );
    const r = refusedEnd();
    if (r !== null) return r;
    if (served.kind === 'stop')
      return served.page === 'unrecognised'
        ? end(`reload:${served.rule}`)
        : { kind: 'stop', page: served.page, rule: served.rule };
    if (served.kind === 'no-flights') return end('reload:no-flights');
    if (served.view !== 'cheapest') return end(`reload:${served.view ?? 'no-cheapest-flow'}`);
    const list = readFlights(await driver.listFacts(served.d), p.req);
    if (list.currency !== 'GBP') return end('reload:currency');
    if (list.listed !== 'flights') return end('reload:no-options-read');
    return { kind: 'loaded' };
  } catch (e) {
    if (timedOut(e, budget)) return refusedEnd() ?? end('reload:not-settled');
    throw e;
  }
}

/**
 * The booking read (spec rev 56 §2): the picked return's activation, the booking view settled and recognised, its
 * offers read, then (one "more booking options" control) the expansion's activation and every offer read again. Two or
 * more controls end `unrecognised` (`more-options-count`) with nothing pressed and no offer kept (A9); an expansion that
 * fails or does not settle keeps the offers read before it (`expand-failed`, A10); an offer in another currency ends it
 * `unrecognised` (`currency`).
 */
async function readBooking(
  p: ReturnPhaseInput,
  name: string,
  pick: { attempt: number; returnIndex: number },
  steps: Steps,
): Promise<{ read: BookingRead; offerGrammar: boolean } | { stop: BlockedPage; rule: string }> {
  const { driver, budget } = p;
  const selected = (
    status: BookingRead['status'],
    rule: string | null,
    o: Partial<OffersRead> & { expanded?: boolean } = {},
  ): BookingRead => ({
    status,
    rule,
    attempt: pick.attempt,
    returnIndex: pick.returnIndex,
    expanded: o.expanded ?? false,
    moreControl: o.moreControl ?? false,
    grouped: o.grouped ?? 0,
    offers: o.offers ?? [],
    unparsed: o.unparsed ?? 0,
    nonGbp: o.nonGbp ?? 0,
    offersStated: o.offersStated ?? null,
  });
  const ended = (e: StepEnd, read: boolean) =>
    e.kind === 'stop'
      ? { stop: e.page, rule: e.rule }
      : { read: selected(e.status, e.rule), offerGrammar: read };
  const d = budget.nextFor(p.pageTimeoutMs);
  // why: final review A-M1: the browser's own error in the return's selection or the booking view's read ends the
  // booking `unrecognised` (select-return:browser-error), the returns read before it kept
  const viewed = await guarded(p, 'select-return', async () => {
    const a = await activate(p, d, 'select-return', 'booking', steps, (o) => driver.clickReturn(name, d, o));
    if (a.kind !== 'settled') return a;
    try {
      return { kind: 'facts' as const, facts: await driver.bookingFacts(d) };
    } catch (e) {
      if (timedOut(e, budget))
        return { kind: 'end' as const, status: 'not-settled' as const, rule: 'select-return:booking-facts' };
      throw e;
    }
  });
  if (viewed.kind !== 'facts') return ended(viewed, false);
  const facts = viewed.facts;
  // why: review M3: a navigation refused between the settle and this read ends it, as after listFacts (R-refused)
  const r0 = refusalOf(p.guard);
  if (r0 !== null) return ended(r0, true);
  /**
   * An `unrecognised` end over a view read (review M2): no offer kept (A9, the contract: offers only on read and
   * expand-failed), but the counts that view showed (refused, other currencies, grouped, the control) as read.
   */
  const unrecognised = (rule: string, o: OffersRead, expanded: boolean): BookingRead =>
    selected('unrecognised', rule, { ...o, offers: [], offersStated: null, expanded });
  const first = readOffers(facts);
  if (!first.allGbp) return { read: unrecognised('currency', first, false), offerGrammar: true };
  if (facts.moreOptions >= 2)
    return { read: unrecognised('more-options-count', first, false), offerGrammar: true };
  const finished = (o: OffersRead, expanded: boolean): BookingRead =>
    // why: a view whose every offer the grammar refused read none: no `read` booking without an offer
    o.offers.length === 0
      ? unrecognised('no-offers-read', o, expanded)
      : selected('read', null, { ...o, expanded });
  if (facts.moreOptions === 0) return { read: finished(first, false), offerGrammar: true };
  // the expansion: kept offers on its failure are the ones read before it (A10)
  const failed = (rule: string): BookingRead =>
    first.offers.length === 0
      ? unrecognised('no-offers-read', first, false)
      : selected('expand-failed', rule, { ...first, expanded: false });
  const d2 = budget.nextFor(p.pageTimeoutMs);
  const flow = 'select-more-options';
  // why: final review A-M1: the browser's own error in the expansion or the read after it is the expansion's failure
  // (expand-failed, select-more-options:browser-error), the offers read before it kept (A10)
  const x = await guarded(
    p,
    flow,
    async () => {
      const act = await activate(p, d2, flow, 'booking', steps, (o) => driver.clickMoreOptions(d2, o));
      if (act.kind !== 'settled') return act;
      try {
        return { kind: 'offers' as const, after: readOffers(await driver.bookingFacts(d2)) };
      } catch (e) {
        if (timedOut(e, budget))
          return { kind: 'end' as const, status: 'not-settled' as const, rule: `${flow}:booking-facts` };
        throw e;
      }
    },
    'not-settled',
  );
  if (x.kind === 'stop') return { stop: x.page, rule: x.rule };
  if (x.kind === 'end')
    return x.status === 'unrecognised'
      ? { read: unrecognised(x.rule, first, false), offerGrammar: true }
      : { read: failed(x.rule), offerGrammar: true };
  const after = x.after;
  const r1 = refusalOf(p.guard);
  if (r1 !== null) return ended(r1, true);
  if (!after.allGbp) return { read: unrecognised('currency', after, true), offerGrammar: true };
  return { read: finished(after, true), offerGrammar: true };
}

/**
 * Spec rev 56 §2: the return read of a request carrying `returnLimits` on an entry whose RETURN_SELECT_VERIFIED is
 * false: nothing activated, `not-verified` (the booking too, when one was asked), the outbound read as it stands.
 */
export function unverifiedReturns(
  req: FlightsRequest & { returnLimits: FlightLimits },
  outbound: FlightsRead | null,
): ReturnRead {
  return {
    limits: req.returnLimits,
    status: 'not-verified',
    rule: null,
    attempts: [],
    triedAll: !(outbound?.parsed ?? []).some((x) => fitsLimits(x.flight, req.returnLimits, 'outbound')),
    booking: req.booking === true ? bookingOf('not-verified', null) : null,
  };
}
