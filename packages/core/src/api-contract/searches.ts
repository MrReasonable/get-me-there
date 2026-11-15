import { z } from 'zod';
import type { ReducedMark } from '../datePairs/marks.js';
import { isTrip } from '../datePairs/views.js';
import { priceLabelKind } from '../labels/priceLabel.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { pointOfSaleSchema } from '../types/provenance.js';
import {
  cabinSchema,
  countSchema,
  cronSchema,
  executionStatusSchema,
  moneyPenceSchema,
  priceCellSchema,
  providerIdSchema,
  stageSchema,
  triggerSchema,
} from './common.js';
import { datePairFigureSchema, verifiedDetailSchema } from './datePairs.js';
import { definitionRequestFields, definitionResponseSchema, refineDefinition } from './definitions.js';
import { executionFlightsSchema } from './executions.js';
import { stopTextSchema } from './stopCause.js';

// Spec revision 55 §10: the first screen's cards (`GET /definitions/cards`) and Search now's one press
// (`POST /definitions/create-and-start`). The route table entries and their handlers arrive with Task 20.2.

const count = countSchema;
const nights = z.number().int().min(0).max(90);

/**
 * A card's window, resolved: its kind, the departure dates it covers today and, for a relative window, its offset and
 * length (null on an absolute window, non-null on a relative one).
 */
const cardWindowSchema = z
  .strictObject({
    kind: z.enum(['absolute', 'relative']),
    departureFrom: isoDateSchema,
    departureTo: isoDateSchema,
    startOffsetDays: count.nullable(),
    // why: a relative window's length is at least one day, as `windowSpecSchema` stores it (review B2f)
    lengthDays: z.number().int().min(1).nullable(),
  })
  .superRefine((w, ctx) => {
    const relative = w.kind === 'relative';
    if ((w.startOffsetDays !== null) !== relative || (w.lengthDays !== null) !== relative) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'a relative window has offsets; an absolute one has none',
      });
    }
    if (w.departureTo < w.departureFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['departureTo'],
        message: 'departureTo must not be before departureFrom',
      });
    }
  });

/**
 * Ruling 7: how many date pairs of the run's whole snapshot space read each of core's five marks (`reducedMark` over the
 * date pair's airport pairs, `markCounts`). Every mark is present.
 */
const marksSchema = z.strictObject({
  priced: count,
  'no-price-shown': count,
  'couldnt-read': count,
  'not-reached': count,
  'not-searched': count,
}) satisfies z.ZodType<Record<ReducedMark, number>>;

/**
 * A card's latest parent run. The counts are over that run's snapshot space by `datePairSearched` (§6.6): searched by
 * this run, and never searched by any run, so the two never sum past the run's date pairs. `marks` (Ruling 7) are the
 * run's five marks over that space, summing to its date pairs, the searched count being its priced and no-price marks;
 * `browserUnavailable` counts the date pairs it did not reach because the browser was unavailable (each airport pair
 * skipped, none for the budget, at least one for the browser's absence: `provider_unavailable` or `scheduled_only`),
 * so it is at most the not-reached mark. `stop` is the stored cause's text (`stopText`, or `NO_STOP_CAUSE_TEXT` for a
 * stopped row without one), non-null only on a stopped status; `estimatedFinishAt` is now plus the run's remaining
 * seconds while it is pending or running.
 */
