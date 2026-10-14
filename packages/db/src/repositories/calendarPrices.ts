import type { Clock } from '@gmt/core';
import type { Db } from '../client.js';
import {
  type CalendarPriceDbRow,
  insertCalendarPrice,
  toCalendarPriceRow,
  validateCalendarPrice,
} from '../internal/priceRow.js';
import type { CalendarPriceInsert, CalendarPriceRow, RepoOptions } from '../types.js';

/** Spec §7 `calendar_prices`. Insert-only except the reused-row supersede. */
export class CalendarPricesRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: RepoOptions,
  ) {}

  /** Validates every row, then inserts all in one transaction and returns the ids in order. A UNIQUE conflict throws SqliteError. */
  insert(executionId: string, rows: CalendarPriceInsert[]): number[] {
    for (const r of rows) validateCalendarPrice(r, this.opts.allowSynthetic, true);
    return this.db.transaction(() => rows.map((r) => insertCalendarPrice(this.db, executionId, r)));
  }

  /** Prices this execution fetched itself (reused copies excluded): the calendar-basis alert candidates (spec §6.8). */
  fetchedBy(executionId: string): CalendarPriceRow[] {
    return this.db.raw
      .prepare<[string], CalendarPriceDbRow>(
        'SELECT * FROM calendar_prices WHERE execution_id = ? AND reused_from_execution_id IS NULL ORDER BY id',
      )
      .all(executionId)
      .map(toCalendarPriceRow);
  }
}
