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
  executionSummarySchema,
  layoverSchema,
  microGbpSchema,
  moneyPenceSchema,
  priceCellSchema,
  providerIdSchema,
  resultBasisSchema,
  segmentSchema,
  stageSchema,
  verdictClassSchema,
  verdictsSchema,
} from './common.js';

const count = z.number().int().min(0);
const searchLinkSchema = z.object({ url: z.url(), host: z.string(), label: z.string() }).nullable();
/** Spec §6.5 / §6.9: one row per itinerary (or calendar cell), provenance on every price. */
export const resultRowSchema = z.object({
  itineraryHash: z.string().nullable(),
  basis: resultBasisSchema,
  verdictClass: z.union([verdictClassSchema, z.literal('unchecked')]),
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
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
export const calendarDaySchema = z.object({
  /** departure date */
  date: isoDateSchema,
  discovery: z.array(z.object({ providerId: providerIdSchema, buckets: bucketsSchema, total: count })),
  verification: z.object({ selected: count, itinerarySearched: count, onDemand: count }),
  cheapestVerified: pricedCell.extend({ itineraryHash: z.string() }).nullable(),
  cheapestPartiallyVerified: pricedCell.extend({ itineraryHash: z.string(), count }).nullable(),
  cheapestCalendar: pricedCell.nullable(),
  byDestination: z.array(
    z.object({
      destination: iataSchema,
      cheapestVerified: priceCellSchema.nullable(),
      cheapestCalendar: priceCellSchema.nullable(),
    }),
  ),
});
export const calendarResponseSchema = z.object({
  days: z.array(calendarDaySchema),
  executions: z.array(executionSummarySchema),
  staleAfterHours: count,
  calendarStaleAfterHours: z.partialRecord(providerIdSchema, count),
});
export const durationAnalysisResponseSchema = z.object({
  byNights: z.array(
    z.object({
      nights: count,
      minVerified: priceCellSchema.extend({ n: count }).nullable(),
      minCalendar: z.array(z.object({ providerId: providerIdSchema, price: priceCellSchema, n: count })),
      searched: z.boolean(),
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
      reason: z.string(),
      lastError: z.string().nullable(),
      attempts: count,
      retryable: z.boolean(),
    }),
  ),
  scheduleBlockedSince: isoDateTimeSchema.nullable(),
});
export const calendarGapResponseSchema = z.object({
  cheapestVerified: pricedCell.extend({ itineraryHash: z.string() }).nullable(),
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
  minPence: moneyPenceSchema.nullable(),
  cabin: cabinSchema.nullable(),
  pointOfSale: pointOfSaleSchema.nullable(),
  sourceKind: sourceKindSchema.nullable(),
  reusedFromExecutionId: z.string().nullable(),
});
export const cellDetailResponseSchema = z.object({
  cell: cellSchema,
  outcomes: z.array(cellOutcomeSchema),
  calendarPrices: z.array(
    priceCellSchema.extend({ executionId: z.string(), calendarPriceId: z.number().int() }),
  ),
  observations: z.array(resultRowSchema),
});
export const historyPointSchema = z.object({
  at: isoDateTimeSchema,
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
});
/** No cabin, so no full provenance; plotted by `date`. */
export const routeSeriesPointSchema = z.object({
  date: isoDateSchema,
  pricePence: moneyPenceSchema,
  fetchedAt: isoDateTimeSchema,
  providerId: providerIdSchema,
  sourceKind: sourceKindSchema,
});
export const itineraryHistoryResponseSchema = z.object({
  itineraryHash: z.string(),
  series: z.array(
    z.object({
      providerId: providerIdSchema,
      seller: z.string(),
      cabin: cabinSchema,
      points: z.array(historyPointSchema),
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
      points: z.array(historyPointSchema.extend({ cell: cellSchema, executionId: z.string() })),
    }),
  ),
  routeSeries: z.array(
    z.object({
      providerId: providerIdSchema,
      cabin: z.union([cabinSchema, z.literal('unknown')]),
      points: z.array(routeSeriesPointSchema),
    }),
  ),
});

export type ResultRow = z.infer<typeof resultRowSchema>;
export type HistoryPoint = z.infer<typeof historyPointSchema>;
export type RouteSeriesPoint = z.infer<typeof routeSeriesPointSchema>;
export type CalendarDay = z.infer<typeof calendarDaySchema>;
