import { type BaggageSnapshot, type Cabin, iataSchema, type RawOffer, type RawSegment } from '@gmt/core';
import type { NoteCounter } from '../shared/notes.js';
import { minorOrDrop, type VendorBookingOption, type VendorSegment } from './shapes.js';

const CABIN_BY_TRAVEL_CLASS: Readonly<Record<string, Cabin>> = {
  economy: 'economy',
  'premium economy': 'premium_economy',
  business: 'business',
  first: 'first',
};

// why: core's rule (canonicalFlightNumber): the designator must contain a letter, so "0938" is never carrier "09".
const FLIGHT_RE = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d{1,4})$/;

/** A vendor designator split at core's rule, or passed whole (both parts) so core rejects it as unmappable. */
function splitDesignator(raw: string): { carrier: string; number: string } {
  const m = FLIGHT_RE.exec(raw.trim().toUpperCase());
  return { carrier: m?.[1] ?? raw, number: m?.[2] ?? raw };
}

/**
 * A vendor segment as a `RawSegment`, raw only (spec §5.2): vendor local times as given; the cabin only when a
 * recognised class is stated; the flight number split at the designator when it matches core's rule, otherwise
 * passed whole so core rejects the offer (`unmappable-carrier`). Airport ids go through core's `iataSchema`, the
 * only brand mint site; a vendor place id that is not an IATA code returns null and the caller drops and counts
 * the option.
 */
export function toRawSegment(s: VendorSegment): RawSegment | null {
  const from = iataSchema.safeParse(s.departure_airport.id);
  const to = iataSchema.safeParse(s.arrival_airport.id);
  if (!from.success || !to.success) return null;
  const d = splitDesignator(s.flight_number);
  const seg: RawSegment = {
    marketingCarrier: d.carrier,
    flightNumber: d.number,
    from: from.data,
    to: to.data,
    depart: `${s.departure_airport.date}T${s.departure_airport.time}`,
    arrive: `${s.arrival_airport.date}T${s.arrival_airport.time}`,
    timeKind: 'local',
  };
  const cabin =
    s.travel_class === undefined ? undefined : CABIN_BY_TRAVEL_CLASS[s.travel_class.trim().toLowerCase()];
  if (cabin !== undefined) seg.cabin = cabin;
  if (s.duration !== undefined) seg.durationMinutes = s.duration;
  if (s.airplane !== undefined) seg.aircraft = s.airplane;
  return seg;
}

/** Every segment converted, or null when any one cannot be (the whole option is then dropped). */
export function toRawSegments(segs: readonly VendorSegment[]): RawSegment[] | null {
  const out: RawSegment[] = [];
  for (const s of segs) {
    const r = toRawSegment(s);
    if (r === null) return null;
    out.push(r);
  }
  return out.length === 0 ? null : out;
}

/** The airline the vendor states on the first outbound flight, trimmed, or null when it states none. Never inferred. */
export function statedAirline(segs: readonly VendorSegment[]): string | null {
  const a = segs[0]?.airline?.trim();
  return a === undefined || a === '' ? null : a;
}

/** The legs and cabin every offer of one outbound/return pairing shares. */
export interface Pairing {
  cabin: Cabin;
  outbound: RawSegment[];
  inbound: RawSegment[];
}

/** Same flight: same carrier and the same number (leading zeros aside, as core canonicalises them). */
function sameDesignator(seg: RawSegment, listed: { carrier: string; number: string }): boolean {
  if (seg.marketingCarrier !== listed.carrier) return false;
  const a = /^\d+$/.test(seg.flightNumber) ? Number(seg.flightNumber) : seg.flightNumber;
  const b = /^\d+$/.test(listed.number) ? Number(listed.number) : listed.number;
  return a === b;
}

/**
 * The pairing's legs as one seller lists them. A codeshare seller sells the same physical flights under its own
 * designators (recorded 2026-10-15: Aer Lingus lists EI 381/111/110/380, American AA 8059/8317/8316/8060, British
 * Airways BA 5941/6131/6130/5940 for one pairing). Each listed designator becomes the segment's marketing carrier and
 * flight number, and the step-2 carrier the operating one where they differ, so identity hashes on the flights the
 * seller sells (spec §6.4: codeshares hash on the marketing carrier). The spec's Segment has no operating flight
 * number, so only the operating carrier is kept. Null when the listing has a different number of flights: another
 * itinerary, never this pairing's fare.
 */
