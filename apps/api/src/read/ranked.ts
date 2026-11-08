/**
 * Spec revision 55 §8.1 (the flight-list step's candidates) and §10 (a search card's cheapest): the board's ranking over
 * a space, read through the same path as the board (`loadRows` → `datePairFigures` → core's `rankDatePairs`), so a card
 * and the step name exactly the date pairs the board ranks first.
 */
import {
  type DatePair,
  type DatePairFigure,
  datePairAt,
  datePairCount,
  type IsoDateTime,
  type ResolvedSpace,
  rankDatePairs,
  type SearchDefinition,
} from '@gmt/core';
import type { RankedDatePair, RankedDatePairsReader } from '@gmt/engine';
import type { Ports } from '../wiring.js';
import { zeroBuckets } from './coverage.js';
import { datePairFigures } from './datePairs.js';
import { loadRows } from './load.js';
import { pairingsFor } from './pairings.js';
import type { ParsedScope } from './scope.js';

/** A ranked date pair with its figure (never null: a pair without one is not ranked). */
export type RankedFigure = DatePair & { figure: DatePairFigure };

/**
 * The board's ranked date pairs of `def` over `space` with the journey limit, best first, leaving out those departing on
 * or before today in London (the board offers no past departure as a pick). One `loadRows` over the space's cells.
 * Spec rev 56 §6.9: with `pairings` (the default: a card's cheapest, the flights block's cells) the figures take the
 * board's pairings map; without (the flight-list step's candidates) they are the calendar figures alone, so which pairs
 * the step reads does not drift as pairings land (arch-r2-013).
 */
export function rankedFigures(
  ports: Ports,
  def: SearchDefinition,
  q: { space: ResolvedSpace; maxJourneyMinutes: number | null; now: IsoDateTime },
  o: { pairings: boolean } = { pairings: true },
): RankedFigure[] {
  const scope: ParsedScope = { space: q.space, maxJourneyMinutes: q.maxJourneyMinutes, datePair: null };
  const loaded = loadRows(def, ports, { scope });
  const { figures } = datePairFigures(
    loaded,
    scope,
    loaded.rc,
    o.pairings ? (asked) => pairingsFor(ports, def, loaded.executionIds, asked) : undefined,
  );
  const today = ports.clock.todayLondon();
  const pairs: RankedFigure[] = [];
  for (let i = 0, n = datePairCount(q.space); i < n; i++) {
    const figure = figures.get(i);
    if (figure === undefined) continue;
    const at = datePairAt(q.space, i);
    if (at.departureDate <= today) continue;
    pairs.push({
      index: i,
      departureDate: at.departureDate,
      returnDate: at.returnDate,
      nights: at.nights,
      buckets: zeroBuckets(),
      selected: 0,
      itinerarySearched: 0,
      notReached: 0,
      onDemand: 0,
      unconfirmed: 0,
      partiallyVerified: 0,
      journeyLeftOut: 0,
      figure,
    });
  }
  // why: rankDatePairs keeps every pair it is given that has a figure, so the narrowing below never drops one
  return rankDatePairs(pairs, q.now).flatMap((p) => (p.figure === null ? [] : [{ ...p, figure: p.figure }]));
}

/**
 * Spec revision 56 §8.1: the engine's `RankedDatePairsReader` (Task 20.9 passes it through `EngineOptions`): the board's
 * ranking of the search over the asked space, cabin and journey limit by the calendar figures alone (no pairings: the
 * step's queue is the calendar's order, so which pairs it reads does not drift as pairings land), departed pairs out,
 * each with its figure's airport pair and source. Design 2026-11-08 §4.2: and the figure's basis, whether it is current
 * (not superseded, seen in the latest search) and whether its price is stale. An unknown or deleted search has none.
 */
export function rankedPairsFor(ports: Ports, q: Parameters<RankedDatePairsReader>[0]): RankedDatePair[] {
  const def = ports.repos.definitions.get(q.definitionId);
  if (def === null || def.deletedAt !== null) return [];
  return rankedFigures(ports, { ...def, cabin: q.cabin }, q, { pairings: false }).map((p) => ({
    departureDate: p.departureDate,
    returnDate: p.returnDate,
    origin: p.figure.origin,
    destination: p.figure.destination,
    pricePence: p.figure.price.pricePence,
    providerId: p.figure.price.provenance.providerId,
    sourceKind: p.figure.price.provenance.sourceKind,
    basis: p.figure.basis,
    current: !p.figure.superseded && p.figure.notSeenInLatest === null,
    stale: p.figure.price.stale !== false,
  }));
}