const latestRunSchema = z
  .strictObject({
    id: z.string(),
    status: executionStatusSchema,
    trigger: triggerSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    datePairs: count,
    datePairsSearched: count,
    datePairsNeverSearched: count,
    // why: final review M1: the stage the run is at, as `GET /executions/:id` gives it, so a card says "Checking fares"
    // by the page's rule (null before the run has one)
    stage: stageSchema.nullable(),
    // why: ruling R-reading — the run's flight counts as `GET /executions/:id` gives them, so the card and the page
    // word "Reading flights" by one rule
    flights: executionFlightsSchema.nullable(),
    estimatedFinishAt: isoDateTimeSchema.nullable(),
    stop: stopTextSchema.nullable(),
    marks: marksSchema,
    browserUnavailable: count,
  })
  .refine((r) => r.datePairsSearched + r.datePairsNeverSearched <= r.datePairs, {
    message: 'date pairs searched and never searched must not exceed the date pairs',
    path: ['datePairsSearched'],
  })
  .refine((r) => Object.values(r.marks).reduce((a, b) => a + b, 0) === r.datePairs, {
    message: 'the marks sum to the date pairs',
    path: ['marks'],
  })
  // why: §6.6: searched is exactly priced or no price shown, so the card's two counts are one count
  .refine((r) => r.datePairsSearched === r.marks.priced + r.marks['no-price-shown'], {
    message: 'date pairs searched are the priced and no-price marks',
    path: ['datePairsSearched'],
  })
  .refine((r) => r.browserUnavailable <= r.marks['not-reached'], {
    message: 'a date pair the browser was unavailable for is not reached',
    path: ['browserUnavailable'],
  });

/**
 * Ruling 7: one of a card's trips, the board's figure for its date pair (`cheapestTrips`, in rank order), less its
 * airport-pair index, with the board's per-figure rules; a trip with flights read (`isTrip`): a pairing figure, or a
 * current verified one. The figure holds its airports and `fromEarlierSearch`.
 */
const cardTripSchema = z
  .strictObject({
    figure: datePairFigureSchema,
    departureDate: isoDateSchema,
    returnDate: isoDateSchema,
    nights,
  })
  .refine((t) => isTrip(t.figure), {
    message: 'a card trip is a trip with flights read',
    path: ['figure'],
  });

/** The label kinds a calendar price takes when it is current (`priceLabelKind`): its own source's. */
const CALENDAR_KINDS = ['calendar', 'cached'] as const;

/**
 * Rulings 5 and 7: the dates that look lower on the calendar than the card's trips (`lowerOnCalendar`): how many, and the
 * lowest, a full price cell (never a bare number) with its dates, airports and label kind (`priceLabelKind` of a
 * current calendar price: `cached` for the Aviasales cache, `calendar` for any other source).
 */
const lowerOnCalendarSchema = z.strictObject({
  count: z.number().int().min(1),
  cheapest: z
    .strictObject({
      price: priceCellSchema,
      departureDate: isoDateSchema,
      returnDate: isoDateSchema,
      origin: iataSchema,
      destination: iataSchema,
      kind: z.enum(CALENDAR_KINDS),
    })
    .refine(
      (c) =>
        priceLabelKind({ kind: 'calendar', providerId: c.price.provenance.providerId }, false) === c.kind,
      { message: "the kind is the calendar price's own source's", path: ['kind'] },
    ),
});

/**
 * Spec revision 55 §10 `GET /definitions/cards`: one card of the first screen. `schedule` is non-null only when the
 * search is scheduled (`isScheduled`); `discovery` the sources it names; `spaceChangedSince` whether its space changed
 * after its latest run started. Ruling 7: `trips` are up to three trips with flights read, in the board's rank order;
 * `verifiedDetails` one entry for each verified trip among them, in order (Ruling 2: its legs and booking, a seller's
 * exactly when its figure has booking options); `readDates` how many date pairs in view have flights read
 * (`flightsRead`, across every search so far), so never fewer than the trips; `lowerOnCalendar` the dates that look
 * lower on the calendar, or null when none does. Strict throughout: no field carries `error_text`, a key, a password or
 * a path.
 */