function listedLegs(
  p: Pairing,
  listed: readonly string[] | undefined,
  notes: NoteCounter,
): { outbound: RawSegment[]; inbound: RawSegment[] } | null {
  if (listed === undefined) return { outbound: p.outbound, inbound: p.inbound };
  if (listed.length !== p.outbound.length + p.inbound.length) {
    notes.add('itinerary-mismatch-step3');
    return null;
  }
  let codeshare = false;
  const relabel = (seg: RawSegment, i: number): RawSegment => {
    const raw = listed[i];
    if (raw === undefined) return seg;
    const d = splitDesignator(raw);
    if (sameDesignator(seg, d)) return seg;
    codeshare = true;
    return {
      ...seg,
      marketingCarrier: d.carrier,
      flightNumber: d.number,
      operatingCarrier: seg.marketingCarrier,
    };
  };
  const outbound = p.outbound.map((seg, i) => relabel(seg, i));
  const inbound = p.inbound.map((seg, i) => relabel(seg, p.outbound.length + i));
  if (codeshare) notes.add('codeshare-listing-step3');
  return { outbound, inbound };
}

/**
 * Step-3 booking options as offers (spec §5.4): each usable option is its own offer, `verified: true`, with its
 * `book_with` seller, `baggage_prices` as baggage notes, its booking POST, and the flights it lists (`listedLegs`: a
 * codeshare listing is its own itinerary). Split bookings, unpriced options, options naming no seller and listings of
 * another itinerary are skipped and counted; a price the shared `majorToMinor` refuses is dropped and counted.
 */
export function bookingOffers(
  p: Pairing,
  options: readonly VendorBookingOption[],
  currency: string,
  notes: NoteCounter,
): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const b of options) {
    // why: spec §5.4: split bookings are skipped and counted; a sum of two prices would be our number, not the vendor's.
    if (b.is_split_booking === true) {
      notes.add('split-booking-skipped');
      continue;
    }
    if (b.price === undefined) {
      notes.add('unpriced-skipped-step3');
      continue;
    }
    const seller = b.book_with?.trim();
    if (seller === undefined || seller === '') {
      notes.add('no-seller-skipped-step3');
      continue;
    }
    const legs = listedLegs(p, b.flight_numbers, notes);
    if (legs === null) continue;
    const { minor: amountMinor } = minorOrDrop(b.price, currency, notes);
    if (amountMinor === null) continue;
    let booking: RawOffer['booking'] = { kind: 'none' };
    // why: booking_request is a POST to Google, stored and rendered as a form, never fetched server-side (spec §5.4).
    if (b.booking_request !== undefined)
      booking = { kind: 'post', url: b.booking_request.url, postData: b.booking_request.post_data };
    else if (b.booking_phone !== undefined) notes.add('phone-only-booking');
    const baggage: BaggageSnapshot | undefined =
      b.baggage_prices !== undefined && b.baggage_prices.length > 0
        ? { notes: [...b.baggage_prices] }
        : undefined;
    offers.push({
      outbound: legs.outbound,
      inbound: legs.inbound,
      seller,
      requestedCabin: p.cabin,
      amountMinor,
      currency,
      booking,
      ...(baggage === undefined ? {} : { baggage }),
      // why: a seller listing at step 3 is the only confirmation of a price this vendor gives (plan decision 27).
      verified: true,
    });
  }
  return offers;
}

/**
 * Spec §5.4 price-source rule: the step-2 price is the airline's own fare, kept as an airline-direct offer only when
 * no step-3 option names that airline. "Names" is an exact match after trimming and lower-casing against the airline
 * the step-2 offer carries (never a connecting carrier); a near-miss spelling keeps the step-2 offer.
 */
export function step3NamesAirline(step3: readonly RawOffer[], airline: string): boolean {
  const want = airline.trim().toLowerCase();
  return step3.some((o) => o.seller.trim().toLowerCase() === want);
}
