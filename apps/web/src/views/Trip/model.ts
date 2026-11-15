import {
  addDays,
  asIsoDate,
  type BookingTarget,
  bookingTargetOf,
  daysBetween,
  type FlightLimits,
  fitsLimits,
  type IsoDate,
  type IsoDateTime,
  type ListedFlight,
  type ListedReturn,
  type PairingKind,
  type PriceLabelKind,
  type Provenance,
  pairingKindOf,
  pairingPrice,
  priceLabelKind,
  type StaleMark,
  withinLimits,
} from '@gmt/core';
import type { DefinitionResponse, FlightList, TripResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateShort, formatWeekday, londonParts } from '../../format.js';
import { rowBookingTarget, syntheticProvenance } from '../../lib/bookingTarget.js';
import { figureLabelKind, labelDetail } from '../../lib/figureLabel.js';
import { carriersText, hoursText } from '../../lib/flightLines.js';
import { type PairingView, pairingOf } from '../../lib/pairing.js';
import { instantMs } from '../../lib/time.js';
import type { CardState } from './cardState.js';

// Design 2026-11-08 §6.1 (trip-page plan Task 7): the pure side of the Trip page. Which trip the card shows, with its
// one label, its booking target and its two legs; the other flights read on these dates; the log's rows; whether
// anything in the read is synthetic. Every word is COPY's; amounts are never formatted here (each is a PriceCell).

type Figure = NonNullable<TripResponse['figure']>;

/**
 * A list page takes about 20–60 s plus the spacing between pages, which the engine's estimate takes as 40 s a page
 * (`packages/engine/src/estimate.ts`); the read's minutes are that, at least one. why: design §6.1 "~2 min" is an
 * estimate from the pages one read plans, not a measured time (no new progress reporting).
 */
const PAGE_SECONDS = 40;

/** The minutes one read by hand takes, about (`pagesPlanned` pages at PAGE_SECONDS each, at least 1). */
export function readMinutes(pagesPlanned: number): number {
  return Math.max(1, Math.round((pagesPlanned * PAGE_SECONDS) / 60));
}

/**
 * Whether any price the trip read carries is synthetic or the fixture provider's (spec §5.5): the figure and every
 * price beside it, the calendar and cached prices, the log's prices and the flight list. Then the page raises the red
 * banner and no price links out of the app. A price whose two tags disagree is withheld where it renders (PriceCell's
 * `assertProvenance`), never shown as real.
 */
export function tripSynthetic(r: TripResponse): boolean {
  const f = r.figure;
  const tags: Array<Pick<Provenance, 'providerId' | 'sourceKind'>> = [
    ...(f === null
      ? []
      : [
          f.price.provenance,
          ...(f.pairing === null ? [] : [f.pairing.provenance]),
          ...(f.gridPrice === null ? [] : [f.gridPrice.provenance]),
          ...(f.cheaperCached === null ? [] : [f.cheaperCached.provenance]),
        ]),
    ...(r.calendar === null ? [] : [r.calendar.provenance]),
    ...(r.cached === null ? [] : [r.cached.provenance]),
    ...r.log.flatMap((row) => [
      ...(row.calendar === null ? [] : [row.calendar.provenance]),
      ...(row.flights.kind === 'trip' ? [row.flights.price.provenance] : []),
    ]),
    ...(r.flightList === null ? [] : [r.flightList.provenance]),
  ];
  return tags.some(syntheticProvenance);
}

/** One leg of a trip as the card shows it: times and airports, the day it leaves, and what the list read of it. */
export interface Leg {
  departs: string;
  arrives: string;
  /** days from the leg's own date to its arrival (−1 to 3) */
  dayOffset: number;
  from: string;
  to: string;
  date: IsoDate;
  minutes: number | null;
  stops: number | null;
  carriers: string | null;
}

/** A price with its provenance and the wire's own stale mark and age. */
export interface Priced {
  pricePence: number;
  provenance: Provenance;
  stale: StaleMark;
  ageHours: number | 'unknown';
}

/** The trip a card shows: its price, its one label and the label's detail, its seller, its legs and where it links. */
export interface ShownTrip extends Priced {
  label: PriceLabelKind;
  detail: string;
  /** the seller and how many were read, for a seller's price; null for Google's price */
  seller: { name: string; offersRead: number } | null;
  /** the pairing's kind (whose price it is), null for a price that is not a pairing's */
  pairingKind: PairingKind | null;
  legs: { out: Leg; back: Leg } | null;
  /** a pairing whose list is not in hand says its two departure times only */
  times: { out: string; back: string } | null;
  target: BookingTarget;
}

