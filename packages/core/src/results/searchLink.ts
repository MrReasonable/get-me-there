import type { CellKey } from '../types/definition.js';
import type { Cabin, ProviderId } from '../types/provenance.js';

/** The one label every search link carries (spec §6.9). */
export const SEARCH_LINK_LABEL = 'search link, not a fare link';

// why: Aviasales `trip_class` is 0 economy, 1 business, 2 first (Travelpayouts search-form
// documentation); it has no premium economy, and Travelpayouts is economy-only anyway (spec §2).
const AVIASALES_CLASS: Readonly<Record<Cabin, string>> = {
  economy: '0',
  premium_economy: '0',
  business: '1',
  first: '2',
};
const GOOGLE_CABIN: Readonly<Record<Cabin, string>> = {
  economy: 'economy',
  premium_economy: 'premium economy',
  business: 'business class',
  first: 'first class',
};

/**
 * Spec §6.9: a labelled search link for a row whose booking is `none`: an Aviasales search for
 * Travelpayouts rows, a Google Flights search for SearchApi rows, with airports, dates, cabin and
 * one adult in the URL. Google publishes no deep-link format, so the Google link may not prefill
 * every field (WP13 records a manual check). Aviasales has no premium-economy class, so that link
 * opens an economy search and its label says the cabin was not prefilled (review pft-009).
 * Fixture (synthetic) rows get null: nothing about a synthetic price is followable (review sec-003).
 * Both hosts sit inside `LINK_ALLOWLIST` (a test passes every generated link through
 * `validateVendorUrl`).
 */
export function searchLinkFor(
  providerId: ProviderId,
  cell: CellKey,
  cabin: Cabin,
): { url: string; host: string; label: string } | null {
  // why: an exhaustive switch (no default), so a new ProviderId fails to compile here instead of
  // silently getting another vendor's search link (review arch M-2).
  switch (providerId) {
    case 'fixture':
      return null;
    case 'travelpayouts': {
      const url = new URL('https://search.aviasales.com/flights/');
      url.search = new URLSearchParams({
        origin_iata: cell.origin,
        destination_iata: cell.destination,
        depart_date: cell.departureDate,
        return_date: cell.returnDate,
        adults: '1',
        children: '0',
        infants: '0',
        trip_class: AVIASALES_CLASS[cabin],
      }).toString();
      const label =
        cabin === 'premium_economy' ? `${SEARCH_LINK_LABEL}; cabin not prefilled` : SEARCH_LINK_LABEL;
      return { url: url.href, host: url.hostname, label };
    }
    case 'searchapi': {
      const url = new URL('https://www.google.com/travel/flights');
      url.search = new URLSearchParams({
        q: `Flights from ${cell.origin} to ${cell.destination} on ${cell.departureDate} through ${cell.returnDate} ${GOOGLE_CABIN[cabin]} 1 adult`,
        hl: 'en',
        curr: 'GBP',
      }).toString();
      return { url: url.href, host: url.hostname, label: SEARCH_LINK_LABEL };
    }
  }
}
