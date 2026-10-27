import { addDays, daysBetween } from '../dates/epochDay.js';
import type { Cell, ResolvedSpace } from '../types/definition.js';
import type { Iata } from '../types/ids.js';

/**
 * Departure days in a window, ends inclusive; 0 when the window is empty (`departureTo < departureFrom`, which a
 * clamped absolute window in the past produces). The one clamp: `countCells`, `generateCells` and the date-pair space
 * (WP19) all count days through it.
 */
export function windowDays(s: Pick<ResolvedSpace, 'departureFrom' | 'departureTo'>): number {
  return Math.max(0, daysBetween(s.departureFrom, s.departureTo) + 1);
}

/**
 * Every airport pair of a space in generation order: origins sorted, then destinations sorted. The one home of that
 * order: `generateCells` walks it, and the date-pairs contract indexes a figure's airport pair into it (WP19).
 *
 * why: origins and destinations are sorted, not taken in the order the operator typed them, so the generation order
 * (which selection uses for tie-breaks and the stride, spec §6.7) does not change when a definition lists the same
 * airports in a different order. The default sort compares UTF-16 code units, which is locale-independent (unlike
 * localeCompare) and exact for upper-case IATA codes.
 */
export function sortedAirportPairs(
  origins: readonly Iata[],
  destinations: readonly Iata[],
): Array<{ origin: Iata; destination: Iata }> {
  const sortedDestinations = [...destinations].sort();
  return [...origins]
    .sort()
    .flatMap((origin) => sortedDestinations.map((destination) => ({ origin, destination })));
}

/**
 * Number of cells in a resolved space, in closed form with no allocation. Spec §6.1: "the
 * estimate and caps use it". Zero when the window is empty or the nights range is inverted.
 */
export function countCells(space: ResolvedSpace): number {
  const nights = Math.max(0, space.maxNights - space.minNights + 1);
  return space.origins.length * space.destinations.length * windowDays(space) * nights;
}

/**
 * Every cell of a resolved space. Spec §6.1: "deterministic order: origin, destination,
 * departureDate, nights"; window ends inclusive; `returnDate = departureDate + nights`.
 */
export function generateCells(space: ResolvedSpace): Cell[] {
  const days = windowDays(space);
  const cells: Cell[] = [];
  for (const { origin, destination } of sortedAirportPairs(space.origins, space.destinations)) {
    for (let i = 0; i < days; i += 1) {
      const departureDate = addDays(space.departureFrom, i);
      for (let nights = space.minNights; nights <= space.maxNights; nights += 1) {
        cells.push({
          origin,
          destination,
          departureDate,
          returnDate: addDays(departureDate, nights),
          nights,
        });
      }
    }
  }
  return cells;
}
