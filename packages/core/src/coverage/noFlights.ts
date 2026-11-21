import type { CellOutcome } from '../types/execution.js';
import type { Iata } from '../types/ids.js';
import type { ProviderId } from '../types/provenance.js';

/**
 * The issue code the browser provider writes (as the start of `lastError`) on a day pair that a "no flights" page did
 * not show (spec §2, ruling on N1): the page answered only the pair it asked, so the cell stays an `error` and is
 * resumable. One owner, so the provider that writes it and every reader that groups it spell it the same way.
 */
export const NO_FLIGHTS_UNSEEN = 'no-flights-unseen';

/** True for an `error` outcome whose `lastError` is the no-flights-unseen code, alone or followed by its words. */
export function isNoFlightsUnseen(o: Pick<CellOutcome, 'status' | 'lastError'>): boolean {
  return (
    o.status === 'error' &&
    o.lastError !== null &&
    (o.lastError === NO_FLIGHTS_UNSEEN || o.lastError.startsWith(`${NO_FLIGHTS_UNSEEN} `))
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
   * Every page of the route said no flights: it has no `priced` and no `empty` outcome, and every `error` outcome on it
   * is no-flights-unseen (its `no_data` outcomes are the pages' own query pairs). An airport with no flights at all to
   * the destination looks like this.
   */
  everyPage: boolean;
}

interface Tally {
  route: NoFlightsRoute;
  answered: boolean;
  otherError: boolean;
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The discovery routes × providers of a run's outcomes with at least one no-flights-unseen outcome, sorted by origin,
 * destination and provider. Verification outcomes are ignored: only a discovery page answers "no flights" for a pair
 * it did not show. Nothing is reclassified: each outcome keeps its stored status; this only groups the unseen ones.
 */
export function noFlightsRoutes(outcomes: readonly CellOutcome[]): NoFlightsRoute[] {
  const tallies = new Map<string, Tally>();
  for (const o of outcomes) {
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
      answered: false,
      otherError: false,
    };
    if (isNoFlightsUnseen(o)) t.route.cells += 1;
    else if (o.status === 'error') t.otherError = true;
    else if (o.status === 'priced' || o.status === 'empty') t.answered = true;
    tallies.set(key, t);
  }
  return [...tallies.values()]
    .filter((t) => t.route.cells > 0)
    .map((t) => ({ ...t.route, everyPage: !t.answered && !t.otherError }))
    .sort(
      (a, b) =>
        order(a.origin, b.origin) || order(a.destination, b.destination) || order(a.providerId, b.providerId),
    );
}