function legOf(f: ListedFlight | ListedReturn, from: string, to: string, date: IsoDate): Leg {
  return {
    departs: f.departsLocal,
    arrives: f.arrivesLocal,
    dayOffset: f.arrivesDayOffset,
    from,
    to,
    date,
    minutes: f.durationMinutes,
    stops: f.stops,
    carriers: carriersText(f, COPY.flights),
  };
}

/** A pairing's two legs from its list: the outbound from the departure date, the return from the return date. */
function pairingLegs(r: TripResponse, list: FlightList, p: PairingView): { out: Leg; back: Leg } {
  return {
    out: legOf(p.outbound, list.origin, list.destination, r.departureDate),
    back: legOf(p.ret, list.destination, list.origin, r.returnDate),
  };
}

/** A verified figure's local times ("2027-03-14T18:30") as two legs; the list's durations and airlines aren't known. */
function verifiedLegs(f: Figure): { out: Leg; back: Leg } | null {
  const part = (local: string | null) => {
    const [date, time] = local?.split('T') ?? [];
    return date === undefined || time === undefined ? null : { date: asIsoDate(date), time };
  };
  const [dOut, aOut, dBack, aBack] = [
    part(f.departOut),
    part(f.arriveOut),
    part(f.departBack),
    part(f.arriveBack),
  ];
  if (dOut === null || aOut === null || dBack === null || aBack === null) return null;
  const leg = (d: typeof dOut, a: typeof aOut, from: string, to: string): Leg => ({
    departs: d.time,
    arrives: a.time,
    dayOffset: daysBetween(d.date, a.date),
    from,
    to,
    date: d.date,
    minutes: null,
    stops: null,
    carriers: null,
  });
  return {
    out: leg(dOut, aOut, f.origin, f.destination),
    back: leg(dBack, aBack, f.destination, f.origin),
  };
}

/**
 * The pairing the list's own rule picks, and only when it is the figure's: read for the figure's airport pair, its two
 * departure times agreeing.
 */
function listPairing(
  r: TripResponse,
  figure: { origin: string; destination: string; departOut: string; departBack: string } | null,
): { list: FlightList; p: PairingView } | null {
  const list = r.flightList;
  if (list === null) return null;
  // why: CodeRabbit PR #58 finding 14: a list of another airport pair never lends its airports, airlines, durations or
  // booking to the figure's price, whatever its times
  if (figure !== null && (list.origin !== figure.origin || list.destination !== figure.destination))
    return null;
  const p = pairingOf(list, r.limits);
  if (p === null) return null;
  // why: the card follows the board's figure; a list whose pick differs (a limit edit since) gives no legs, never another
  if (
    figure !== null &&
    (p.outbound.departsLocal !== figure.departOut || p.ret.departsLocal !== figure.departBack)
  )
    return null;
  return { list, p };
}

/**
 * The trip the card shows for its state, or null where it shows none: a pairing figure's own (`trip`); the pairing beneath
 * a calendar figure (`calendar-with-trip`); a verified figure's (`verified`; one not seen again is `gone`, no trip); the list
 * read by hand where there is no figure (`read-without-calendar`, Ruling 3). Its booking target is core's one rule:
 * nothing out of the app for a synthetic read; a verified price's own seller booking; a pairing's booking page
 * (Ruling 5: the pairing's own address); else the Google Flights search for the dates. Where the card shows the
 * figure's own trip (a verified or a pairing figure), the target is the one every other surface links for that figure
 * (`rowBookingTarget`, Ruling 2), with the verified figure's own booking; `cabin` is the search's.
 */
