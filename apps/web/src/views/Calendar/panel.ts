import { type CellKey, generateCells, type IsoDate } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { toKey } from '../Results/panel.js';

// The Calendar side panel's helpers. Its outcome, price and verify helpers moved to the date pair detail's
// per-airport-pair panel (views/Results/panel.ts, WP19 Task 19.6) and are re-exported here; the day's cell picker stays
// until Task 19.8 removes the Calendar view.
export {
  canPressVerify,
  type LeftContext,
  noHeadroom,
  orderCalendarPrices,
  orderOutcomes,
  reasonText,
  runLabel,
  toKey,
} from '../Results/panel.js';

/** Every cell departing on `date`, in core's generation order (spec §6.1; review arch2-004: core's one enumerator). */
export function cellsForDay(
  def: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>,
  date: IsoDate,
): CellKey[] {
  return generateCells({
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: date,
    departureTo: date,
    minNights: def.minNights,
    maxNights: def.maxNights,
  }).map(toKey);
}
