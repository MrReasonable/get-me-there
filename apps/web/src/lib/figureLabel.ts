import {
  type Booking,
  type DatePairFigure,
  formatAgo,
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
  'basis' | 'price' | 'pairing' | 'superseded' | 'notSeenInLatest'
>;

/**
 * The label kind of a figure: a pairing's by its pairing kind (a read trip is never "Not seen again"); a verified one's
 * by whether SearchApi's booking options gave a seller's booking (`booking`, the trip read's; null where none is known);
 * a calendar one's by its source, "Not seen again" once a later search did not list it.
 */
export function figureLabelKind(f: LabelledFigure, booking: Booking | null): PriceLabelKind {
  switch (f.basis) {
    case 'pairing':
      // why: the contract gives a pairing figure its pairing; without one it is Google's price, never a seller's
      return priceLabelKind(
        { kind: 'pairing', pairingKind: f.pairing === null ? 'google-unread' : pairingKindOf(f.pairing) },
        false,
      );
    case 'verified':
      return priceLabelKind(
        { kind: 'verified', hasBookingOptions: booking !== null && booking.kind !== 'none' },
        f.notSeenInLatest !== null,
      );
    case 'calendar':
      return priceLabelKind({ kind: 'calendar', providerId: f.price.provenance.providerId }, f.superseded);
  }
}

/** What a label's detail says the price is (design §5.1's tap details), with the seller where one was read. */
export function labelDetail(
  kind: PriceLabelKind,
  ctx: { seller: { name: string; offersRead: number } | null; ageHours: number | 'unknown' },
): string {
  const D = COPY.trip.labelDetail;
  const ago = COPY.agoOf(ctx.ageHours);
  switch (kind) {
    case 'seller':
      // why: a seller named by the browser's booking-page read; without one the seller's price is SearchApi's
      return ctx.seller === null ? D.sellerSearchApi : D.seller(ctx.seller.name, ctx.seller.offersRead, ago);
    case 'not-seen-again':
      return D['not-seen-again'](ctx.ageHours === 'unknown' ? COPY.ageUnknown : formatAgo(ctx.ageHours));
    case 'google-price':
    case 'google-list':
    case 'calendar':
    case 'cached':
      return D[kind];
  }
}
