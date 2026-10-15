/**
 * Travelpayouts month tiling. Spec §5.2 (rev 14): the query stays per (origin, destination) pair; one `month` tile
 * per departure month on /aviasales/v3/prices_for_dates; tiles partition the pair's cells; plan is pure and
 * deterministic. No airport is named here (spec §1).
 */
import {
  type CellKey,
  type DiscoveryQuery,
  generateCells,
  type Iata,
  type IsoMonth,
  monthOf,
  type TilePlan,
} from '@gmt/core';

/** The part of AirportsRepo (WP3) the adapter needs; the plan's constructor `airports` option. */
export interface MetroLookup {
  metroOf(iata: Iata): string | null;
}

/** What one tile sends (`origin` may be a metro code) and which pair its rows are filtered to. */
export interface TileParams {
  readonly origin: string;
  readonly pairOrigin: Iata;
  readonly destination: Iata;
  readonly month: IsoMonth;
}

/** The vendor `origin` parameter. First cut: the pair's airport; Task 6.4 adds the shared-metro rule. */
export function originParam(q: DiscoveryQuery, _airports: MetroLookup): string {
  return q.origin;
}

/**
 * The cells to tile: `q.cells` when set (spec §5.1 re-plan), else the pair's full space in generation order (spec
 * §6.1). Every cell must belong to the query's pair (plan, provider port).
 */
export function cellsOf(q: DiscoveryQuery): CellKey[] {
  if (q.cells !== undefined) {
    if (q.cells.some((c) => c.origin !== q.origin || c.destination !== q.destination)) {
      throw new Error(
        'a Travelpayouts query is per (origin, destination) pair; every cell must belong to it',
      );
    }
    return q.cells;
  }
  return generateCells({
    origins: [q.origin],
    destinations: [q.destination],
    departureFrom: q.departureFrom,
    departureTo: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
  }).map(({ origin, destination, departureDate, returnDate }) => ({
    origin,
    destination,
    departureDate,
    returnDate,
  }));
}

/**
 * Spec §5.2: one `month` tile per departure month of the pair, months ascending, so each cell lands in exactly one
 * tile and the same query always gives the same plan.
 * why: months are sorted because a re-plan subset (`q.cells`) may arrive in any order.
 */
export function planMonthTiles(q: DiscoveryQuery): TilePlan[] {
  const buckets = new Map<IsoMonth, CellKey[]>();
  for (const cell of cellsOf(q)) {
    const month = monthOf(cell.departureDate);
    const bucket = buckets.get(month);
    if (bucket === undefined) buckets.set(month, [cell]);
    else bucket.push(cell);
  }
  return [...buckets.keys()].sort().map(
    (month, index): TilePlan => ({
      index,
      coveredCells: buckets.get(month) ?? [],
      request: { kind: 'month', month },
    }),
  );
}

/** A tile's vendor parameters, from the plan and the pair. Throws on a tile that is not a month tile. */
export function tileParams(plan: TilePlan, q: DiscoveryQuery, airports: MetroLookup): TileParams {
  if (plan.request.kind !== 'month')
    throw new Error(`travelpayouts tiles are month tiles, got ${plan.request.kind}`);
  return {
    origin: originParam(q, airports),
    pairOrigin: q.origin,
    destination: q.destination,
    month: plan.request.month,
  };
}
