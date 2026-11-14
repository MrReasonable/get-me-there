/**
 * Design 2026-11-08 §6.1 (plan Task 5): `GET /definitions/:id/trip`, one pair of dates of a search in one call, from
 * the board's own rules: the figure the search page's row shows (the board's one composition), the flight list it came
 * from with its booking address, the cells' coverage classes, the calendar and cached prices for these dates and a log
 * of the runs and reads that touched them. Every price carries its provenance (`priceCellSchema`).
 */
import { z } from 'zod';
import { PAIRING_KINDS } from '../datePairs/pairing.js';
import { flightLimitsSchema } from '../flights/choose.js';
import { flightTextSchema } from '../flights/types.js';
import { MAX_URL_LENGTH } from '../normalise/vendorUrl.js';
import type { CellOutcomeStatus, SkipReason } from '../types/execution.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { bookingSchema, countSchema, priceCellSchema, vendorLinkSchema } from './common.js';
import { datePairFigureSchema } from './datePairs.js';
import { flightListSchema } from './flights.js';
import { STOP_DETAILS } from './stopCause.js';

/**
 * The wire form of the query, every value a string as Hono's `c.req.query()` gives it, under the scope names the
 * date-pairs and `/results` reads take. The api parses each and answers 422 itself (`invalid_date_pair`,
 * `unknown_airport`, `invalid_journey_limit`), so only length bounds live here; the dates' bound leaves room for a
 * malformed one to reach the api's 422 rather than the route wrapper's 400.
 */
export const tripQuerySchema = z.strictObject({
  departureDate: z.string().max(40),
  returnDate: z.string().max(40),
  /** comma list of the definition's origins */
  origins: z.string().max(200).optional(),
  /** comma list of the definition's destinations */
  destinations: z.string().max(200).optional(),
  /** an integer from 60 to 6000 */
  maxJourneyMinutes: z.string().max(10).optional(),
});
export type TripQuery = z.infer<typeof tripQuerySchema>;

/** A cell's class over the scope (spec §6.6): one of the six buckets a date pair's airport pairs sum to. */
const BUCKETS = [
  'priced',
  'empty',
  'no_data',
  'error',
  'skipped',
  'not_run',
] as const satisfies readonly CellOutcomeStatus[];
/** Why a cell was skipped (spec §3), every `SkipReason` once (the contract test pins it to the union). */
export const SKIP_REASONS = [
  'not_selected',
  'budget',
  'provider_disabled',
  'provider_unavailable',
  'scheduled_only',
  'departed',
] as const satisfies readonly SkipReason[];
export const skipReasonSchema = z.enum(SKIP_REASONS);

/**
 * A price with whether a later search found its cell empty (decision 54: "Not seen again"), and the airport pair it was
 * read for (final review I4: About names it when it is not the card's).
 */
const seenPriceSchema = priceCellSchema.extend({
  notSeenAgain: z.boolean(),
  origin: iataSchema,
  destination: iataSchema,
});

/**
 * What one run's (or one by-hand read's) flight list said of these dates, by the list reads core already defines:
 * a leading-or-older candidate is a `trip` with its one price and kind; `failed` (`list-failed`) with its cause;
 * `outbound-only`; `no-return` (`no-pairing-read`); `none-within` (`over-limit`); `other-limits`
 * (`within-other-limits`); `not-read` (the run read no list for these dates; why is not recorded).
 */
const logFlightsSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('trip'),
    price: priceCellSchema,
    pairingKind: z.enum(PAIRING_KINDS),
    seller: flightTextSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('failed'), cause: z.enum(STOP_DETAILS) }),
  z.strictObject({ kind: z.literal('outbound-only') }),
  z.strictObject({ kind: z.literal('no-return') }),
  z.strictObject({ kind: z.literal('none-within') }),
  z.strictObject({ kind: z.literal('other-limits') }),
  z.strictObject({ kind: z.literal('not-read') }),
]);

/** A search link re-validated on the way out (decision 54): the Google Flights search for the dates. */
const searchLinkSchema = z.strictObject({ url: vendorLinkSchema, host: z.string(), label: z.string() });

/**
 * `GET /definitions/:id/trip`'s answer. `inWindow` is the board's window test (Ruling 4: departs after today and inside
 * the search's current dates); when false the date-specific fields are null or empty and `read.wouldGo` is false.
 * `figure` and `journeyLeftOut` are exactly the board's (`datePairFigureOf`); `flightList` is the newest list of the
 * figure's own cell, or of the read cell when there is no figure (Ruling 3), and `bookingUrl` its chosen pairing's
 * (Ruling 5); `listFailure` is that list when it failed.
 */
export const tripResponseSchema = z.strictObject({
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
  nights: countSchema,
  inWindow: z.boolean(),
  figure: datePairFigureSchema.nullable(),
  journeyLeftOut: countSchema,
  listFailure: z.strictObject({ at: isoDateTimeSchema, cause: z.enum(STOP_DETAILS) }).nullable(),
  /** one per airport pair of these dates in scope, in generation order */
  cells: z.array(
    z.strictObject({
      origin: iataSchema,
      destination: iataSchema,
      bucket: z.enum(BUCKETS),
      /** exactly on a skipped cell */
      skipReason: skipReasonSchema.nullable(),
    }),
  ),
  flightList: flightListSchema.nullable(),
  bookingUrl: z.string().max(MAX_URL_LENGTH).nullable(),
  searchLink: searchLinkSchema.nullable(),
  /**
   * Final review I2: the Google Flights search for the figure's own airport pair and dates, which a verified price
   * links to without a seller's booking (`searchLink` is the flight list's cell's, maybe another pair); null with no
   * figure
   */
  figureSearchLink: searchLinkSchema.nullable(),
  /** a verified figure's own booking, re-validated (decision 54); null on every other basis */
  booking: bookingSchema.nullable(),
  /**
   * the newest calendar price for these dates from a live calendar source (any but the Aviasales cache), in the
   * figure's own cell when the figure is calendar-based (a calendar or pairing figure), else in the flight list's cell
   */
  calendar: seenPriceSchema.nullable(),
  /** the newest Aviasales cached price for these dates, in the same cell as `calendar` */
  cached: seenPriceSchema.nullable(),
  /** newest first: one row per run that priced or read these dates, and one per by-hand flight read */
  log: z.array(
    z.strictObject({
      at: isoDateTimeSchema,
      byHand: z.boolean(),
      calendar: priceCellSchema.nullable(),
      flights: logFlightsSchema,
    }),
  ),
  /** an on-demand read is in flight for these dates */
  reading: z.boolean(),
  read: z.strictObject({
    available: z.boolean(),
    unavailableReason: z.enum(['not-named', 'not-configured', 'cabin']).nullable(),
    /** the search page's `readNow` rule for these dates */
    wouldGo: z.boolean(),
    pagesPlanned: countSchema,
    /**
     * The airport pair a read from the Trip page names: the cell `flightList` is read for (the one whose flight read the
     * board's figure carries, else the figure's own, else the read cell); null when there is none
     */
    origin: iataSchema.nullable(),
    destination: iataSchema.nullable(),
  }),
  verificationConfigured: z.boolean(),
  refreshHours: countSchema,
  limits: flightLimitsSchema,
});
export type TripResponse = z.infer<typeof tripResponseSchema>;
