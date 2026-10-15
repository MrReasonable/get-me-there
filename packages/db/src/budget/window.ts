import type { IsoDateTime } from '@gmt/core';
import type { Db } from '../client.js';
import { readTime } from '../internal/read.js';
import { assertInt } from '../internal/validate.js';

/** Spec §7 "Budget windows": 00:00 UTC on the billing day (1–28) on or before `now`, for one month. One SQL expression for predicates and `/budget`. */
export const MONTH_WINDOW_SQL = `
WITH w AS (
  SELECT CASE WHEN CAST(strftime('%d', @now) AS INTEGER) >= @billingDay
              THEN strftime('%Y-%m-', @now)
              ELSE strftime('%Y-%m-', @now, 'start of month', '-1 month') END
         || printf('%02d', @billingDay) || 'T00:00:00.000Z' AS ws
)
SELECT ws AS windowStart, strftime('%Y-%m-%dT%H:%M:%fZ', ws, '+1 month') AS windowEnd FROM w`;

export function monthWindow(
  db: Db,
  now: IsoDateTime,
  billingDay: number,
): { windowStart: IsoDateTime; windowEnd: IsoDateTime } {
  assertInt('billingDay', billingDay, 1);
  if (billingDay > 28) throw new RangeError(`billingDay must be 1–28, got ${billingDay}`);
  const row = db.raw
    .prepare<{ now: string; billingDay: number }, { windowStart: string; windowEnd: string }>(
      MONTH_WINDOW_SQL,
    )
    .get({ now, billingDay });
  if (row === undefined) throw new Error('month window query returned no row');
  return {
    windowStart: readTime('window_start', row.windowStart),
    windowEnd: readTime('window_end', row.windowEnd),
  };
}
