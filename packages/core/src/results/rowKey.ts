import type { ResultRow } from './types.js';

/**
 * The stable key of a results row (plan contract): its `itineraryHash`, or
 * `calendar:${calendarPriceId}` for a calendar-basis row. The web's `?row=` parameter, email links
 * (`DigestItem.rowKey`) and `bandCheapest` all use it.
 */
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string {
  return row.itineraryHash ?? `calendar:${row.calendarPriceId}`;
}
