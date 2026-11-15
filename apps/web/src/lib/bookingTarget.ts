import {
  type Booking,
  type BookingTarget,
  bookingTargetOf,
  type DatePair,
  type DatePairFigure,
  type DecodedDatePairs,
  type IsoDate,
  isTrip,
  type PointOfSale,
  type Provenance,
  searchLinkFor,
} from '@gmt/core';
import type { DefinitionResponse } from '../api/types.js';

// Design 2026-11-08 §5.3, Ruling 2 (Trips and Search plan): the one booking target of a date pair's figure, so the card,
// the Search section, the day panel and the Trip page link the same place; and the synthetic checks it rests on.

/** A provenance that names the fixture provider or a synthetic source (spec §5.5): never linked out of the app. */
export function syntheticProvenance(p: Pick<Provenance, 'providerId' | 'sourceKind'>): boolean {
  return p.providerId === 'fixture' || p.sourceKind === 'synthetic';
}

/** What `rowBookingTarget` reads of a figure: the decoded board's, or the wire's less its airport-pair index. */
type TargetFacts = Pick<
  DatePairFigure,
  'basis' | 'superseded' | 'notSeenInLatest' | 'origin' | 'destination' | 'price' | 'pairing'
>;

/**
 * Where a date pair's price links (design 2026-11-08 §5.3, Rulings 6 and 10; Ruling 2), by core's one rule
 * (`bookingTargetOf`). A current verified trip links its own seller's booking (`booking`, from its details: "Book on
 * <host>"), else the Google Flights search for its own airports and dates; it never reads `figure.pairing`, which is the
 * trip read in the date pair's best calendar cell, maybe another airport pair's (final review C1). A pairing figure links
 * its own booking page where its read recorded one ("Book on Google Flights"), else that search; a booking handed to it is
 * not its own and is ignored. A calendar price is not a trip to book, a verified price the latest search did not see
 * again is not a trip any more, and a synthetic price is never linked out: all three give `none`. `cabin` is the
 * search's and `pointOfSale` the install's
 * (POINT_OF_SALE, never a default), for the search link.
 */
export function rowBookingTarget(
  pair: Pick<DatePair, 'departureDate' | 'returnDate'>,
  figure: TargetFacts,
  cabin: DefinitionResponse['cabin'],
  booking: Booking | null,
  pointOfSale: PointOfSale,
): BookingTarget {
  // why: Ruling 3: only a trip is linked out; a calendar price waits for its flights to be read (design §5.3)
  if (!isTrip(figure)) return { kind: 'none' };
  const q = figure.pairing;
  const link = searchLinkFor(
    'camoufox',
    {
      origin: figure.origin,
      destination: figure.destination,
      departureDate: pair.departureDate,
      returnDate: pair.returnDate,
    },
    cabin,
    pointOfSale,
  );
  const verified = figure.basis === 'verified';
  return bookingTargetOf({
    synthetic:
      syntheticProvenance(figure.price.provenance) || (q !== null && syntheticProvenance(q.provenance)),
    booking: verified ? booking : null,
    // why: final review C1: only a pairing figure's pairing is its own trip; a verified figure's is another's
    bookingUrl: verified ? null : (q?.bookingUrl ?? null),
    searchLink: link === null ? null : { url: link.url, host: link.host },
  });
}

/**
 * A verified figure's own booking from the read's details (Ruling 2): the entry naming its dates and airports, or null
 * where there is none (the figure is not a current verified one).
 */
export function verifiedBookingOf(
  details: DecodedDatePairs['verifiedDetails'],
  pair: { departureDate: IsoDate; returnDate: IsoDate },
  figure: Pick<DatePairFigure, 'basis' | 'origin' | 'destination'>,
): Booking | null {
  if (figure.basis !== 'verified') return null;
  const d = details.find(
    (x) =>
      x.departureDate === pair.departureDate &&
      x.returnDate === pair.returnDate &&
      x.origin === figure.origin &&
      x.destination === figure.destination,
  );
  return d?.booking ?? null;
}

/**
 * Spec §11 Dates, revision 50: the red synthetic banner shows when any provenance in the read (figures and
 * cheaper-cached prices alike), the discovery providers or any execution read (the shown run's progress) names the
 * fixture provider or a synthetic source; judged on the whole decoded read, never the rows the board shows, and
 * whatever `/providers` says. Revision 56 (R-synthetic, prov-r3-008): every price group in the read, a pairing
 * figure's grid price and every pairing (leading or beneath) included.
 */
export function isSyntheticRead(
  d: Pick<DecodedDatePairs, 'pairs' | 'discoveryProviders'>,
  run: { progress: ReadonlyArray<{ providerId: string }> } | undefined,
): boolean {
  if (d.discoveryProviders.includes('fixture')) return true;
  if (run?.progress.some((p) => p.providerId === 'fixture') === true) return true;
  return d.pairs.some((p) => {
    const f = p.figure;
    if (f === null) return false;
    return (
      syntheticProvenance(f.price.provenance) ||
      (f.cheaperCached !== null && syntheticProvenance(f.cheaperCached.provenance)) ||
      (f.gridPrice !== null && syntheticProvenance(f.gridPrice.provenance)) ||
      (f.pairing !== null && syntheticProvenance(f.pairing.provenance))
    );
  });
}