export function shownTripOf(
  r: TripResponse,
  state: CardState,
  isSynthetic: boolean,
  cabin: DefinitionResponse['cabin'],
): ShownTrip | null {
  const f = r.figure;
  // why: Ruling 2: the figure's own trip links what its row, its card and its day panel link; a synthetic read links
  // nowhere, whichever of its prices is synthetic
  const figureTarget = (figure: Figure, booking: TripResponse['booking']): BookingTarget =>
    isSynthetic
      ? { kind: 'none' }
      : rowBookingTarget(
          { departureDate: r.departureDate, returnDate: r.returnDate },
          figure,
          cabin,
          booking,
          r.pointOfSale,
        );
  // why: a trip that is not the figure's (the pairing beneath a calendar figure, a list read by hand) links its own
  // booking page, else the search for the list's cell
  const target = (bookingUrl: string | null) =>
    bookingTargetOf({ synthetic: isSynthetic, booking: null, bookingUrl, searchLink: r.searchLink });
  if (state.kind === 'verified' && f !== null && f.basis === 'verified') {
    const label = figureLabelKind(f);
    return {
      ...f.price,
      label,
      detail: labelDetail(label, null),
      seller: null,
      pairingKind: null,
      legs: verifiedLegs(f),
      times: null,
      // why: a verified price's own booking, else its own airports' search (final review I2); the list's booking page
      // and search are the calendar cell's, another pairing's and maybe another airport pair's (Ruling 5)
      target: figureTarget(f, r.booking),
    };
  }
  const q = f?.pairing ?? null;
  if ((state.kind === 'trip' || state.kind === 'calendar-with-trip') && q !== null) {
    const kind = pairingKindOf(q);
    const label = priceLabelKind({ kind: 'pairing', pairingKind: kind }, false);
    const seller = q.seller === null ? null : { name: q.seller, offersRead: q.offersRead };
    const read =
      f === null
        ? null
        : listPairing(r, {
            origin: f.origin,
            destination: f.destination,
            departOut: q.departOut,
            departBack: q.departBack,
          });
    // why: goal 4: a leading pairing shows the figure's own price, age and stale mark, exactly as the board's row does;
    // the pairing beneath a calendar figure shows its own
    const price: Priced =
      state.kind === 'trip' && f !== null
        ? f.price
        : { pricePence: q.pricePence, provenance: q.provenance, stale: q.stale, ageHours: q.ageHours };
    return {
      pricePence: price.pricePence,
      provenance: price.provenance,
      stale: price.stale,
      ageHours: price.ageHours,
      label,
      detail: labelDetail(label, seller, kind),
      seller,
      pairingKind: kind,
      legs: read === null ? null : pairingLegs(r, read.list, read.p),
      times: read === null ? { out: q.departOut, back: q.departBack } : null,
      // why: Ruling 6: the board's pairing carries its own booking address, so the card links where the row links; the
      // pairing beneath a calendar figure is not the figure's trip, so it links its own booking page or search
      target: state.kind === 'trip' && f !== null ? figureTarget(f, null) : target(q.bookingUrl),
    };
  }
  if (state.kind === 'read-without-calendar') {
    const read = listPairing(r, null);
    if (read === null) return null;
    const { list, p } = read;
    const complete = p.offer?.complete ?? false;
    const price = pairingPrice({ offer: p.offer, complete, fromMinor: p.fromMinor });
    const kind = pairingKindOf({ isFrom: price.kind === 'google', offersRead: p.offer?.offersRead ?? 0 });
    const label = priceLabelKind({ kind: 'pairing', pairingKind: kind }, false);
    const seller =
      p.offer === null || price.kind !== 'seller'
        ? null
        : { name: p.offer.seller, offersRead: p.offer.offersRead };
    return {
      pricePence: price.pricePence,
      provenance: list.provenance,
      stale: list.stale,
      ageHours: list.ageHours,
      label,
      detail: labelDetail(label, seller, kind),
      seller,
      pairingKind: kind,
      legs: pairingLegs(r, list, p),
      times: null,
      target: target(r.bookingUrl),
    };
  }
  return null;
}

/**
 * The price of a figure that is not a read trip (a calendar figure, or a verified one, which the card shows greyed once
 * it is not seen again), with its one label: "£388 · Calendar · 3h". Null with no figure or a pairing figure.
 */
export function figurePriceOf(r: TripResponse): (Priced & { label: PriceLabelKind; detail: string }) | null {
  const f = r.figure;
  if (f === null || f.basis === 'pairing') return null;
  const label = figureLabelKind(f);
  return { ...f.price, label, detail: labelDetail(label, null) };
}

/** The date a leg lands, when another day than it leaves ("lands Sun 29 Nov"), else null. */
export function landsOn(leg: Leg): string | null {
  if (leg.dayOffset === 0) return null;
  const d = addDays(leg.date, leg.dayOffset);
  return COPY.trip.lands(dayText(d));
}

