import { type IsoDateTime, isoDateTimeOfEpochMs } from '../types/ids.js';

/**
 * Spec §7 "Budget windows" as a pure function: the month that starts 00:00 UTC on the billing day (1–28) on or before
 * `now`, and ends at the same instant a month later. The ledger's SQL (db's `monthWindow`) is tested to agree, and the
 * camoufox worker counts its monthly pages and scrolls over the same window (decision 82), never the London month.
 */
export function billingMonthWindow(
  now: IsoDateTime,
  billingDay: number,
): { windowStart: IsoDateTime; windowEnd: IsoDateTime } {
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28)
    throw new RangeError(`billingDay must be an integer 1–28, got ${billingDay}`);
  const d = new Date(now);
  // why: Date.UTC rolls a month of -1 back into the previous year, so January before the billing day needs no branch
  const month = d.getUTCMonth() - (d.getUTCDate() >= billingDay ? 0 : 1);
  return {
    windowStart: isoDateTimeOfEpochMs(Date.UTC(d.getUTCFullYear(), month, billingDay)),
    windowEnd: isoDateTimeOfEpochMs(Date.UTC(d.getUTCFullYear(), month + 1, billingDay)),
  };
}
