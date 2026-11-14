import type { PairingKind } from '../datePairs/pairing.js';
import type { ProviderId } from '../types/provenance.js';

/**
 * Design 2026-11-08 §5.2: the one kind of label a price carries, so the Trip page, the board and the cards say the same
 * word for the same source. The words are the web's (`COPY`); this is the choice of kind only.
 */
export const PRICE_LABEL_KINDS = [
  'seller',
  'google-price',
  'google-list',
  'calendar',
  'cached',
  'not-seen-again',
] as const;
export type PriceLabelKind = (typeof PRICE_LABEL_KINDS)[number];

/** What a price is the price of, in the terms that decide its label. */
export type PricedThing =
  | { kind: 'pairing'; pairingKind: PairingKind }
  | { kind: 'verified'; hasBookingOptions: boolean }
  | { kind: 'list-return' }
  | { kind: 'list-outbound' }
  | { kind: 'calendar'; providerId: ProviderId };

/**
 * The label kind of a price. `notSeenAgain` (a later read did not list it) gives `not-seen-again` for every kind but a
 * pairing, whose trip was read and shows its age instead.
 */
export function priceLabelKind(p: PricedThing, notSeenAgain: boolean): PriceLabelKind {
  if (p.kind === 'pairing') return p.pairingKind === 'seller' ? 'seller' : 'google-price';
  if (notSeenAgain) return 'not-seen-again';
  switch (p.kind) {
    case 'verified':
      return p.hasBookingOptions ? 'seller' : 'google-price';
    case 'list-return':
      return 'google-price';
    case 'list-outbound':
      return 'google-list';
    case 'calendar':
      // why: only the Aviasales cache is a cache; any other source's calendar is a calendar price read live
      return p.providerId === 'travelpayouts' ? 'cached' : 'calendar';
  }
}
