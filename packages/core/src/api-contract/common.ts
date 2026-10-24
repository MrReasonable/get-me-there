import { z } from 'zod';
import { LINK_ALLOWLIST, validateVendorUrl } from '../normalise/vendorUrl.js';
import type { Buckets } from '../types/execution.js';
import { SKIP_CODES } from '../types/execution.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { cabinSchema, provenanceSchema, providerIdSchema, sourceKindSchema } from '../types/provenance.js';

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
/**
 * Every price on the wire: amount, provenance, staleness, effective age, and `truncated`: true when
 * the price came from a discovery tile the pagination cap stopped early, so it is only the
 * cheapest of the rows read (decisions 30 and 36; WP8 derives it from the outcome's `last_error`
 * starting with core's `TRUNCATED_NOTE`). Never defaulted: a price without the flag is invalid.
 */
export const priceCellSchema = z.object({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  truncated: z.boolean(),
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
/** Every host a vendor or search link may name (spec §5.2), across providers. */
const LINK_HOSTS: readonly string[] = Object.values(LINK_ALLOWLIST).flat();
/**
 * Spec §5.2 vendor links, re-validated on the wire (plan decision 54): https, no userinfo, no port, a host equal to or
 * under a `LINK_ALLOWLIST` entry. A stored value that fails never reaches a client as a link.
 */
export const vendorLinkSchema = z
  .url()
  .refine(
    (u) => validateVendorUrl(u, LINK_HOSTS).kind !== 'none',
    'link must be https on an allowlisted host',
  );
/**
 * The booking as an adapter stored it (spec §6.3): any URL. The db reads with this, so one bad stored link never fails a
 * whole page; the api re-validates it and the wire schema below refuses it (plan decision 54).
 */
export const storedBookingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('get'), url: z.url(), host: z.string() }),
  z.object({ kind: z.literal('post'), url: z.url(), postData: z.string(), host: z.string() }),
  z.object({ kind: z.literal('none') }),
]);
export const bookingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('get'), url: vendorLinkSchema, host: z.string() }),
  z.object({ kind: z.literal('post'), url: vendorLinkSchema, postData: z.string(), host: z.string() }),
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
  /** The run's own policy, "(E outbounds each)" in the Results header (decision 42); never the current definition's. */
  expandTop: z.number().int().min(1),
  /**
   * Spec §7, §8.2 rev 36: the firing a scheduled row stands for (a start, a catch-up, a skip; moved only by a live-tick
   * resume), else null; with `isCatchUp`, the missed firing a catch-up ran for.
   */
  scheduledFor: isoDateTimeSchema.nullable(),
  isCatchUp: z.boolean(),
  /** Spec §8.2 rev 36: why a `skipped_missed` firing was not caught up, as the row recorded it; null otherwise. */
  skipCode: z.enum(SKIP_CODES).nullable(),
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
  'priceConfirmed',
]);
export const verdictSchema = z.enum(['pass', 'fail', 'unverified']);
export const verdictsSchema = z.partialRecord(constraintNameSchema, verdictSchema);
export const verdictClassSchema = z.enum(['verified', 'partially-verified', 'failed']);
export const resultBasisSchema = z.enum(['verified', 'calendar']);
export const capabilityInfoSchema = z.object({
  sourceKind: sourceKindSchema,
  provenanceNote: z.string(),
  maxAgeHours: z.union([z.number().int().min(0), z.literal('unknown')]),
  /** Ruling 17 (pie-007): `maxAgeHours` is the app's assumption, not a vendor-stated bound. */
  maxAgeAssumed: z.boolean().optional(),
});
export { cabinSchema, providerIdSchema };
