import {
  type BookingRead,
  bookingReturnOf,
  cheapestOffer,
  cheapestPairing,
  chooseReturnsToShow,
  compareReturns,
  type FlightLimits,
  fitsLimits,
  type ListedFlight,
  type ListedReturn,
  offersComplete,
  RETURNS_SHOWN,
  type ReturnRead,
  type ShownFlights,
  sameFlightLimits,
  selectOutbound,
} from '@gmt/core';
import type { FlightList } from '../../api/types.js';
import type { COPY } from '../../copy.js';

// Spec rev 56 §6.9 "Flight lists and the date pair's figure" and §11 "Flights" (WP21 Task 21.7): the pure side of a
// search's pairing section. Which pairing a list read and what its booking read kept (core's one rule set, as the api
// applies it: `cheapestPairing`, `bookingReturnOf`, `cheapestOffer`, `offersComplete`), whether it was selected under
// today's limits, and every note the section says, composed from COPY templates passed in. Amounts are never formatted
// here: each is a PriceCell beside these words (ruling C3).

type FlightCopy = (typeof COPY)['flights'];

/** The cheapest offer a booking read kept for the pairing (spec rev 56 §6.9): its seller, fare and stated price. */
export interface PairingOffer {
  seller: string;
  fare: string | null;
  priceMinor: number;
  /** offers the booking read kept ("cheapest of N offers read") */
  offersRead: number;
  /** `offersComplete`: no cheaper seller can have been left unread; else "a cheaper seller may not have been read" */
  complete: boolean;
}

/** A list's pairing as the section shows it (spec rev 56 §11 "The pairing section"). */
export interface PairingView {
  /** the attempt (into `returns.attempts`) and the return (into that attempt's returns) */
  attempt: number;
  returnIndex: number;
  /** which outbound the pairing used: the first selected (`cheapest`) or the second (`next-cheapest`) */
  which: 'cheapest' | 'next-cheapest';
  /** the attempt's outbound met every limit when selected (false only when none of the outbounds read did) */
  outboundFits: boolean;
  outboundIndex: number;
  outbound: ListedFlight;
  ret: ListedReturn;
  /** the return's "from" price: the lowest round-trip price Google listed for this outbound and this return */
  fromMinor: number;
  /** the returns shown, the pairing's first, then the chooser's order (at most RETURNS_SHOWN) */
  returns: ShownFlights<ListedReturn>;
  /** its outbound and its return both fit today's limits */
  fits: boolean;
  /** the outbounds today's limits select are the ones the read selected (`selectOutbound`, the one rule) */
  selectedNow: boolean;
  /** the limits the read was made under deep-equal today's (`sameFlightLimits`) */
  underCurrentLimits: boolean;
  /** the cheapest offer of the booking read of this pairing, or null when none kept offers for it */
  offer: PairingOffer | null;
}

/**
 * Whether today's limits select the outbounds the read selected (spec rev 56 §11: "the outbound the limits would
 * select today is another"): the first pick, and the second pick when the read made one (the worker's choice of the
 * second outbound depends on the first's returns, so a read is "as selected today" only when both picks are).
 */
function selectedUnder(list: FlightList, r: ReturnRead, limits: FlightLimits): boolean {
  const [first, second] = r.attempts;
  // why: a read status has at least one attempt (the contract), so this is a caller's bug, never a page's
  if (first === undefined) return false;
  if (selectOutbound(list.flights, limits).index !== first.outboundIndex) return false;
  if (second === undefined) return true;
  // why: the second outbound is selected exactly as the worker selected it: the same rule with the first one skipped
  const skip = new Set([first.outboundIndex]);
  return list.flights.length > 1 && selectOutbound(list.flights, limits, skip).index === second.outboundIndex;
}

/**
 * The cheapest offer a booking read kept for the pairing, or null (spec rev 56 §6.9, as the api's `candidateOf`): its
 * offers count only when the booking names `bookingReturnOf`'s pairing (the one return-pick rule the worker books) and
 * that is the pairing shown, so a seller's price is never shown for flights it was not read for. Ruling A8: an
 * `expand-failed` booking keeps the offers read before the expansion (`cheapestOffer` reads them).
 */
