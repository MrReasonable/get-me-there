import { fromEpochDay, type IsoDate, isoDateTimeSchema, toEpochDay } from '@gmt/core';

// Instants as epoch milliseconds, which carry no zone (review focus 3; test/lib/noDateParsing.test.ts forbids Date
// objects outside src/now.tsx). Inputs are toISOString instants or epoch-day integers; a date-only string is refused.

const DAY_MS = 86_400_000;

/** Epoch milliseconds of an instant; throws RangeError on anything but the toISOString form (spec §6.3). */
export function instantMs(t: string): number {
  if (!isoDateTimeSchema.safeParse(t).success) throw new RangeError(`instantMs: not an ISO instant: ${t}`);
  return Date.parse(t);
}

/** A calendar date on the same millisecond axis as instants (UTC midnight), by epoch-day arithmetic only. */
export function dateMs(d: IsoDate): number {
  return toEpochDay(d) * DAY_MS;
}

/** The calendar date of a point on the date axis (inverse of dateMs), for date-only tick labels. */
export function dateOfMs(ms: number): IsoDate {
  return fromEpochDay(Math.floor(ms / DAY_MS));
}