/** "Wed 11 Nov": the weekday and the day without the year. */
export function dayText(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDateShort(d)}`;
}

// --- design §6.1 "Other flights on these dates" ---

/** The rows a group shows before its fold (the mockup shows two; three keep a choice without a long list). */
export const OTHERS_SHOWN = 3;

/**
 * One other flight read: its leg, the flight, its price (Google's own) and that price's label. A return's price is
 * Google's for its outbound and that return together, so it carries the outbound it was read with.
 */
export interface OtherRow {
  leg: 'outbound' | 'return';
  flight: ListedFlight | ListedReturn;
  /** the outbound a return was read with (its price is the two together); null for an outbound */
  outbound: ListedFlight | null;
  pence: number;
  label: PriceLabelKind;
}

/** The legs a row's price covers: an outbound alone, or a return with the outbound it was read with. */
function legsOf(x: OtherRow): Array<{ flight: ListedFlight | ListedReturn; leg: 'outbound' | 'return' }> {
  return [
    { flight: x.flight, leg: x.leg },
    ...(x.outbound === null ? [] : [{ flight: x.outbound, leg: 'outbound' as const }]),
  ];
}

/** A group of other flights: those shown, those folded, and the fold's counts (over the limits, dearer). */
export interface OtherGroup {
  heading: 'returns' | 'returns-second' | 'outbounds';
  shown: OtherRow[];
  folded: OtherRow[];
  over: number;
  dearer: number;
  /** the journey limit the over-limit rows all break ("25h"), else null (they break other limits too) */
  overLimit: string | null;
}

function groupOf(heading: OtherGroup['heading'], rows: OtherRow[], limits: FlightLimits): OtherGroup | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.pence - b.pence);
  // why: CodeRabbit PR #58 finding 13: a return row is within the limits only when its outbound is too, since its
  // price is the two together
  const fits = (x: OtherRow) => legsOf(x).every((l) => fitsLimits(l.flight, limits, l.leg));
  const within = sorted.filter(fits);
  const over = sorted.filter((x) => !fits(x));
  const shown = within.slice(0, OTHERS_SHOWN);
  // why: an over row breaks the journey limit alone when each of its legs meets every other limit
  const journeyOnly =
    limits.maxJourneyMinutes !== null &&
    over.every((x) =>
      legsOf(x).every((l) => {
        const w = withinLimits(l.flight, limits, l.leg);
        return w.stops && w.arrival && w.departure;
      }),
    );
  return {
    heading,
    shown,
    folded: [...within.slice(OTHERS_SHOWN), ...over],
    over: over.length,
    dearer: within.length - shown.length,
    overLimit: journeyOnly && limits.maxJourneyMinutes !== null ? hoursText(limits.maxJourneyMinutes) : null,
  };
}

/**
 * The flights read on these dates beside the card's trip (design §6.1), from the card's flight list only: the other
 * returns read with the trip's outbound, then those read with the other outbound tried (each Google's price for an
 * exact outbound and return), then the outbounds whose returns weren't read (Google's list price). Each group shows
 * up to OTHERS_SHOWN within the limits, cheapest first; the rest (over the limits, or dearer) fold into one line.
 */
export function otherFlightsOf(r: TripResponse): OtherGroup[] {
  const list = r.flightList;
  if (list === null || list.status !== 'read') return [];
  const p = pairingOf(list, r.limits);
  const attempts = list.returns?.status === 'read' ? list.returns.attempts : [];
  const tried = new Set(attempts.map((a) => a.outboundIndex));
  // why: a return row keeps the outbound its attempt read it with (the contract holds the index inside the list)
  const retOf =
    (a: (typeof attempts)[number]) =>
    (x: ListedReturn): OtherRow => ({
      leg: 'return',
      flight: x,
      outbound: list.flights[a.outboundIndex] ?? null,
      pence: x.fromMinor,
      label: priceLabelKind({ kind: 'list-return' }, false),
    });
  const mine = p === null ? null : attempts[p.attempt];
  const others = attempts.filter((a) => a !== mine);
  const groups = [
    mine === undefined || mine === null || p === null
      ? null
      : groupOf('returns', mine.returns.filter((x) => x !== p.ret).map(retOf(mine)), r.limits),
    groupOf(
      'returns-second',
      others.flatMap((a) => a.returns.map(retOf(a))),
      r.limits,
    ),
    groupOf(
      'outbounds',
      list.flights
        .filter((_, i) => !tried.has(i))
        .map(
          (x): OtherRow => ({
            leg: 'outbound',
            flight: x,
            outbound: null,
            pence: x.amountMinor,
            label: priceLabelKind({ kind: 'list-outbound' }, false),
          }),
        ),
      r.limits,
    ),
  ];
  return groups.filter((g): g is OtherGroup => g !== null);
}

/** The cheapest flight a list read, with its outbound's duration, for "The cheapest read was £455, 27h 10m out." */
export function cheapestOutbound(list: FlightList | null): ListedFlight | null {
  if (list === null) return null;
  let best: ListedFlight | null = null;
  for (const f of list.flights) if (best === null || f.amountMinor < best.amountMinor) best = f;
  return best;
}

// --- design §6.1 "Search log for these dates" ---

/** The rows the log shows before "Show all". */
export const LOG_SHOWN = 5;

/** When a log row ran: "Today 16:40" today (London), else "Tue 3 Nov". */
export function logWhen(at: IsoDateTime, now: IsoDateTime): string {
  const a = londonParts(instantMs(at));
  const n = londonParts(instantMs(now));
  return a.date === n.date ? COPY.trip.logToday(a.time) : dayText(asIsoDate(a.date));
}

/** The London day of the oldest row, "26 Oct", for "N searches since 26 Oct"; null with no rows. */
export function logSince(log: TripResponse['log']): string | null {
  const oldest = log.at(-1);
  return oldest === undefined ? null : formatIsoDateShort(londonParts(instantMs(oldest.at)).date);
}