export const searchCardSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    origins: z.array(iataSchema),
    destinations: z.array(iataSchema),
    window: cardWindowSchema,
    minNights: nights,
    maxNights: nights,
    cabin: cabinSchema,
    schedule: z.strictObject({ cron: cronSchema, tz: z.string().min(1) }).nullable(),
    discovery: z.array(providerIdSchema),
    latestRun: latestRunSchema.nullable(),
    spaceChangedSince: z.boolean(),
    trips: z.array(cardTripSchema).max(3),
    verifiedDetails: z.array(verifiedDetailSchema).max(3),
    readDates: count,
    lowerOnCalendar: lowerOnCalendarSchema.nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.readDates < c.trips.length)
      ctx.addIssue({ code: 'custom', path: ['readDates'], message: 'every trip has its flights read' });
    // why: Ruling 2, as `/date-pairs` holds it: one detail for each verified trip, in the trips' order, named by its
    // dates and airports; a pairing trip has none, nor a verified figure refused as a trip (reported on its figure)
    const named = (dep: string, ret: string, origin: string, destination: string) =>
      `${dep}|${ret}|${origin}|${destination}`;
    const verified = c.trips.flatMap(({ departureDate, returnDate, figure: f }) =>
      f.basis === 'verified' && isTrip(f)
        ? [{ name: named(departureDate, returnDate, f.origin, f.destination), seller: f.hasBookingOptions }]
        : [],
    );
    c.verifiedDetails.forEach((d, k) => {
      const want = verified[k];
      if (want === undefined || want.name !== named(d.departureDate, d.returnDate, d.origin, d.destination))
        ctx.addIssue({
          code: 'custom',
          path: ['verifiedDetails', k],
          message: 'verified details name the verified trips, in their order',
        });
      else if ((d.booking.kind !== 'none') !== want.seller)
        ctx.addIssue({
          code: 'custom',
          path: ['verifiedDetails', k, 'booking'],
          message: "a verified detail's booking is a seller's exactly when its figure has booking options",
        });
    });
    if (verified.length > c.verifiedDetails.length)
      ctx.addIssue({
        code: 'custom',
        path: ['verifiedDetails'],
        message: 'one verified detail for each verified trip',
      });
  });
export type SearchCard = z.infer<typeof searchCardSchema>;

/**
 * The cards in the order the api owns (running first, then by the latest run's start, then never-run searches), and the
 * install's POINT_OF_SALE (fix round 1 of Task 2, as `/date-pairs` carries it): the market of the Google Flights search
 * a card's trip falls back to.
 */
export const searchCardsResponseSchema = z.strictObject({
  cards: z.array(searchCardSchema),
  pointOfSale: pointOfSaleSchema,
});
export type SearchCardsResponse = z.infer<typeof searchCardsResponseSchema>;

/**
 * Spec revision 55 §10 `POST /definitions/create-and-start`: the create body without the stored confirmation's pair
 * (a press confirms this run only; the api stores the shown runnable totals itself), plus the figures the press
 * confirmed and an idempotency key. Strict, so a body naming `confirmedCostPence` or `confirmedCalls` is refused
 * rather than silently dropped. `confirmCalls: 0` is a valid shape (a free search with no capped calls).
 */
export const createAndStartRequestSchema = z
  .strictObject(definitionRequestFields)
  .omit({ confirmedCostPence: true, confirmedCalls: true })
  .extend({ confirmCostPence: moneyPenceSchema, confirmCalls: count, requestKey: z.uuid() })
  .superRefine(refineDefinition);
export type CreateAndStartRequest = z.infer<typeof createAndStartRequestSchema>;

/** Why a start was refused; the web words each code (no message travels with it). */
export const startRefusalCodes = ['cap', 'confirm', 'window', 'disabled', 'shutting-down', 'failed'] as const;
export type StartRefusalCode = (typeof startRefusalCodes)[number];

/**
 * Create-and-start's answer: the saved search, and either the run it started or the refusal (never both, never
 * neither), with the figures the refusal's words need.
 */
export const createAndStartResponseSchema = z
  .strictObject({
    definition: definitionResponseSchema,
    executionId: z.string().nullable(),
    refusal: z
      .strictObject({
        code: z.enum(startRefusalCodes),
        estimatePence: moneyPenceSchema.nullable(),
        totalCalls: count.nullable(),
        resetsAt: isoDateTimeSchema.nullable(),
      })
      .nullable(),
  })
  .refine((r) => (r.executionId === null) !== (r.refusal === null), {
    message: 'exactly one of executionId and refusal',
    path: ['refusal'],
  });
export type CreateAndStartResponse = z.infer<typeof createAndStartResponseSchema>;
