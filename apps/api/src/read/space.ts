/** The definition's current resolved space and cell membership (spec §6.1, §8.1). */
import {
  type AirportLookup,
  type CellKey,
  daysBetween,
  type IsoDate,
  type ResolvedSpace,
  resolveSpace,
  type SearchDefinition,
} from '@gmt/core';
import type { AirportsRepo } from '@gmt/db';

type SpaceFields = Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights'>;

/** A draft has no origins or no destinations; it can be stored but not enabled, estimated or run. */
export function isDraft(def: Pick<SearchDefinition, 'origins' | 'destinations'>): boolean {
  return def.origins.length === 0 || def.destinations.length === 0;
}

/** The definition's current resolved space (spec §6.1); results filter to it (spec §6.2, §10). */
export function currentSpace(def: SpaceFields, today: IsoDate): ResolvedSpace {
  return resolveSpace(def, today).space;
}

/**
 * Membership in `generateCells(space)` without generating it (spec §8.1 single-cell verify):
 * airports in the lists, departure inside the inclusive window, nights inside the inclusive range.
 * Task 8.10 asserts the equivalence against `generateCells` on a small space.
 */
export function cellInSpace(space: ResolvedSpace, cell: CellKey): boolean {
  if (!space.origins.includes(cell.origin) || !space.destinations.includes(cell.destination)) return false;
  if (cell.departureDate < space.departureFrom || cell.departureDate > space.departureTo) return false;
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  return nights >= space.minNights && nights <= space.maxNights;
}

/** WP1's `AirportLookup`, backed by the airports table. */
export function airportLookup(repo: AirportsRepo): AirportLookup {
  return {
    exists: (code) => repo.exists(code),
    metroOf: (code) => repo.metroOf(code),
    airportsOfMetro: (code) => repo.airportsOfMetro(code),
  };
}
