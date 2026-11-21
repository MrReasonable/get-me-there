import type { CellOutcome } from '../types/execution.js';
import type { Iata } from '../types/ids.js';
import type { ProviderId } from '../types/provenance.js';

/**
 * The marks the browser provider writes (as the start of `lastError`, code then words) on the day pairs of a grid page
 * that answered "no flights" (spec §2, ruling on N1). One owner, so the provider that writes them and every reader that
 * groups them spell them the same way.
 *
 * - `no-flights-unseen`: an `error` (`parse`, resumable): a pair the page did not show; it answered only the pair it asked.
 * - `no-flights-asked`: a `no_data`: the pair the page asked and answered "no flights" for.
 * - `sale-window-end`: a `no_data`: a pair of the probe page past the planning horizon, the sale window's end.
 */
export const NO_FLIGHTS_UNSEEN = 'no-flights-unseen';
export const NO_FLIGHTS_ASKED = 'no-flights-asked';
export const SALE_WINDOW_END = 'sale-window-end';
export type NoFlightsMark = typeof NO_FLIGHTS_UNSEEN | typeof NO_FLIGHTS_ASKED | typeof SALE_WINDOW_END;

/** Each mark's words, after its code in `lastError`. */
export const NO_FLIGHTS_WORDS: Readonly<Record<NoFlightsMark, string>> = {
  [NO_FLIGHTS_UNSEEN]:
    'the page answered no flights for the pair it asked; this day pair was not shown, so it is not searched yet',
  [NO_FLIGHTS_ASKED]: 'the page asked for this day pair answered no flights',
  [SALE_WINDOW_END]:
    'the page past the planning horizon answered no flights: the sale window ends before this day pair',
};

/** A mark as `lastError` carries it: "<code> <words>". */
export const noFlightsDetail = (mark: NoFlightsMark): string => `${mark} ${NO_FLIGHTS_WORDS[mark]}`;

/** True when `lastError` carries `mark`, alone or followed by its words. */
function carries(lastError: string | null, mark: NoFlightsMark): boolean {
  return lastError !== null && (lastError === mark || lastError.startsWith(`${mark} `));
}

/** True for an `error` outcome whose `lastError` is the no-flights-unseen mark. */
export function isNoFlightsUnseen(o: Pick<CellOutcome, 'status' | 'lastError'>): boolean {
  return o.status === 'error' && carries(o.lastError, NO_FLIGHTS_UNSEEN);
}

/** True for a `no_data` outcome a "no flights" page wrote: its own query pair, or a pair past the sale window's end. */
export function isNoFlightsNoData(o: Pick<CellOutcome, 'status' | 'lastError'>): boolean {
  return (
    o.status === 'no_data' &&
    (carries(o.lastError, NO_FLIGHTS_ASKED) || carries(o.lastError, SALE_WINDOW_END))
  );
}

/** One route × provider of a run on which a "no flights" page left day pairs unseen. */
export interface NoFlightsRoute {
  origin: Iata;
  destination: Iata;
  providerId: ProviderId;
  /** The route's no-flights-unseen outcomes. */
  cells: number;
  /**
   * Every page of the route said no flights: on this route × provider every `error` outcome is no-flights-unseen and
   * every `no_data` outcome carries a no-flights mark (a page that showed flights with unknown prices writes an unmarked
   * `no_data`), and no provider has a `priced` or `empty` outcome on the origin–destination. An airport with no flights
   * at all to the destination looks like this. Rows stored before the marks existed carry none, so they never qualify.
   */
  everyPage: boolean;
}

interface Tally {
  route: NoFlightsRoute;
  /** An `error` or `no_data` outcome on this route × provider that is not "no flights" evidence. */
  other: boolean;
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The discovery routes × providers of a run's outcomes with at least one no-flights-unseen outcome, sorted by origin,
 * destination and provider. Only a discovery page answers "no flights" for a pair it did not show, so only discovery
 * rows are grouped; a `priced` or `empty` outcome of any stage or provider on the origin–destination is evidence of
 * flights. Nothing is reclassified: each outcome keeps its stored status; this only groups the unseen ones.
 */
export function noFlightsRoutes(outcomes: readonly CellOutcome[]): NoFlightsRoute[] {
  const tallies = new Map<string, Tally>();
  const flown = new Set<string>();
  for (const o of outcomes) {
    if (o.status === 'priced' || o.status === 'empty') flown.add(`${o.origin}|${o.destination}`);
    if (o.stage !== 'discovery') continue;
    const key = `${o.origin}|${o.destination}|${o.providerId}`;
    const t = tallies.get(key) ?? {
      route: {
        origin: o.origin,
        destination: o.destination,
        providerId: o.providerId,
        cells: 0,
        everyPage: false,
      },
      other: false,
    };
    // why: a priced or empty outcome is counted in `flown` above, for every provider on the origin–destination
    if (isNoFlightsUnseen(o)) t.route.cells += 1;
    else if (o.status === 'error' || (o.status === 'no_data' && !isNoFlightsNoData(o))) t.other = true;
    tallies.set(key, t);
  }
  return [...tallies.values()]
    .filter((t) => t.route.cells > 0)
    .map((t) => ({
      ...t.route,
      everyPage: !t.other && !flown.has(`${t.route.origin}|${t.route.destination}`),
    }))
    .sort(
      (a, b) =>
        order(a.origin, b.origin) || order(a.destination, b.destination) || order(a.providerId, b.providerId),
    );
}
