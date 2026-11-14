import { bookingPageUrl } from '../flights/returns.js';
import type { Booking } from '../types/itinerary.js';

/** Where a trip's price links (design 2026-11-08 §5.3): the seller, the booking page, a Google Flights search, or nowhere. */
export type BookingTarget =
  | { kind: 'seller'; booking: Exclude<Booking, { kind: 'none' }> }
  | { kind: 'booking-page'; url: string; host: string }
  | { kind: 'search'; url: string; host: string }
  | { kind: 'none' };

const GOOGLE_HOST = 'www.google.com';

/**
 * The one booking target of a trip. A synthetic price is never linked out. Otherwise the first that holds: the seller's
 * own booking, the booking page the read saw (re-checked here, since a stored address is read back as any string:
 * Ruling 8), a Google Flights search link; any other search link (the Aviasales one) is not offered.
 */
export function bookingTargetOf(t: {
  synthetic: boolean;
  booking: Booking | null;
  bookingUrl: string | null;
  searchLink: { url: string; host: string } | null;
}): BookingTarget {
  if (t.synthetic) return { kind: 'none' };
  if (t.booking !== null && t.booking.kind !== 'none') return { kind: 'seller', booking: t.booking };
  const page = t.bookingUrl === null ? null : bookingPageUrl(t.bookingUrl);
  if (page !== null) return { kind: 'booking-page', url: page.url, host: page.host };
  if (t.searchLink !== null && t.searchLink.host === GOOGLE_HOST)
    return { kind: 'search', url: t.searchLink.url, host: t.searchLink.host };
  return { kind: 'none' };
}