function offerOf(list: FlightList, r: ReturnRead, attempt: number, returnIndex: number): PairingOffer | null {
  const b = r.booking;
  const booked = bookingReturnOf(r, list.flights);
  if (b === null || booked === null) return null;
  if (b.attempt !== booked.attempt || b.returnIndex !== booked.returnIndex) return null;
  if (b.attempt !== attempt || b.returnIndex !== returnIndex) return null;
  const cheapest = cheapestOffer(b);
  if (cheapest === null) return null;
  const ret = r.attempts[attempt]?.returns[returnIndex];
  return {
    seller: cheapest.offer.seller,
    fare: cheapest.offer.fare,
    priceMinor: cheapest.offer.priceMinor,
    offersRead: b.offers.length,
    complete: ret !== undefined && offersComplete(b, ret.fromMinor),
  };
}

/**
 * The returns the section shows (spec rev 56 §11): the pairing's return first (its "Back:" line), then the others in
 * `chooseReturnsToShow` order, up to RETURNS_SHOWN; "N more returns read, M outside your limits" counts the rest.
 */
function shownReturns(
  returns: readonly ListedReturn[],
  ret: ListedReturn,
  limits: FlightLimits,
): ShownFlights<ListedReturn> {
  const chosen = chooseReturnsToShow(returns, limits);
  // why: the pairing is judged on both legs and the chooser on the return alone, so with an outbound over the limits the
  // two can differ; the shown pairing always leads, and the chooser's order follows it
  const shown = [ret, ...chosen.shown.filter((x) => x !== ret)].slice(0, RETURNS_SHOWN);
  const rest = returns.filter((x) => !shown.includes(x));
  return {
    shown,
    overLimit: chosen.overLimit,
    moreRead: rest.length,
    moreOutside: rest.filter((x) => !fitsLimits(x, limits, 'return')).length,
  };
}

/**
 * Spec rev 56 §6.9 "Which pairing", §11: a read list's pairing under today's limits (`cheapestPairing` over every
 * attempt's returns), with its outbound and return, the returns to show, whether the read was selected and made under
 * today's limits, and the cheapest offer read for it; null for a list that is not read, has no return read, a return
 * status other than `read`, or no return listed on any attempt.
 */
export function pairingOf(list: FlightList, limits: FlightLimits): PairingView | null {
  const r = list.returns;
  if (list.status !== 'read' || r === null || r.status !== 'read') return null;
  const p = cheapestPairing(r, list.flights, limits);
  if (p === null) return null;
  const attempt = r.attempts[p.attempt];
  const outbound = attempt === undefined ? undefined : list.flights[attempt.outboundIndex];
  const ret = attempt?.returns[p.returnIndex];
  // why: the contract refuses an index past the list's flights or an attempt's returns, so this is never reached
  if (attempt === undefined || outbound === undefined || ret === undefined) return null;
  return {
    attempt: p.attempt,
    returnIndex: p.returnIndex,
    which: p.attempt > 0 ? 'next-cheapest' : 'cheapest',
    outboundFits: attempt.outboundFits,
    outboundIndex: attempt.outboundIndex,
    outbound,
    ret,
    fromMinor: p.fromMinor,
    returns: shownReturns(attempt.returns, ret, limits),
    fits: p.outboundFits && p.returnFits,
    selectedNow: selectedUnder(list, r, limits),
    underCurrentLimits: sameFlightLimits(r.limits, limits),
    offer: offerOf(list, r, p.attempt, p.returnIndex),
  };
}

/**
 * Every return of the pairing's attempt for "show all return flights" (spec rev 56 §11): those shown first (the
 * pairing's return leading), then the rest in `compareReturns` order.
 */
export function allReturnsInOrder(
  returns: readonly ListedReturn[],
  p: Pick<PairingView, 'ret'>,
  limits: FlightLimits,
): ListedReturn[] {
  const shown = shownReturns(returns, p.ret, limits).shown;
  return [...shown, ...returns.filter((x) => !shown.includes(x)).sort(compareReturns)];
}

/**
 * The mismatch line's two figures (spec rev 56 §6.9: "the cheapest offer read is £1,195; Google's list showed from
 * £1,180"): the cheapest offer's stated price and the shown return's "from" price, when they differ; else null.
 */
export function mismatchOf(p: PairingView | null): { offerMinor: number; fromMinor: number } | null {
  if (p === null || p.offer === null || p.offer.priceMinor === p.fromMinor) return null;
  return { offerMinor: p.offer.priceMinor, fromMinor: p.fromMinor };
}

