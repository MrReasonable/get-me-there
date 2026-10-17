import type { Cabin, Iata, IsoDate, IsoDateTime, ProviderId, RouteSeriesPoint, SourceKind } from '@gmt/core';
import type { Db } from '../client.js';
import { readDate, readTime } from '../internal/read.js';
import {
  assertInt,
  assertIsoDate,
  assertIsoDateTime,
  assertProviderKind,
  RowRejected,
} from '../internal/validate.js';
import type { RepoOptions } from '../types.js';

/** Route history comes only from a provider's itinerary search, so its kind follows the provider (no column). */
const KIND_OF: Record<ProviderId, SourceKind> = {
  searchapi: 'scraped-search',
  fixture: 'synthetic',
  travelpayouts: 'authorised-cached',
};

/** The searched trip a price-history series belongs to (ruling 6). */
export interface RouteHistoryTrip {
  departureDate: IsoDate;
  returnDate: IsoDate;
}

/** One stored series: a trip (null for a row migrated without one) and its points by date. */
export interface RouteHistorySeries {
  trip: RouteHistoryTrip | null;
  points: RouteSeriesPoint[];
}

/**
 * Spec §7 `route_price_history` (rev 28), upserted on every verification: the vendor's price-history series for the
 * searched trip, keyed by trip, request cabin, provider and point date, so two trips never overwrite each other (ruling
 * 6). Only vendor-stated GBP points are accepted (prov-004): the table has no FX columns, and the engine's GBP filter is
 * asserted here too, so no other writer can store a converted or foreign-currency figure.
 */
export class RoutePriceHistoryRepo {
  constructor(
    private readonly db: Db,
    private readonly opts: RepoOptions,
  ) {}

  upsert(
    rows: Array<{
      origin: Iata;
      destination: Iata;
      trip: RouteHistoryTrip;
      cabin: Cabin;
      providerId: ProviderId;
      date: IsoDate;
      lowestPricePence: number;
      currency: string;
      fetchedAt: IsoDateTime;
    }>,
  ): void {
    for (const r of rows) {
      if (r.currency !== 'GBP')
        throw new RowRejected(
          'route-history-gbp',
          `a price-history point must be vendor-stated GBP, got ${r.currency}`,
        );
      assertInt('lowest_price_pence', r.lowestPricePence);
      assertIsoDate('date', r.date);
      assertIsoDate('departure_date', r.trip.departureDate);
      assertIsoDate('return_date', r.trip.returnDate);
      assertIsoDateTime('fetched_at', r.fetchedAt);
      assertProviderKind(r.providerId, KIND_OF[r.providerId], this.opts.allowSynthetic);
    }
    const stmt = this.db.raw.prepare(
      `INSERT INTO route_price_history (origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at) VALUES (@origin, @destination, @departureDate, @returnDate, @cabin, @providerId, @date, @lowestPricePence, @fetchedAt)
       ON CONFLICT(origin, destination, departure_date, return_date, cabin, provider_id, date) DO UPDATE SET lowest_price_pence = excluded.lowest_price_pence, fetched_at = excluded.fetched_at`,
    );
    this.db.transaction(() => {
      for (const r of rows)
        stmt.run({
          origin: r.origin,
          destination: r.destination,
          departureDate: r.trip.departureDate,
          returnDate: r.trip.returnDate,
          cabin: r.cabin,
          providerId: r.providerId,
          date: r.date,
          lowestPricePence: r.lowestPricePence,
          fetchedAt: r.fetchedAt,
        });
    });
  }

  /**
   * One cabin's series, grouped by trip (ruling 9 by date within a trip; ruling 6 by trip): known trips by departure and
   * return date, then the migrated "trip unknown" rows.
   */
  series(
    origin: Iata,
    destination: Iata,
    providerId: ProviderId,
    cabin: Cabin | 'unknown',
  ): RouteHistorySeries[] {
    const rows = this.db.raw
      .prepare<
        Record<string, unknown>,
        {
          departure_date: string | null;
          return_date: string | null;
          date: string;
          lowest_price_pence: number;
          fetched_at: string;
        }
      >(
        'SELECT departure_date, return_date, date, lowest_price_pence, fetched_at FROM route_price_history WHERE origin = @origin AND destination = @destination AND provider_id = @providerId AND cabin = @cabin ORDER BY departure_date IS NULL, departure_date, return_date, date',
      )
      .all({ origin, destination, providerId, cabin });
    const out: RouteHistorySeries[] = [];
    let current: RouteHistorySeries | undefined;
    let key: string | undefined;
    for (const r of rows) {
      const k = `${r.departure_date ?? ''}|${r.return_date ?? ''}`;
      if (current === undefined || k !== key) {
        current = {
          trip:
            r.departure_date === null || r.return_date === null
              ? null
              : {
                  departureDate: readDate('route_price_history.departure_date', r.departure_date),
                  returnDate: readDate('route_price_history.return_date', r.return_date),
                },
          points: [],
        };
        key = k;
        out.push(current);
      }
      current.points.push({
        date: readDate('route_price_history.date', r.date),
        pricePence: r.lowest_price_pence,
        currency: 'GBP',
        fetchedAt: readTime('route_price_history.fetched_at', r.fetched_at),
        providerId,
        sourceKind: KIND_OF[providerId],
      });
    }
    return out;
  }
}
