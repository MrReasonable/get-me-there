import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  cabinSchema,
  type FlightProvider,
  type Logger,
  type Secret,
  type SuppliedField,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import type { ParamsAllowlist } from '../params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from './calendar.js';
import { estimateItinerary, type ItineraryDeps, searchItinerary } from './itinerary.js';
import { assertPointOfSaleAllowed } from './params.js';

/** The label user-facing strings use for this provider's itinerary source (spec §11). */
export const SEARCHAPI_DISPLAY_NAME = 'Google Flights via SearchApi';

/** Spec §2 table, calendar row; spec §11 names this source "Google date grid via SearchApi". */
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-aggregate',
  maxAgeHours: 24,
  provenanceNote:
    'Google date grid via SearchApi: date-grid prices SearchApi scrapes from Google Flights, in the currency the response states. SearchApi may answer a repeat from its own cache, whose window is undocumented; the app assumes up to 24 hours. SearchApi is asked to exclude separate-ticket itineraries.',
};

/**
 * Spec §2 table, itinerary row, with plan decision 24: `maxAgeHours` is 'unknown' because the vendor may serve a
 * cached result of undocumented age (spec §2 fact 4), never 0.
 */
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo = {
  sourceKind: 'scraped-search',
  maxAgeHours: 'unknown',
  provenanceNote:
    "Google Flights via SearchApi: an itinerary search SearchApi runs on Google Flights when the cell is searched; SearchApi may serve a cached result of undocumented age. A price with a seller comes from Google's booking options. A price shown for the airline is SearchApi's declaration of Google's round-trip price for one adult, not confirmed by a seller listing.",
};

/**
 * What the recorded fixtures evidence (spec §5.2; Task 5.9 re-derives it from the recordings). 'seller' is never
 * declared: a step-2 offer carries the airline the vendor states, not a seller the vendor lists (plan decision 24),
 * and 'selfTransfer' is not, because separate tickets are excluded by request, not stated per offer.
 */
export const SEARCHAPI_SUPPLIED_FIELDS: readonly SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'price',
  'baggage',
];
/** All four cabins map to a vendor `travel_class` (spec §5.4); the list is core's. */
const SEARCHAPI_CABINS: readonly Cabin[] = cabinSchema.options;

/**
 * The SearchApi `FlightProvider` (spec §5.1, §5.2, §5.4). Discovery is `google_flights_calendar` rectangles;
 * verification is the three-step `google_flights` chain. Everything goes through http-kit; the adapter never
 * retries. `costPerCallMicroGbp` is the configured `limits.costPerCallMicroGbp`, the rate http-kit ledgers with.
 * The healthcheck is stateless and probes nothing (plan decision 24).
 */
export function searchApiProvider(o: {
  http: HttpKit;
  log: Logger;
  // why: every adapter takes the shared { http, log, clock } constructor shape (spec §5.1, plan decision 24); this one
  // reads no clock because fetchedAt comes from http-kit.
  clock: Clock;
  key: Secret;
  costPerCallMicroGbp: number;
  pointOfSale: string;
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
}): FlightProvider {
  assertPointOfSaleAllowed(o.paramsAllowlist, o.pointOfSale);
  const log = o.log.child({ providerId: 'searchapi' });
  const calendar: CalendarDeps = {
    http: o.http,
    log,
    key: o.key,
    pointOfSale: o.pointOfSale,
    allowlist: o.paramsAllowlist,
    cacheTtlSeconds: o.cacheTtlSeconds,
  };
  const itinerary: ItineraryDeps = {
    http: o.http,
    log,
    key: o.key,
    pointOfSale: o.pointOfSale,
    allowlist: o.paramsAllowlist,
  };
  return {
    id: 'searchapi',
    displayName: SEARCHAPI_DISPLAY_NAME,
    suppliedFields: SEARCHAPI_SUPPLIED_FIELDS,
    cabins: SEARCHAPI_CABINS,
    discovery: {
      info: SEARCHAPI_DISCOVERY_INFO,
      plan: planRectangles,
      fetchTile: (plan, q, ctx) => fetchCalendarTile(calendar, plan, q, ctx),
    },
    verification: {
      info: SEARCHAPI_VERIFICATION_INFO,
      estimate: (q) => estimateItinerary(q, o.costPerCallMicroGbp),
      search: (q, ctx) => searchItinerary(itinerary, q, ctx),
    },
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: key configured; no request sent (decision 24: healthchecks probe nothing)',
    }),
  };
}
