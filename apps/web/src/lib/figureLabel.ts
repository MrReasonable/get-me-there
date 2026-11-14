import {
  type DatePairFigure,
  type PairingKind,
  type PriceLabelKind,
  pairingKindOf,
  priceLabelKind,
} from '@gmt/core';
import { COPY } from '../copy.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7): the one label a figure carries, from core's `priceLabelKind`, and the
// tap detail that goes with it. The Trip page's card reads these; the search page's rows read the same (Task 8), so a
// pair of dates says the same word on both (goal 4).

/** The parts of a figure its label is decided by, as the date-pairs decoder and the trip read both give them. */
export type LabelledFigure = Pick<
  DatePairFigure,
  'basis' | 'price' | 'pairing' | 'superseded' | 'notSeenInLatest' | 'hasBookingOptions'
>;

/**
 * The label kind of a figure: a pairing's by its pairing kind (a read trip is never "Not seen again"); a verified one's
 * by whether SearchApi's booking options gave a seller's booking (the figure's own `hasBookingOptions`, which the board
 * and the trip read both carry, final review I1); a calendar one's by its source, "Not seen again" once a later search
 * did not list it.
 */
export function figureLabelKind(f: LabelledFigure): PriceLabelKind {
  switch (f.basis) {
    case 'pairing':
      // why: the contract gives a pairing figure its pairing; without one it is Google's price, never a seller's
      return priceLabelKind(
        { kind: 'pairing', pairingKind: f.pairing === null ? 'google-unread' : pairingKindOf(f.pairing) },
        false,
      );
    case 'verified':
      return priceLabelKind(
        { kind: 'verified', hasBookingOptions: f.hasBookingOptions },
        f.notSeenInLatest !== null,
      );
    case 'calendar':
      return priceLabelKind({ kind: 'calendar', providerId: f.price.provenance.providerId }, f.superseded);
  }
}

/**
 * What a label's detail says the price is (design §5.1's tap details), with the seller where one was read. The age is
 * said once, on the detail's second line from the price's provenance, so these words name none. `pairingKind` is the
 * pairing's own where the price is a pairing's (else null): Google's price for a pairing whose booking page was read in
 * part says not every seller was read (CodeRabbit PR #58 finding 7), never that none was.
 */
export function labelDetail(
  kind: PriceLabelKind,
  seller: { name: string; offersRead: number } | null,
  pairingKind: PairingKind | null = null,
): string {
  const D = COPY.trip.labelDetail;
  // why: a seller named by the browser's booking-page read; without one the seller's price is SearchApi's
  if (kind === 'seller')
    return seller === null ? D.sellerSearchApi : D.seller(seller.name, seller.offersRead);
  if (kind === 'google-price' && pairingKind === 'google-incomplete') return D['google-incomplete'];
  return D[kind];
}
