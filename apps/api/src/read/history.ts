/** Spec §10 history routes: points with provenance, staleness, truncation and confirmation (decisions 36, 38, 42, 44). */
import {
  type apiContract,
  type Cabin,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Iata,
  isStale,
  isTruncated,
  type ProviderId,
  type SearchDefinition,
  withAssumedBound,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { calendarThreshold, refreshHoursFor, staleness, withNights } from './rows.js';

export type ItineraryHistoryResponse = z.infer<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.infer<typeof apiContract.routeHistoryResponseSchema>;
type HistoryCatchUp = z.infer<typeof apiContract.historyCatchUpSchema>;

/**
 * Spec §8.2 rev 36 (review R19): the catch-up label of each run a history point names, looked up by the run itself
 * whatever its definition (a route's points come from every definition flying it), once per run.
 */
function catchUpOf(ports: Ports): (executionId: string) => HistoryCatchUp {
  const seen = new Map<string, HistoryCatchUp>();
  return (executionId) => {
    const known = seen.get(executionId);
    if (known !== undefined) return known;
    const e = ports.repos.executions.get(executionId);
    const label =
      e?.isCatchUp && e.scheduledFor !== null && e.startedAt !== null
        ? { ranAt: e.startedAt, for: e.scheduledFor }
        : null;
    seen.set(executionId, label);
    return label;
  };
}

/**
 * One series per (provider, seller, cabin), oldest first (spec §11 History), under the itinerary's own `cell` and
 * `carriers` from its stored row (decision 52, WP10 Task 10.1); 404 for an unknown hash. Each point names the execution
 * whose observation it is, is stale by the verified-basis rule (STALE_AFTER_HOURS, decisions 44, 55), never truncated
 * (an itinerary search has no pages), and says whether the final step confirmed its price (`price` among the
 * observation's supplied fields, decisions 27, 37, 42).
 */
export function itineraryHistory(hash: string, ports: Ports): ItineraryHistoryResponse {
  const now = ports.clock.now();
  const it = ports.repos.itineraries.get(hash);
  if (it === null) throw new ApiError(404, 'itinerary_not_found', API_TEXT.itineraryNotFound);
  const catchUp = catchUpOf(ports);
  return {
    itineraryHash: hash,
    cell: withNights(it),
    carriers: it.marketingCarriers,
    series: ports.repos.itineraries.offerHistory(hash).map((s) => ({
      providerId: s.providerId,
      seller: s.seller,
      cabin: s.cabin,
      points: s.points.map(({ suppliedFields, ...p }) => ({
        ...p,
        stale: staleness(p.provenance, ports.config.staleAfterHours, now).stale,
        truncated: false,
        priceConfirmed: suppliedFields.includes('price'),
        catchUp: catchUp(p.executionId),
      })),
    })),
  };
}

/**
 * The refresh a route point is judged by: the newest live definition flying the pair that discovers with that provider,
 * through the same `refreshHoursFor` the rows use (its explicit refresh, else core's default); with none, the default.
 * why: `definitions.list()` is oldest first, so it is walked from the end (review arch Minor).
 */
function refreshFor(
  defs: readonly SearchDefinition[],
  origin: Iata,
  destination: Iata,
  providerId: ProviderId,
): number {
  const match = [...defs]
    .reverse()
    .find(
      (d) =>
        d.origins.includes(origin) &&
        d.destinations.includes(destination) &&
        d.providers.discovery.includes(providerId),
    );
  return match === undefined ? DEFAULT_DISCOVERY_REFRESH_HOURS : refreshHoursFor(match, providerId);
}

/**
 * Route history: the calendar series per provider in the requested cabin, one point per execution fetch carrying its
 * cell and execution (reused rows excluded by the repository), each stale by the calendar rule and truncated when its
 * discovery outcome was (decisions 36, 38); plus the vendor's price-history series per provider and searched trip
 * (ruling 6, spec §7 rev 28 `route_price_history`, decision 40), for the requested cabin and then `'unknown'` (rows
 * migrated without a trip), plotted by `date`. Plan decision 54: each point carries `stale` by fetch age against the
 * provider's calendar threshold (the series is vendor-stated GBP only, decision 25 and prov-004; WP10 labels it
 * indicative).
 */
export function routeHistory(
  origin: Iata,
  destination: Iata,
  cabin: Cabin,
  ports: Ports,
): RouteHistoryResponse {
  const now = ports.clock.now();
  const defs = ports.repos.definitions.list();
  const catchUp = catchUpOf(ports);
  return {
    origin,
    destination,
    calendarSeries: ports.repos.calendarPrices.history(origin, destination, cabin).map((s) => {
      const threshold = calendarThreshold(
        ports.config,
        ports.providers,
        s.providerId,
        refreshFor(defs, origin, destination, s.providerId),
      );
      // why: N4 (pie-007): an assumed bound is labelled "assumed" here as on every other view.
      const info = ports.providers.find((x) => x.id === s.providerId)?.discovery?.info;
      return {
        providerId: s.providerId,
        cabin,
        points: s.points.map(({ sourceLastError, ...p }) => ({
          ...p,
          provenance: withAssumedBound(p.provenance, info),
          stale: staleness(p.provenance, threshold, now).stale,
          // why: decisions 36, 47: the fetching outcome's last_error, read with the point (WP19: no outcome read per run)
          truncated: isTruncated(sourceLastError),
          catchUp: catchUp(p.executionId),
        })),
      };
    }),
    routeSeries: ports.providers
      .flatMap((p) => {
        const threshold = calendarThreshold(
          ports.config,
          ports.providers,
          p.id,
          refreshFor(defs, origin, destination, p.id),
        );
        // why: ruling 6: one series per searched trip in the requested cabin, then the migrated rows that never
        // recorded a trip (cabin 'unknown'), which the web labels "trip unknown".
        return [cabin, 'unknown' as const].flatMap((cab) =>
          ports.repos.routeHistory.series(origin, destination, p.id, cab).map((s) => ({
            providerId: p.id,
            trip: s.trip,
            cabin: cab,
            points: s.points.map((pt) => ({
              ...pt,
              // why: decision 54: stale by fetch age. The vendor gives the series no age, so core's rule (decision 55)
              // reads it as an unknown vendor age, which counts the fetch age alone. The web labels the series indicative.
              stale: isStale({ fetchedAt: pt.fetchedAt, maxAgeHours: 'unknown' }, now, threshold),
            })),
          })),
        );
      })
      .filter((s) => s.points.length > 0),
  };
}
