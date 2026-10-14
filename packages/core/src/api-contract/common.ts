import { z } from 'zod';
import type { Buckets } from '../types/execution.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { cabinSchema, provenanceSchema, providerIdSchema } from '../types/provenance.js';

/** Spec §10: errors `{ error: { code, message, details? } }`; a 422 carries `details.fields[]`. */
export const fieldErrorSchema = z.object({ field: z.string(), message: z.string() });
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.looseObject({ fields: z.array(fieldErrorSchema).exactOptional() }).exactOptional(),
  }),
});
export const moneyPenceSchema = z.number().int().min(0);
export const microGbpSchema = z.number().int().min(0);
export const ageHoursSchema = z.union([z.number().int().min(0), z.literal('unknown')]);
/** Every price on the wire: amount, provenance, staleness, effective age. */
export const priceCellSchema = z.object({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
});
const count = z.number().int().min(0);
export const bucketsSchema: z.ZodType<Buckets> = z.object({
  priced: count,
  empty: count,
  no_data: count,
  error: count,
  skipped: count,
  not_run: count,
  reused: count,
});
export const coverageSummarySchema = z.object({
  buckets: bucketsSchema,
  total: count,
  selected: count,
  itinerarySearched: count,
  onDemand: count,
  reused: count,
});
/** A bounded string only; semantic validation is `parseCron` in engine (spec §8.2). */
export const cronSchema = z
  .string()
  .min(9)
  .max(100)
  .regex(/^[\d*/,\-\s]+$/, 'cron: digits, * / , - and spaces only; validated by the scheduler');
export const bookingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('get'), url: z.url(), host: z.string() }),
  z.object({ kind: z.literal('post'), url: z.url(), postData: z.string(), host: z.string() }),
  z.object({ kind: z.literal('none') }),
]);
export const executionStatusSchema = z.enum([
  'pending',
  'running',
  'paused_budget',
  'paused_error',
  'interrupted',
  'cancelled',
  'completed',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
]);
export const stageSchema = z.enum(['discovery', 'verification']);
/** Lists are newest first. */
export const executionSummarySchema = z.object({
  id: z.string(),
  status: executionStatusSchema,
  isChild: z.boolean(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  ageHours: ageHoursSchema,
});
export const usageSchema = z.object({
  scope: z.string(),
  calls: count,
  costMicroGbp: microGbpSchema,
  costPence: moneyPenceSchema,
  cap: z.number().int().min(0).nullable(),
  windowStart: isoDateTimeSchema.nullable(),
  windowEnd: isoDateTimeSchema.nullable(),
});
export const cellKeySchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
});
export const cellSchema = cellKeySchema.extend({ nights: z.number().int().min(0) });
export const segmentSchema = z.object({
  marketingCarrier: z.string(),
  operatingCarrier: z.string().exactOptional(),
  flightNumber: z.number().int().min(0),
  from: iataSchema,
  to: iataSchema,
  departLocal: z.string(),
  arriveLocal: z.string(),
  departUtc: isoDateTimeSchema.exactOptional(),
  arriveUtc: isoDateTimeSchema.exactOptional(),
  durationMinutes: z.number().int().min(0).exactOptional(),
  aircraft: z.string().exactOptional(),
});
export const layoverSchema = z.object({
  at: iataSchema,
  minutes: z.number().int().min(0),
  overnight: z.boolean(),
  airportChange: z.boolean(),
});
export const constraintNameSchema = z.enum([
  'cabin',
  'maxStops',
  'maxJourneyMinutes',
  'minLayoverMinutes',
  'maxLayoverMinutes',
  'noOvernightLayover',
  'departureWindowLocal',
  'arrivalWindowLocal',
  'noSelfTransfer',
  'noAirportChange',
  'includeAirlines',
  'excludeAirlines',
  'cabinBagRequired',
  'checkedBagRequired',
  'minCheckedBags',
  'maxPricePence',
]);
export const verdictSchema = z.enum(['pass', 'fail', 'unverified']);
export const verdictsSchema = z.partialRecord(constraintNameSchema, verdictSchema);
export const verdictClassSchema = z.enum(['verified', 'partially-verified', 'failed']);
export const resultBasisSchema = z.enum(['verified', 'calendar']);
export const capabilityInfoSchema = z.object({
  sourceKind: z.enum(['authorised-cached', 'scraped-aggregate', 'scraped-search', 'synthetic']),
  provenanceNote: z.string(),
  maxAgeHours: z.union([z.number().int().min(0), z.literal('unknown')]),
});
export { cabinSchema, providerIdSchema };
