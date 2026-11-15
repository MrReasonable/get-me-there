/**
 * Ruling 3 (Trips and Search plan): the shared rules that say which date pairs are trips, which count as flights read
 * and which look lower on the calendar. The api's search cards and the web's Trips and Search sections, run line and
 * folds call these and nothing else, so every surface counts the same dates. Each rule reads only figure-level fields,
 * so the api's ranked figures and the web's decoded date pairs can both call it.
 */
import type { DatePairFigure } from './encode.js';
import type { PairingRead } from './pairing.js';

/** What `isTrip` reads of a figure: its basis and decision 54's two marks. */
export type TripFacts = Pick<DatePairFigure, 'basis' | 'superseded' | 'notSeenInLatest'>;
/** What `flightsRead` reads of a figure: `TripFacts` and its cell's flight read. */
export type ReadFacts = TripFacts & Pick<DatePairFigure, 'pairingRead'>;
/** What the list rules read of a figure: `ReadFacts` and its price. */
export type RankFacts = ReadFacts & { price: { pricePence: number } };

/** A ranked date pair as the list rules read it: anything with a figure, or none. */
interface Ranked {
  figure: RankFacts | null;
}
/** A ranked date pair whose figure is there. */
type WithFigure<P extends Ranked> = P & { figure: NonNullable<P['figure']> };

/**
 * The calendar figure's reads that mean its flights were read (Ruling 3): a list was read and returns were looked at,
 * whatever they held. `not-read`, `outbound-only` and `list-failed` never count; `within` is a pairing figure's own,
 * which counts as a trip.
 */
const READ: ReadonlySet<PairingRead> = new Set<PairingRead>([
  'no-pairing-read',
  'over-limit',
  'sellers-not-read',
  'offers-incomplete',
  'within-older',
  'within-other-limits',
]);

/** The reads that leave a calendar price looking lower than the trips: nothing, or not enough, was read for it. */
const UNREAD: ReadonlySet<PairingRead> = new Set<PairingRead>(['not-read', 'outbound-only', 'list-failed']);

/**
 * Whether a figure is a trip with flights read (Ruling 3): a pairing or verified figure that is current (not superseded,
 * seen in the latest search). A verified price the latest search did not see again is not a trip; an older read trip
 * is, and shows its age.
 */
export function isTrip(fig: TripFacts): boolean {
  return fig.basis !== 'calendar' && !fig.superseded && fig.notSeenInLatest === null;
}

/** Whether a date pair's flights count as read (Ruling 3): a trip, or a calendar figure whose list's returns were read. */
export function flightsRead(fig: ReadFacts): boolean {
  return isTrip(fig) || READ.has(fig.pairingRead);
}

/** Whether a ranked date pair has a figure that is a trip. */
const tripIn = <P extends Ranked>(p: P): p is WithFigure<P> => p.figure !== null && isTrip(p.figure);

/** The trips of a ranked list, in its rank order (Ruling 3, Ruling 4: cards show three, the Search page five). */
export function cheapestTrips<P extends Ranked>(ranked: readonly P[]): Array<WithFigure<P>> {
  return ranked.filter(tripIn);
}

/**
 * The calendar prices that look lower than the trips (Ruling 3, Ruling 5): current calendar figures (not superseded)
 * whose flights were not read (`not-read`, `outbound-only`, `list-failed`), priced below the cheapest trip, or all of
 * them when there is no trip; by price, equal prices in rank order. The cheapest trip is the lowest price among the
 * trips, which is not always the first ranked (a stale trip ranks after a fresh dearer one).
 */
export function lowerOnCalendar<P extends Ranked>(ranked: readonly P[]): Array<WithFigure<P>> {
  let below = Number.POSITIVE_INFINITY;
  for (const p of cheapestTrips(ranked)) below = Math.min(below, p.figure.price.pricePence);
  const lower = ranked.filter(
    (p): p is WithFigure<P> =>
      p.figure !== null &&
      p.figure.basis === 'calendar' &&
      !p.figure.superseded &&
      UNREAD.has(p.figure.pairingRead) &&
      p.figure.price.pricePence < below,
  );
  // why: Array.prototype.sort is stable, so equal prices keep the rank order
  return lower.sort((a, b) => a.figure.price.pricePence - b.figure.price.pricePence);
}

/** How many date pairs' trips were left out for the journey limit (Ruling 4): figures reading `over-limit`. */
export function overLimitCount(
  ranked: ReadonlyArray<{ figure: Pick<DatePairFigure, 'pairingRead'> | null }>,
): number {
  let n = 0;
  for (const p of ranked) if (p.figure?.pairingRead === 'over-limit') n += 1;
  return n;
}