/** A skipped step's rule in words: the worker's known rule tokens, `reload:<end>` by its first word, else general. */
function skippedWords(rule: string | null, c: FlightCopy): string {
  const head = (rule ?? '').split(':')[0] ?? '';
  return Object.hasOwn(c.skippedRule, head) ? Reflect.get(c.skippedRule, head) : c.skippedOther;
}

/** The read clauses of a return read (spec rev 56 §11): the counts clause and the more-listed clause, of its last attempt. */
function readClauses(r: ReturnRead, c: FlightCopy): string[] {
  // why: the last attempt is the view the phase stands on (the booking read's and, but for an over-limit pick, the
  // shown pairing's)
  const a = r.attempts.at(-1);
  if (a === undefined) return [];
  const out: string[] = [];
  if (a.optionsUnparsed > 0 || a.optionsOtherCell > 0)
    out.push(c.returnCounts(a.optionsUnparsed, a.optionsOtherCell));
  // why: R-viewmore: the options read are the returns kept plus those this app could not read or were another cell's
  const read = a.returns.length + a.optionsUnparsed + a.optionsOtherCell;
  if (a.resultsStated !== null && a.resultsStated > read) out.push(c.moreListed(a.resultsStated, read));
  else if (a.moreListed) out.push(c.moreListedNoCount);
  return out;
}

/**
 * Spec rev 56 §11 "Status notes": what a list's return read says beyond its lines, with what happens next. A list read
 * without a return phase (or stored before them) says so (`returnsOld`); a transient end says it is tried again; a
 * skipped one its rule in words; `not-verified` where the recording session is; `no-outbound` nothing beyond the
 * outbound's own line; a `read` its counts and more-listed clauses, or null when clean.
 */
export function returnNote(list: FlightList, c: typeof COPY): string | null {
  const F = c.flights;
  const r = list.returns;
  if (r === null) return F.returnsOld;
  switch (r.status) {
    case 'read': {
      const clauses = readClauses(r, F);
      return clauses.length === 0 ? null : clauses.join(F.separator);
    }
    case 'no-outbound':
      return null;
    case 'not-verified':
      return F.returnNotVerified;
    case 'skipped':
      return F.returnSkipped(skippedWords(r.rule, F));
    case 'select-failed':
    case 'not-settled':
    case 'unrecognised':
      return F.returnTransient;
    default: {
      const unknownStatus: never = r.status;
      throw new RangeError(`returnNote: no status ${String(unknownStatus)}`);
    }
  }
}

/**
 * Spec rev 56 §11 "Status notes": what a booking read that did not finish says, with what happens next; null for a
 * `read` one and for a list with no booking read (none was asked: the "Back:" line then says "sellers not read").
 */
export function bookingNote(list: FlightList, c: typeof COPY): string | null {
  const F = c.flights;
  const b: BookingRead | null = list.returns?.booking ?? null;
  if (b === null) return null;
  switch (b.status) {
    case 'read':
      return null;
    case 'expand-failed':
      return F.bookingExpandFailed;
    case 'skipped':
      return F.bookingSkipped(skippedWords(b.rule, F));
    case 'not-verified':
      return F.bookingNotVerified;
    case 'no-pairing':
      return F.bookingNoPairing;
    case 'select-failed':
    case 'not-settled':
    case 'unrecognised':
      return F.bookingTransient;
    default: {
      const unknownStatus: never = b.status;
      throw new RangeError(`bookingNote: no status ${String(unknownStatus)}`);
    }
  }
}

/**
 * Whether a list's return read was read (spec rev 56 §11): then the outbound marks drop "; return not read" and the
 * limits line says the windows apply to the outbound.
 */
export function returnsWereRead(list: FlightList): boolean {
  return list.returns?.status === 'read';
}

/**
 * What a block's live region says when a pressed read lands (spec rev 56 §11): "Flights read for 14 → 24 Mar, 2 return
 * flights" when its returns were read (the last attempt's, the view the phase stands on), the status note's words for a
 * return read that did not finish, WP20's "Flights read for …" for a list with no return read (or no outbound), and
 * "Flights not read for …" for a failed list.
 */
export function readDoneWords(list: FlightList, dates: string, c: typeof COPY): string {
  const F = c.flights;
  if (list.status !== 'read') return F.readNotDone(dates);
  const r = list.returns;
  if (r === null) return F.readDone(dates);
  if (r.status === 'read') return F.readDoneReturns(dates, r.attempts.at(-1)?.returns.length ?? 0);
  return returnNote(list, c) ?? F.readDone(dates);
}
