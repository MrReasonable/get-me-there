import { addDays, daysBetween } from '../dates/epochDay.js';
import type { ResolvedSpace, SearchDefinition, WindowSpec } from '../types/definition.js';
import type { IsoDate } from '../types/ids.js';

/**
 * Resolve a window against `todayLondon` (the caller passes `clock.todayLondon()`). Spec §6.1:
 * relative windows `{ startOffsetDays ≥ 1, lengthDays }` start `startOffsetDays` after today and
 * run `lengthDays` days inclusive; absolute windows are clamped to start no earlier than
 * tomorrow. An absolute window wholly before tomorrow resolves to `departureFrom > departureTo`,
 * which `countCells` counts as zero cells (the zero-cell case of spec §6.1). `clamped` is true
 * when an absolute window's start was moved forward to tomorrow (noted in the estimate).
 *
 * Throws `RangeError` for a relative window with `startOffsetDays < 1` or `lengthDays < 1`:
 * those are rejected by validation (`validateSearchSpace`) and by the zod schema, so reaching
 * here with one is a programming error, not operator input.
 */
export function resolveWindow(
  w: WindowSpec,
  todayLondon: IsoDate,
): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean } {
  const tomorrow = addDays(todayLondon, 1);
  if (w.kind === 'relative') {
    if (!Number.isInteger(w.startOffsetDays) || w.startOffsetDays < 1) {
      throw new RangeError(`startOffsetDays must be an integer ≥ 1, got ${w.startOffsetDays}`);
    }
    if (!Number.isInteger(w.lengthDays) || w.lengthDays < 1) {
      throw new RangeError(`lengthDays must be an integer ≥ 1, got ${w.lengthDays}`);
    }
    const departureFrom = addDays(todayLondon, w.startOffsetDays);
    return { departureFrom, departureTo: addDays(departureFrom, w.lengthDays - 1), clamped: false };
  }
  const clamped = daysBetween(w.from, tomorrow) > 0; // from is before tomorrow
  return { departureFrom: clamped ? tomorrow : w.from, departureTo: w.to, clamped };
}

/**
 * Spec §6.1: a definition's resolved space today, the one construction the api's current space, the engine's snapshot
 * and `validateSearchSpace` share (review arch Minor), so they cannot drift. `clamped` is `resolveWindow`'s. The
 * airport lists are copied, so the space never aliases the definition.
 */
export function resolveSpace(
  def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights'>,
  todayLondon: IsoDate,
): { space: ResolvedSpace; clamped: boolean } {
  const w = resolveWindow(def.window, todayLondon);
  return {
    space: {
      origins: [...def.origins],
      destinations: [...def.destinations],
      departureFrom: w.departureFrom,
      departureTo: w.departureTo,
      minNights: def.minNights,
      maxNights: def.maxNights,
    },
    clamped: w.clamped,
  };
}
