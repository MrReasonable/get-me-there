import { z } from 'zod';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { provenanceSchema } from '../types/provenance.js';
import {
  ageHoursSchema,
  cabinSchema,
  cronSchema,
  executionStatusSchema,
  moneyPenceSchema,
  providerIdSchema,
} from './common.js';
import { definitionFields, definitionResponseSchema, refineDefinition } from './definitions.js';
import { stopTextSchema } from './stopCause.js';

// Spec revision 55 §10: the first screen's cards (`GET /definitions/cards`) and Search now's one press
// (`POST /definitions/create-and-start`). The route table entries and their handlers arrive with Task 20.2.

const count = z.number().int().min(0);
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
 * A card's latest parent run. The counts are over that run's snapshot space by `datePairSearched` (§6.6): searched by
 * this run, and never searched by any run, so the two never sum past the run's date pairs. `stop` is the stored cause's
 * text (`stopText`, or `NO_STOP_CAUSE_TEXT` for a stopped row without one), non-null only on a stopped status;
 * `estimatedFinishAt` is now plus the run's remaining seconds while it is pending or running.
 */
const latestRunSchema = z
  .strictObject({
    id: z.string(),
    status: executionStatusSchema,
    trigger: z.enum(['manual', 'schedule', 'tool']),
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    datePairs: count,
    datePairsSearched: count,
    datePairsNeverSearched: count,
    flights: z
      .strictObject({ planned: count, read: count })
      .refine((f) => f.read <= f.planned, {
        message: 'flights read must not exceed flights planned',
        path: ['read'],
      })
      .nullable(),
    estimatedFinishAt: isoDateTimeSchema.nullable(),
    stop: stopTextSchema.nullable(),
  })
  .refine((r) => r.datePairsSearched + r.datePairsNeverSearched <= r.datePairs, {
    message: 'date pairs searched and never searched must not exceed the date pairs',
    path: ['datePairsSearched'],
  });

/**
 * The card's cheapest figure: the board's first-ranked figure through the same ranking, with its full provenance, its
 * staleness by the per-price rule (`stalenessOf`), its age, basis, dates and airport pair, and whether the latest run
 * found it.
 */
const cardCheapestSchema = z.strictObject({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  basis: z.enum(['verified', 'calendar']),
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
  origin: iataSchema,
  destination: iataSchema,
  fromLatestRun: z.boolean(),
});

/**
 * Spec revision 55 §10 `GET /definitions/cards`: one card of the first screen. `schedule` is non-null only when the
 * search is scheduled (`isScheduled`); `discovery` the sources it names; `spaceChangedSince` whether its space changed
 * after its latest run started. Strict throughout: no field carries `error_text`, a key, a password or a path.
 */
export const searchCardSchema = z.strictObject({
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
  cheapest: cardCheapestSchema.nullable(),
});
export type SearchCard = z.infer<typeof searchCardSchema>;

/** The cards in the order the api owns (running first, then by the latest run's start, then never-run searches). */
export const searchCardsResponseSchema = z.strictObject({ cards: z.array(searchCardSchema) });
export type SearchCardsResponse = z.infer<typeof searchCardsResponseSchema>;

/**
 * Spec revision 55 §10 `POST /definitions/create-and-start`: the create body without the stored confirmation's pair
 * (a press confirms this run only; the api stores the shown runnable totals itself), plus the figures the press
 * confirmed and an idempotency key. Strict, so a body naming `confirmedCostPence` or `confirmedCalls` is refused
 * rather than silently dropped. `confirmCalls: 0` is a valid shape (a free search with no capped calls).
 */
export const createAndStartRequestSchema = z
  .strictObject(definitionFields)
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
