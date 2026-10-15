import type { IsoDate } from '@gmt/core';
import type { Db } from '../client.js';
import { readDate } from '../internal/read.js';
import { assertInt, assertIsoDate, RowRejected } from '../internal/validate.js';

/** FX rates for normalisation (spec §5.6: `FX_MAX_RATE_AGE_DAYS`, ECB-covered currencies only). */
export class FxRepo {
  constructor(private readonly db: Db) {}

  rateNano(date: IsoDate, currency: string): number | null {
    return (
      this.db.raw
        .prepare<[string, string], { r: number }>(
          'SELECT rate_nano AS r FROM fx_rates WHERE date = ? AND currency = ?',
        )
        .get(date, currency)?.r ?? null
    );
  }

  /** The newest rate dated within [today − maxAgeDays, today]; null means `fx-unavailable` (spec §5.6). */
  latest(
    currency: string,
    maxAgeDays: number,
    today: IsoDate,
  ): { rateNano: number; date: IsoDate; source: string } | null {
    assertInt('maxAgeDays', maxAgeDays);
    const r = this.db.raw
      .prepare<Record<string, unknown>, { rateNano: number; date: string; source: string }>(
        `SELECT rate_nano AS rateNano, date, source FROM fx_rates WHERE currency = @currency AND date <= @today AND date >= date(@today, '-' || @maxAgeDays || ' days') ORDER BY date DESC LIMIT 1`,
      )
      .get({ currency, today, maxAgeDays });
    return r === undefined
      ? null
      : { rateNano: r.rateNano, date: readDate('fx_rates.date', r.date), source: r.source };
  }

  upsert(rows: Array<{ date: IsoDate; currency: string; rateNano: number; source: string }>): void {
    for (const r of rows) {
      assertIsoDate('date', r.date);
      if (!/^[A-Z]{3}$/.test(r.currency))
        throw new RowRejected('currency', `currency must be ISO 4217 upper-case, got ${r.currency}`);
      if (r.currency === 'GBP')
        throw new RowRejected('currency', 'GBP is the base currency and has no rate row');
      assertInt('rate_nano', r.rateNano, 1);
      if (r.source.length === 0) throw new RowRejected('source', 'an FX rate must name its source');
    }
    const stmt = this.db.raw.prepare(
      'INSERT INTO fx_rates (date, currency, rate_nano, source) VALUES (@date, @currency, @rateNano, @source) ON CONFLICT(date, currency) DO UPDATE SET rate_nano = excluded.rate_nano, source = excluded.source',
    );
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    });
  }
}
