import { addDays, daysBetween } from '../dates/epochDay.js';
import type { Cell, ResolvedSpace } from '../types/definition.js';

/**
 * Number of cells in a resolved space, in closed form with no allocation. Spec §6.1: "the
 * estimate and caps use it". Zero when the window is empty (`departureTo < departureFrom`,
 * which a clamped absolute window in the past produces) or the nights range is inverted.
 */
export function countCells(space: ResolvedSpace): number {
  const days = Math.max(0, daysBetween(space.departureFrom, space.departureTo) + 1);
  const nights = Math.max(0, space.maxNights - space.minNights + 1);
  return space.origins.length * space.destinations.length * days * nights;
}

/**
 * Every cell of a resolved space. Spec §6.1: "deterministic order: origin, destination,
 * departureDate, nights"; window ends inclusive; `returnDate = departureDate + nights`.
 *
 * why: origins and destinations are sorted, not taken in the order the operator typed them, so
 * the generation order (which selection uses for tie-breaks and the stride, spec §6.7) does not
 * change when a definition lists the same airports in a different order.
 */
export function generateCells(space: ResolvedSpace): Cell[] {
  // why: the default sort compares UTF-16 code units, which is locale-independent (unlike
  // localeCompare) and exact for upper-case IATA codes.
  const origins = [...space.origins].sort();
  const destinations = [...space.destinations].sort();
  const days = Math.max(0, daysBetween(space.departureFrom, space.departureTo) + 1);
  const cells: Cell[] = [];
  for (const origin of origins) {
    for (const destination of destinations) {
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
  }
  return cells;
}
