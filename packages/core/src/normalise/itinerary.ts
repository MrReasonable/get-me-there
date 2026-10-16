import { daysBetween, fromEpochDay, toEpochDay } from '../dates/epochDay.js';
import { NormalisationError } from '../errors.js';
import type { RawOffer, RawSegment } from '../ports/provider.js';
import { hasControlChars } from '../text/control.js';
import { type CellKey, cellKeyString } from '../types/definition.js';
import { asIsoDate, type Iata, type IsoDate, isoDateTimeOfEpochMs } from '../types/ids.js';
import type {
  Booking,
  Layover,
  NormalisedItinerary,
  ObservationFields,
  Offer,
  Segment,
} from '../types/itinerary.js';
import type { Cabin, FxInfo, ProviderId } from '../types/provenance.js';
import { canonicalCarrier, canonicalFlightNumber } from './carrier.js';
import { itineraryHash } from './hashing.js';
import { localMinute, requireZone, vendorInstant, wallToInstant } from './localTime.js';
import { priceInGbp } from './money.js';
import { LINK_ALLOWLIST, validateVendorUrl } from './vendorUrl.js';

/** What the pure normaliser needs from the engine (which reads the airports and FX repositories). */
export interface NormaliseDeps {
  providerId: ProviderId;
  /** The definition's cabin; must equal `raw.requestedCabin`. */
  cabin: Cabin;
  /** IANA zone of an airport from the airports table, or null when the airport is unknown. */
  tzOf(iata: Iata): string | null;
  /** A rate already checked against `FX_MAX_RATE_AGE_DAYS` by the engine, or null. */
  rateFor(currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null;
}

/** `normaliseOffer`'s result: the three parts on success, or the reason the offer is dropped. */
export type NormaliseResult =
  | { ok: true; itinerary: NormalisedItinerary; offer: Offer; observation: ObservationFields }
  | { ok: false; error: NormalisationError };

const MINUTE_MS = 60_000;

/** Longest POST booking body kept (review sec-002); longer or control-character bodies are dropped. */
export const MAX_POST_DATA_LENGTH = 4096;

/** A list with at least one element, so first and last need no undefined check. */
type NonEmpty<T> = [T, ...T[]];

function nonEmpty<T>(items: readonly T[]): NonEmpty<T> | null {
  const [head, ...tail] = items;
  return head === undefined ? null : [head, ...tail];
}

function mapNonEmpty<T, U>(items: NonEmpty<T>, f: (t: T) => U): NonEmpty<U> {
  return [f(items[0]), ...items.slice(1).map(f)];
}

const lastOf = <T>(items: NonEmpty<T>): T => items.reduce((_, x) => x);

interface TimedSegment {
  segment: Segment;
  departMs: number;
  arriveMs: number;
}

function normaliseSegment(raw: RawSegment, tzOf: (iata: Iata) => string): TimedSegment {
  const marketingCarrier = canonicalCarrier(raw.marketingCarrier);
  const flightNumber = canonicalFlightNumber(raw.flightNumber, marketingCarrier);
  // why: RawSegment.from/to are already branded Iata (upper-case by construction, WP0 iataSchema).
  const { from, to } = raw;
  const fromTz = requireZone(tzOf(from));
  const toTz = requireZone(tzOf(to));
  const departMs = vendorInstant(raw.depart, raw.timeKind, fromTz);
  const arriveMs = vendorInstant(raw.arrive, raw.timeKind, toTz);
  if (arriveMs <= departMs)
    throw new NormalisationError(
      'bad-local-time',
      `${marketingCarrier}${flightNumber} arrives before it departs`,
    );
  const segment: Segment = {
    marketingCarrier,
    flightNumber,
    from,
    to,
    departLocal: localMinute(departMs, fromTz),
    arriveLocal: localMinute(arriveMs, toTz),
    departUtc: isoDateTimeOfEpochMs(departMs),
    arriveUtc: isoDateTimeOfEpochMs(arriveMs),
  };
  // why: optional vendor facts are copied only when stated; nothing is defaulted (spec §5.2).
  if (raw.operatingCarrier !== undefined) segment.operatingCarrier = canonicalCarrier(raw.operatingCarrier);
  if (raw.durationMinutes !== undefined) segment.durationMinutes = raw.durationMinutes;
  if (raw.aircraft !== undefined) segment.aircraft = raw.aircraft;
  return { segment, departMs, arriveMs };
}

/** True when (arriveMs, departMs) overlaps 00:00–05:00 local on any date it touches. Spec §6.2. */
function spansNight(arriveMs: number, departMs: number, tz: string): boolean {
  const first = toEpochDay(asIsoDate(localMinute(arriveMs, tz).slice(0, 10)));
  const last = toEpochDay(asIsoDate(localMinute(departMs, tz).slice(0, 10)));
  for (let day = first; day <= last; day += 1) {
    const [y = 0, mo = 0, d = 0] = fromEpochDay(day).split('-').map(Number);
    const parts = { y, mo, d, mi: 0, s: 0, ms: 0 };
    const start = wallToInstant({ ...parts, h: 0 }, tz);
    const end = wallToInstant({ ...parts, h: 5 }, tz);
    if (arriveMs < end && departMs > start) return true;
  }
  return false;
}

function layoversOf(direction: readonly TimedSegment[], tzOf: (iata: Iata) => string): Layover[] {
  const out: Layover[] = [];
  let arriving: TimedSegment | undefined;
  for (const next of direction) {
    if (arriving !== undefined) {
      const minutes = Math.round((next.departMs - arriving.arriveMs) / MINUTE_MS);
      if (minutes < 0) {
        throw new NormalisationError(
          'bad-local-time',
          `connection at ${arriving.segment.to} departs before arrival`,
        );
      }
      out.push({
        at: arriving.segment.to,
        minutes,
        overnight: spansNight(arriving.arriveMs, next.departMs, requireZone(tzOf(arriving.segment.to))),
        airportChange: arriving.segment.to !== next.segment.from,
      });
    }
    arriving = next;
  }
  return out;
}

function directionMinutes(direction: NonEmpty<TimedSegment>): number {
  return Math.round((lastOf(direction).arriveMs - direction[0].departMs) / MINUTE_MS);
}

// why: arch-r2-002 — the money step is priceInGbp, shared with the engine's calendar prices, so the two cannot diverge
function money(raw: RawOffer, deps: NormaliseDeps): { pricePence: number; fx: FxInfo } {
  return priceInGbp(raw, (currency) => deps.rateFor(currency));
}

/**
 * The validated booking. A POST body (`postData`, spec §5.4 `booking_request`) is opaque: core
 * never parses, fetches, renders or logs it, only bounds it. Consumers link to the app's results
 * row for POST bookings (spec §8.3) and render the form only on an explicit click (WP9).
 */
function booking(raw: RawOffer, providerId: ProviderId): Booking {
  if (raw.booking.kind === 'none') return { kind: 'none' };
  const checked = validateVendorUrl(raw.booking.url, LINK_ALLOWLIST[providerId]);
  if (checked.kind !== 'get' || raw.booking.kind === 'get') return checked;
  const body = raw.booking.postData;
  if (body.length > MAX_POST_DATA_LENGTH || hasControlChars(body)) return { kind: 'none' };
  return { kind: 'post', url: checked.url, postData: body, host: checked.host };
}

function zoneOf(tzOf: NormaliseDeps['tzOf'], iata: Iata): string {
  const tz = tzOf(iata);
  // why: an airport missing from the table must stop the offer here; UTC is never hashed (spec §6.4).
  if (tz === null) throw new NormalisationError('unknown-airport-tz', `no time zone for ${iata}`);
  return tz;
}

/**
 * Spec §5.6 pure step for one raw offer returned for `cell`: carriers and flight numbers
 * canonicalised, local and UTC times per segment (DST rules), layovers, identity hash (§6.4),
 * evidenced cabins, money in pence with the FX flag (§6.3), booking link validated (§5.2).
 * The offer must fly the cell it was returned for (both directions' airports and both local
 * dates); a vendor answer for another cell is `cell-mismatch`, never re-keyed (spec §5.2 "cell
 * keys from the response"). Vendor strings (seller, aircraft, baggage and fare notes) are kept
 * raw; WP11 strips control characters and the web escapes them (spec §8.3).
 * Returns `{ ok: false, error }` for every `NormalisationError`, so the engine can drop the offer
 * and count it as `offers-dropped:n`. Programming errors (cabin mismatch, non-integer amounts) throw.
 */
export function normaliseOffer(raw: RawOffer, cell: CellKey, deps: NormaliseDeps): NormaliseResult {
  if (raw.requestedCabin !== deps.cabin) {
    throw new Error(`requestedCabin ${raw.requestedCabin} differs from the definition cabin ${deps.cabin}`);
  }
  const tzOf = (iata: Iata): string => zoneOf(deps.tzOf, iata);
  try {
    const outRaw = nonEmpty(raw.outbound);
    const backRaw = nonEmpty(raw.inbound);
    if (outRaw === null || backRaw === null) {
      throw new NormalisationError(
        'no-return-legs',
        outRaw === null ? 'no outbound segments' : 'no inbound segments',
      );
    }
    const out = mapNonEmpty(outRaw, (s) => normaliseSegment(s, tzOf));
    const back = mapNonEmpty(backRaw, (s) => normaliseSegment(s, tzOf));
    const outbound = mapNonEmpty(out, (t) => t.segment);
    const inbound = mapNonEmpty(back, (t) => t.segment);
    // why: the whole round trip must match the cell: outbound origin, outbound destination, the
    // inbound leaving that destination and landing at that origin, and both local dates. A return
    // from EWR on a JFK cell is another itinerary (review po-004, prov-004).
    const flown = `${outbound[0].from}|${lastOf(outbound).to}|${outbound[0].departLocal.slice(0, 10)}|${inbound[0].departLocal.slice(0, 10)}`;
    const asked = cellKeyString(cell);
    if (flown !== asked)
      throw new NormalisationError('cell-mismatch', `offer flies ${flown}, cell is ${asked}`);
    const backFrom = inbound[0].from;
    const backTo = lastOf(inbound).to;
    if (backFrom !== cell.destination || backTo !== cell.origin) {
      throw new NormalisationError('cell-mismatch', `inbound flies ${backFrom}→${backTo}, cell is ${asked}`);
    }
    const layovers = [...layoversOf(out, tzOf), ...layoversOf(back, tzOf)];
    const hash = itineraryHash(outbound, inbound);
    const itinerary: NormalisedItinerary = {
      hash,
      origin: cell.origin,
      destination: cell.destination,
      departureDate: cell.departureDate,
      returnDate: cell.returnDate,
      nights: daysBetween(cell.departureDate, cell.returnDate),
      outbound,
      inbound,
      outboundMinutes: directionMinutes(out),
      inboundMinutes: directionMinutes(back),
      stopsOut: outbound.length - 1,
      stopsIn: inbound.length - 1,
      layovers,
      airportChange: layovers.some((l) => l.airportChange),
      marketingCarriers: [...new Set([...outbound, ...inbound].map((s) => s.marketingCarrier))].sort(),
    };
    const all = [...raw.outbound, ...raw.inbound];
    // why: a cabin is evidence only when the vendor states it on every segment; otherwise the
    // cabin verdict must be `unverified`, so we store null rather than a partial list (spec §5.6).
    const stated = all.flatMap((s) => (s.cabin === undefined ? [] : [s.cabin]));
    const segmentCabins = stated.length === all.length ? stated : null;
    const { pricePence, fx } = money(raw, deps);
    return {
      ok: true,
      itinerary,
      offer: {
        itineraryHash: hash,
        providerId: deps.providerId,
        seller: raw.seller,
        cabin: raw.requestedCabin,
      },
      observation: {
        pricePence,
        fx,
        priceNativeMinor: raw.amountMinor,
        currencyNative: raw.currency.toUpperCase(),
        taxesIncluded: raw.taxesIncluded ?? null,
        selfTransfer: raw.selfTransfer ?? null,
        segmentCabins,
        baggage: raw.baggage ?? null,
        fareConditions: raw.fareConditions ?? null,
        booking: booking(raw, deps.providerId),
        bookingExpiresAt: raw.bookingExpiresAt ?? null,
      },
    };
  } catch (e) {
    if (e instanceof NormalisationError) return { ok: false, error: e };
    throw e;
  }
}
