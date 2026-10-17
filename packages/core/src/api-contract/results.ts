import { z } from 'zod';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { cabinSchema, pointOfSaleSchema, provenanceSchema, sourceKindSchema } from '../types/provenance.js';
import {
  ageHoursSchema,
  bookingSchema,
  bucketsSchema,
  cellKeySchema,
  cellSchema,
  constraintNameSchema,
  coverageSummarySchema,
  executionStatusSchema,
  executionSummarySchema,
  layoverSchema,
  microGbpSchema,
  moneyPenceSchema,
  priceCellSchema,
  providerIdSchema,
  resultBasisSchema,
  segmentSchema,
  stageSchema,
  vendorLinkSchema,
  verdictClassSchema,
  verdictsSchema,
} from './common.js';

const count = z.number().int().min(0);
/** A vendor search link (spec §5.2): re-validated on the wire like a booking link (plan decision 54). */
const searchLinkSchema = z.object({ url: vendorLinkSchema, host: z.string(), label: z.string() }).nullable();
/** Spec §6.5 / §6.9: one row per itinerary (or calendar cell), provenance on every price. */
export const resultRowSchema = z.object({
  itineraryHash: z.string().nullable(),
  basis: resultBasisSchema,
  verdictClass: z.union([verdictClassSchema, z.literal('unchecked')]),
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  /** Calendar basis: the price is the cheapest of the rows a truncated tile read (decision 36); false for itinerary rows. */
  truncated: z.boolean(),
  cell: cellSchema,
  outbound: z.array(segmentSchema).nullable(),
  inbound: z.array(segmentSchema).nullable(),
  totalMinutes: count.nullable(),
  outboundMinutes: count.nullable(),
  inboundMinutes: count.nullable(),
  stopsOut: count.nullable(),
  stopsIn: count.nullable(),
  layovers: z.array(layoverSchema),
  carriers: z.array(z.string()),
  verdicts: verdictsSchema,
  unverified: z.array(constraintNameSchema),
  notApplied: z.array(constraintNameSchema),
  seller: z.string().nullable(),
  baggage: z
    .object({
      cabinBag: z.enum(['included', 'not-included']).exactOptional(),
      checkedBags: count.exactOptional(),
      notes: z.array(z.string()).exactOptional(),
    })
    .nullable(),
  fareConditions: z
    .object({
      refundable: z.boolean().exactOptional(),
      changeable: z.boolean().exactOptional(),
      notes: z.array(z.string()).exactOptional(),
    })
    .nullable(),
  selfTransfer: z.boolean().nullable(),
  booking: bookingSchema,
  searchLink: searchLinkSchema,
  otherOffers: z.array(
    z.object({
      seller: z.string(),
      pricePence: moneyPenceSchema,
      provenance: provenanceSchema,
      booking: bookingSchema,
      stale: z.boolean(),
      ageHours: ageHoursSchema,
      verdictClass: verdictClassSchema,
      unverified: z.array(constraintNameSchema),
      notSeenInLatest: z.object({ ageHours: ageHoursSchema }).nullable(),
    }),
  ),
  notSeenInLatest: z.object({ ageHours: ageHoursSchema }).nullable(),
  /**
   * Plan decision 54, as on the views' calendar figures: a calendar-basis row whose cell a newer parent execution found
   * empty or no_data, ranked after every current price. Always false on the verified basis.
   */
  superseded: z.boolean(),
  adjustedPence: moneyPenceSchema.nullable(),
  destinationNote: z.string().nullable(),
  executionId: z.string(),
  calendarPriceId: z.number().int().nullable(),
  observationId: z.number().int().nullable(),
});
export const resultsQuerySchema = z.object({
  basis: resultBasisSchema.optional(),
  executionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export const resultsResponseSchema = z.object({
  rows: z.array(resultRowSchema),
  total: count,
  truncated: z.boolean(),
  basis: resultBasisSchema,
  basisReason: z.string(),
  executions: z.array(executionSummarySchema),
  coverage: coverageSummarySchema,
  excludedByCurrentSpace: count,
  verificationProviderConfigured: z.boolean(),
  cheapest: resultRowSchema.nullable(),
});
const pricedCell = priceCellSchema.extend({ cell: cellSchema });
/**
 * Plan decision 54 on the views' figures. A verified-basis minimum the latest search no longer returned carries
 * `notSeenInLatest` (the same shape as a results row's); a calendar-basis price whose cell a newer parent execution
 * found empty or no_data is `superseded` (WP8 ranks such prices after current ones).
 */
const notSeenInLatest = z.object({ ageHours: ageHoursSchema }).nullable();
const verifiedFigure = pricedCell.extend({ itineraryHash: z.string(), notSeenInLatest });
const calendarFigure = pricedCell.extend({ superseded: z.boolean() });
export const calendarDaySchema = z.object({
  /** departure date */
  date: isoDateSchema,
  discovery: z.array(z.object({ providerId: providerIdSchema, buckets: bucketsSchema, total: count })),
  /**
   * `unconfirmedCells`: cells of the day whose itinerary search priced but confirmed no price (reason part
   * `price-unconfirmed`; plan decisions 45, 48, 51), for the destination the request names, else every destination.
   */
  verification: z.object({
    selected: count,
    itinerarySearched: count,
    onDemand: count,
    unconfirmedCells: count,
  }),
  cheapestVerified: verifiedFigure.nullable(),
  cheapestPartiallyVerified: verifiedFigure.extend({ count }).nullable(),
  cheapestCalendar: calendarFigure.nullable(),
  // why: plan decision 58: no per-destination figures; `?destination=` (decision 53) scopes the whole day instead.
});
/**
 * Plan decision 53: the calendar route's optional destination. With it, every day's buckets, selection counts, minimums
 * and `unconfirmedCells` cover that destination's cells only, so a filtered calendar is as honest as the unfiltered one.
 */
export const calendarQuerySchema = z.object({ destination: iataSchema.optional() });
export const calendarResponseSchema = z.object({
  days: z.array(calendarDaySchema),
  executions: z.array(executionSummarySchema),
  staleAfterHours: count,
  calendarStaleAfterHours: z.partialRecord(providerIdSchema, count),
});
/**
 * Spec §11 View C per nights value. Each minimum carries the cell it came from (plan decision 38), so the view can name
 * its departure date and destination. `searched` counts per series: `total` is the cells of this nights value in the
 * series' scope (verification: the selected cells; discovery: every cell) and `searched` those whose outcome is
 * `priced`, `empty` or `no_data` (verification: any verification provider's outcome; discovery: that provider's), so
 * "not searched", "searched k of N" and "searched, no price" stay distinct per series.
 */
const searchedCount = z.object({ searched: count, total: count });
export const durationAnalysisResponseSchema = z.object({
  byNights: z.array(
    z.object({
      nights: count,
      /** n = cells of this nights value with a class-verified price */
      minVerified: pricedCell.extend({ n: count, notSeenInLatest }).nullable(),
      /** n = cells of this nights value the provider priced */
      minCalendar: z.array(z.object({ providerId: providerIdSchema, price: calendarFigure, n: count })),
      searched: z.object({
        verification: searchedCount,
        discovery: z.array(searchedCount.extend({ providerId: providerIdSchema })),
      }),
    }),
  ),
  executions: z.array(executionSummarySchema),
});
export const coverageResponseSchema = z.object({
  executionId: z.string(),
  summary: coverageSummarySchema,
  perStage: z.array(
    z.object({
      stage: stageSchema,
      providerId: providerIdSchema,
      buckets: bucketsSchema,
      total: count,
      requests: z.object({
        calls: count,
        cacheHits: count,
        costMicroGbp: microGbpSchema,
        planCalls: count.nullable(),
      }),
      overrun: z.boolean(),
      parityBreak: z.boolean(),
    }),
  ),
  selectedNotReached: z.array(z.object({ cell: cellSchema, reason: z.enum(['not_run', 'skipped:budget']) })),
  errors: z.array(
    z.object({
      cell: cellSchema,
      stage: stageSchema,
      providerId: providerIdSchema,
      /** The stored reason; null when none was recorded, so "no reason" is never shown as an empty one (review prov M3). */
      reason: z.string().nullable(),
      lastError: z.string().nullable(),
      attempts: count,
      retryable: z.boolean(),
    }),
  ),
  scheduleBlockedSince: isoDateTimeSchema.nullable(),
  /**
   * Ruling 15 (UI-004): the definition's on-demand itinerary searches, newest first, below the parent run, each with
   * its own buckets per stage × provider and its own ledger calls, so View D never presents the parent's ledger as the
   * definition's whole spend.
   */
  onDemand: z.array(
    z.object({
      executionId: z.string(),
      status: executionStatusSchema,
      startedAt: isoDateTimeSchema.nullable(),
      cell: cellSchema,
      perStage: z.array(
        z.object({
          stage: stageSchema,
          providerId: providerIdSchema,
          buckets: bucketsSchema,
          total: count,
          requests: z.object({ calls: count, cacheHits: count, costMicroGbp: microGbpSchema }),
        }),
      ),
    }),
  ),
});
export const calendarGapResponseSchema = z.object({
  cheapestVerified: verifiedFigure.nullable(),
  cells: z.array(z.object({ cell: cellSchema, calendar: priceCellSchema, verifyAvailable: z.boolean() })),
});
export const cellOutcomeSchema = cellKeySchema.extend({
  executionId: z.string(),
  stage: stageSchema,
  providerId: providerIdSchema,
  status: z.enum(['not_run', 'priced', 'empty', 'no_data', 'error', 'skipped']),
  reason: z.string().nullable(),
  attempts: count,
  lastError: z.string().nullable(),
  fetchedAt: isoDateTimeSchema.nullable(),
  /**
   * The outcome's stored minimum, a coverage diagnostic only (review prov M4): it carries no FX flag, staleness or age,
   * so a client never renders it as a fare. The cell's prices are `calendarPrices` and `observations`, each with full
   * provenance; WP10's price guard renders only those.
   */
  minPence: moneyPenceSchema.nullable(),
  cabin: cabinSchema.nullable(),
  pointOfSale: pointOfSaleSchema.nullable(),
  sourceKind: sourceKindSchema.nullable(),
  reusedFromExecutionId: z.string().nullable(),
});
export const cellDetailResponseSchema = z.object({
  cell: cellSchema,
  outcomes: z.array(cellOutcomeSchema),
  /** `superseded` (decision 54): a newer parent execution found this cell empty or no_data. */
  calendarPrices: z.array(
    priceCellSchema.extend({
      executionId: z.string(),
      calendarPriceId: z.number().int(),
      superseded: z.boolean(),
    }),
  ),
  observations: z.array(resultRowSchema),
  /**
   * What the per-cell verify action would spend now (spec §8.1; plan decisions 42, 45): WP7's childCapPreview, the
   * child's hard stop and the calls of budget headroom left for it. Null when the definition has no verification
   * provider.
   */
  verify: z.object({ maxCalls: count, headroomCalls: count }).nullable(),
});
export const historyPointSchema = z.object({
  at: isoDateTimeSchema,
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
});
/**
 * A history point as the api sends it: the stored point plus `stale` (spec §3 and plan decision 44: by fetch age plus
 * any known vendor age) and `truncated` (decisions 30, 36: "cheapest of the rows read"). The db keeps historyPointSchema.
 */
export const historyPointResponseSchema = historyPointSchema.extend({
  stale: z.boolean(),
  truncated: z.boolean(),
});
/**
 * A point of a vendor's price-history series for one searched trip; no full provenance (spec §11), plotted by `date`.
 * `currency` is the literal 'GBP': only vendor-stated GBP points are stored (the repository refuses any other, prov-004),
 * so a point is never FX-converted and never carries "≈".
 */
export const routeSeriesPointSchema = z.object({
  date: isoDateSchema,
  pricePence: moneyPenceSchema,
  currency: z.literal('GBP'),
  fetchedAt: isoDateTimeSchema,
  providerId: providerIdSchema,
  sourceKind: sourceKindSchema,
});
/**
 * One itinerary's offer history. `cell` and `carriers` name it (plan decision 52: the heading and every price's
 * destination come from the api, never from a cached Results row). Each point names the execution that fetched it,
 * so lines join only consecutive runs of the definition (decision 52).
 */
export const itineraryHistoryResponseSchema = z.object({
  itineraryHash: z.string(),
  cell: cellSchema,
  carriers: z.array(z.string()),
  series: z.array(
    z.object({
      providerId: providerIdSchema,
      seller: z.string(),
      cabin: cabinSchema,
      /** priceConfirmed: false for an offer whose price the final step did not confirm (decisions 27, 37) */
      points: z.array(
        historyPointResponseSchema.extend({ priceConfirmed: z.boolean(), executionId: z.string() }),
      ),
    }),
  ),
});
export const routeHistoryQuerySchema = z.object({ cabin: cabinSchema.optional() });
export const routeHistoryResponseSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  /** one point per execution fetch: the pair's minimum across its cells */
  calendarSeries: z.array(
    z.object({
      providerId: providerIdSchema,
      cabin: cabinSchema,
      points: z.array(historyPointResponseSchema.extend({ cell: cellSchema, executionId: z.string() })),
    }),
  ),
  /**
   * Ruling 6 (spec §7, §10 rev 28): one series per searched trip, provider and cabin. `trip` is null for points stored
   * before migration 0003, whose trip was never recorded ("trip unknown"; their cabin is 'unknown').
   */
  routeSeries: z.array(
    z.object({
      providerId: providerIdSchema,
      trip: z.object({ departureDate: isoDateSchema, returnDate: isoDateSchema }).nullable(),
      cabin: z.union([cabinSchema, z.literal('unknown')]),
      /** `stale` by fetch age (decision 54); the stored point type is unchanged */
      points: z.array(routeSeriesPointSchema.extend({ stale: z.boolean() })),
    }),
  ),
});

export type ResultRow = z.infer<typeof resultRowSchema>;
export type HistoryPoint = z.infer<typeof historyPointSchema>;
export type RouteSeriesPoint = z.infer<typeof routeSeriesPointSchema>;
export type CalendarDay = z.infer<typeof calendarDaySchema>;
