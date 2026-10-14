import type { Cabin, Iata, IsoDate, IsoDateTime, ProviderId, RouteSeriesPoint, SourceKind } from '@gmt/core';
import type { Db } from '../client.js';
import { readDate, readTime } from '../internal/read.js';
import { assertInt, assertIsoDate, assertIsoDateTime, assertProviderKind } from '../internal/validate.js';
import type { RepoOptions } from '../types.js';

/** Route history comes only from a provider's itinerary search, so its kind follows the provider (no column). */
const KIND_OF: Record<ProviderId, SourceKind> = {
  searchapi: 'scraped-search',
  fixture: 'synthetic',
  travelpayouts: 'authorised-cached',
};

/** Spec §7 `route_price_history`, upserted on every verification (the engine converts the vendor series to pence). */
export class RoutePriceHistoryRepo {
  constructor(
    private readonly db: Db,
    private readonly opts: RepoOptions,
  ) {}

  upsert(
    rows: Array<{
      origin: Iata;
      destination: Iata;
      cabin: Cabin | 'unknown';
      providerId: ProviderId;
      date: IsoDate;
      lowestPricePence: number;
      fetchedAt: IsoDateTime;
    }>,
  ): void {
    for (const r of rows) {
      assertInt('lowest_price_pence', r.lowestPricePence);
      assertIsoDate('date', r.date);
      assertIsoDateTime('fetched_at', r.fetchedAt);
      assertProviderKind(r.providerId, KIND_OF[r.providerId], this.opts.allowSynthetic);
    }
    const stmt = this.db.raw.prepare(
      `INSERT INTO route_price_history (origin, destination, cabin, provider_id, date, lowest_price_pence, fetched_at) VALUES (@origin, @destination, @cabin, @providerId, @date, @lowestPricePence, @fetchedAt)
       ON CONFLICT(origin, destination, cabin, provider_id, date) DO UPDATE SET lowest_price_pence = excluded.lowest_price_pence, fetched_at = excluded.fetched_at`,
    );
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    });
  }

  /** One cabin's series by `date` (ruling 9; the History view plots it by date). */
  series(
    origin: Iata,
    destination: Iata,
    providerId: ProviderId,
    cabin: Cabin | 'unknown',
  ): RouteSeriesPoint[] {
    return this.db.raw
      .prepare<Record<string, unknown>, { date: string; lowest_price_pence: number; fetched_at: string }>(
        'SELECT date, lowest_price_pence, fetched_at FROM route_price_history WHERE origin = @origin AND destination = @destination AND provider_id = @providerId AND cabin = @cabin ORDER BY date',
      )
      .all({ origin, destination, providerId, cabin })
      .map((r) => ({
        date: readDate('route_price_history.date', r.date),
        pricePence: r.lowest_price_pence,
        fetchedAt: readTime('route_price_history.fetched_at', r.fetched_at),
        providerId,
        sourceKind: KIND_OF[providerId],
      }));
  }
}
