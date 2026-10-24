/**
 * Spec §13 "One app per ledger" (review R26): the `MOVED-TO-NATIVE` marker WP16b's import writes beside a database it
 * moved to a native install, and the app and tool bootstraps read before they open it. Its format is defined once here
 * for the writer and the reader: the first line is the instant of the move, an ISO date-time in UTC to the millisecond;
 * anything after it is ignored.
 */
import { type IsoDateTime, isoDateTimeSchema } from '../types/ids.js';

/** The marker's file name, beside whatever database it marks. */
export const MOVED_MARKER = 'MOVED-TO-NATIVE';

/** The marker's text for a move at `movedAt` (what WP16b writes). */
export function movedMarkerText(movedAt: IsoDateTime): string {
  return `${movedAt}\n`;
}

/** The instant a marker's text states, or null when its first line is not one (an older or hand-made marker). */
export function parseMovedMarker(text: string): IsoDateTime | null {
  const end = text.indexOf('\n');
  const first = (end === -1 ? text : text.slice(0, end)).trim();
  const r = isoDateTimeSchema.safeParse(first);
  return r.success ? r.data : null;
}
