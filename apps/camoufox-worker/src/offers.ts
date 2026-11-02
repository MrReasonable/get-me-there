import { BOOKING_OFFERS_MAX, type BookingOffer, offerSchema } from '@gmt/core';
import { cleanName } from './flights.js';
import { currencyOf, minorOf } from './pence.js';

/**
 * The booking view's offer grammar and reader (spec revision 56 §2 "The booking read"; Ian's rulings of 2026-11-01:
 * read the booking options, and open "more booking options" first). Each seller's offer is one button named
 * "Continue to book with <seller>[, <fare>] for <price> <currency>" (11 of 11 offers on select-return/2026-11-01/1–2 and
 * 42 of 42 after the expansion on /3–4): the price is stated, never "From". The button is the booking control and is
 * never activated; only its name is read. Only returnPhase.ts imports this module (rules.test.ts pins that).
 */

/** The offer grammar's date (spec rev 56 §2), reported as `versions.offerGrammar` on an answer with a booking read. */
export const OFFER_GRAMMAR_VERSION = '2026-11-01-offers';

/**
 * The whole name, or nothing: the seller (lazy, so a fare after a comma is its own), an optional fare without a comma,
 * the figure (digits with optional thousands commas), and the currency phrase in letters and spaces only, so an
 * appended sentence (a full stop) never matches and an appended word makes the phrase unknown.
 */
const OFFER =
  /^Continue to book with (?<seller>.+?)(?:, (?<fare>[^,]+))? for (?<price>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+) (?<currency>[A-Za-z ]+)$/;

/** One offer name read: the seller and fare as a carrier is cleaned, the price in its currency's minor units, the phrase. */
export interface ParsedOffer {
  seller: string;
  fare: string | null;
  amountMinor: number;
  currency: string;
}

/**
 * Spec rev 56 §2: one offer button's name through the offer grammar, or null: a name with "From" anywhere (an offer's
 * price is stated, so a "from" figure is no offer), one the grammar does not match, a currency phrase the shared pence
 * helper does not know, or a seller or fare the contract refuses once cleaned (empty, over 80 characters). Any known
 * currency is read and returned as its phrase; the reader drops one that is not pounds.
 */
export function parseOfferName(name: string): ParsedOffer | null {
  if (/\bFrom\b/.test(name)) return null;
  const m = OFFER.exec(name);
  const g = m?.groups;
  if (g === undefined) return null;
  const { seller: rawSeller, fare: rawFare, price, currency } = g;
  if (rawSeller === undefined || price === undefined || currency === undefined) return null;
  const code = currencyOf(currency);
  const amountMinor = code === null ? null : minorOf(price, code);
  if (amountMinor === null || amountMinor < 1) return null;
  // why: seller and fare cleaned as a carrier is (flights.ts's one rule, sec-004)
  const seller = cleanName(rawSeller);
  const fare = rawFare === undefined ? null : cleanName(rawFare);
  // why: the contract's shape decides the seller's and fare's text (FLIGHT_TEXT, trimmed and collapsed), once
  if (!offerSchema.safeParse({ seller, fare, priceMinor: amountMinor }).success) return null;
  return { seller, fare, amountMinor, currency };
}

/** What the driver reads of a booking view (driver.ts `bookingFacts`): the offer buttons' names and two control counts. */
export interface BookingFacts {
  /** Each offer button's name in page order (`S.booking.offer` in main); null when unreadable or over the length cap. */
  offerNames: Array<string | null>;
  /** The "<count> more booking options" controls in main (`S.booking.moreOptions`; pressed only when exactly one). */
  moreOptions: number;
  /** The grouped "View <seller>, …" controls (`S.booking.grouped`): counted, never activated, their fares never read. */
  grouped: number;
}

/** The offers one booking view showed, as the booking read keeps them (core's `bookingReadSchema` fields, and `allGbp`). */
export interface OffersRead {
  /** The cheapest BOOKING_OFFERS_MAX offers in pounds, by price then page order. */
  offers: BookingOffer[];
  /** The pound offers parsed before the cut, when above BOOKING_OFFERS_MAX; else null. */
  offersStated: number | null;
  /** Offer buttons the grammar refused (or whose name could not be read). */
  unparsed: number;
  /** Offers the grammar read in another currency, dropped (R-sellers). */
  nonGbp: number;
  grouped: number;
  /** A "more booking options" control is present (before the expansion: the one to press; after it: one left). */
  moreControl: boolean;
  /** No parsed offer was in another currency; false ends the booking read `unrecognised` (`currency`: prov-int-r3-008). */
  allGbp: boolean;
}

/**
 * Spec rev 56 §2: every offer button's name through `parseOfferName`. A refused or unreadable name counts `unparsed`;
 * a parsed offer in another currency counts `nonGbp` and is dropped; of the pound offers the cheapest
 * BOOKING_OFFERS_MAX are kept by price, then page order, and `offersStated` states how many there were when the cut
 * applied. The answer never carries a button's name, only its parsed seller, fare and price.
 */
export function readOffers(f: BookingFacts): OffersRead {
  let unparsed = 0;
  let nonGbp = 0;
  const pounds: Array<{ at: number; offer: BookingOffer }> = [];
  for (const name of f.offerNames) {
    const p = name === null ? null : parseOfferName(name);
    if (p === null) unparsed++;
    else if (currencyOf(p.currency) !== 'GBP') nonGbp++;
    else
      pounds.push({
        at: pounds.length,
        offer: { seller: p.seller, fare: p.fare, priceMinor: p.amountMinor },
      });
  }
  const kept = [...pounds]
    .sort((a, b) => a.offer.priceMinor - b.offer.priceMinor || a.at - b.at)
    .slice(0, BOOKING_OFFERS_MAX)
    .map((x) => x.offer);
  return {
    offers: kept,
    offersStated: pounds.length > BOOKING_OFFERS_MAX ? pounds.length : null,
    unparsed,
    nonGbp,
    grouped: f.grouped,
    moreControl: f.moreOptions > 0,
    allGbp: nonGbp === 0,
  };
}
