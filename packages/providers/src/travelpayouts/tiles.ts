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

/** A metropolitan code as the vendor takes it; anything else from the table is treated as no metro. */
const CODE_RE = /^[A-Z]{3}$/;

/**
 * The vendor `origin` parameter. Spec §2 and §5.2 (rev 14): the pair origin's metropolitan code when two or more of
 * the definition's origins (`q.definitionOrigins`, the pair origin included) map to that metro, else the airport
 * code. Rows are split back to the pair by `origin_airport`; a sibling pair's identical metro request is answered by
 * the response cache inside the TTL.
 * why: a lone airport is queried by its own code, so its tile never pages through rows of airports the definition
 * does not use; a malformed code from the table is treated as no metro rather than sent to the vendor.
 */
export function originParam(q: DiscoveryQuery, airports: MetroLookup): string {
  const metro = airports.metroOf(q.origin);
  if (metro === null || !CODE_RE.test(metro)) return q.origin;
  const origins = new Set<Iata>([q.origin, ...(q.definitionOrigins ?? [])]);
  let sharing = 0;
  for (const o of origins) if (airports.metroOf(o) === metro) sharing += 1;
  return sharing >= 2 ? metro : q.origin;
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
