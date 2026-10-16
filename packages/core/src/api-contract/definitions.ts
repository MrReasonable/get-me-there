import { z } from 'zod';
import type { Estimate } from '../types/execution.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema, isoMonthSchema } from '../types/ids.js';
import {
  cabinSchema,
  cellKeySchema,
  cronSchema,
  microGbpSchema,
  moneyPenceSchema,
  providerIdSchema,
  stageSchema,
} from './common.js';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
const localTimeWindowSchema = z.object({ from: timeOfDay, to: timeOfDay });
const positiveInt = z.number().int().min(0);

/** Spec §6.1 windows: relative resolves at execution start; absolute is clamped to tomorrow. */
export const windowSpecSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('absolute'), from: isoDateSchema, to: isoDateSchema })
    .refine((w) => w.to >= w.from, { message: 'to must not be before from', path: ['to'] }),
  z.object({
    kind: z.literal('relative'),
    startOffsetDays: z.number().int().min(1),
    lengthDays: z.number().int().min(1).max(400),
  }),
]);
export const constraintsSchema = z.object({
  maxStops: positiveInt.exactOptional(),
  maxJourneyMinutes: z.number().int().min(1).exactOptional(),
  minLayoverMinutes: positiveInt.exactOptional(),
  maxLayoverMinutes: positiveInt.exactOptional(),
  noOvernightLayover: z.boolean().exactOptional(),
  departureWindowLocal: localTimeWindowSchema.exactOptional(),
  arrivalWindowLocal: localTimeWindowSchema.exactOptional(),
  noSelfTransfer: z.boolean().exactOptional(),
  noAirportChange: z.boolean().exactOptional(),
  includeAirlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).exactOptional(),
  excludeAirlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).exactOptional(),
  cabinBagRequired: z.boolean().exactOptional(),
  checkedBagRequired: z.boolean().exactOptional(),
  minCheckedBags: positiveInt.exactOptional(),
  maxPricePence: moneyPenceSchema.exactOptional(),
});
export const verificationPolicySchema = z
  .object({
    maxCells: positiveInt,
    topN: positiveInt,
    priceCeilingPence: moneyPenceSchema.exactOptional(),
    perDepartureDateBest: z.number().int().min(1).exactOptional(),
    alwaysInclude: z.array(cellKeySchema),
    expandTop: z.number().int().min(1),
    bookingLinks: z.boolean(),
    maxStops: positiveInt.exactOptional(),
  })
  .superRefine((v, ctx) => {
    if (v.topN > v.maxCells)
      ctx.addIssue({ code: 'custom', path: ['topN'], message: 'topN must not exceed maxCells' });
    if (v.alwaysInclude.length > v.maxCells) {
      ctx.addIssue({
        code: 'custom',
        path: ['alwaysInclude'],
        message: 'alwaysInclude must not exceed maxCells',
      });
    }
  });
export const executionBudgetSchema = z.object({
  maxCalls: positiveInt,
  maxFreeCalls: positiveInt,
  maxCostMicroGbp: microGbpSchema,
});
export const providersConfigSchema = z.object({
  discovery: z.array(providerIdSchema),
  verification: z.array(providerIdSchema),
  discoveryRefreshHours: z.partialRecord(providerIdSchema, z.number().int().min(1)),
});

const definitionFields = {
  name: z.string().min(1).max(120),
  origins: z.array(iataSchema).min(1),
  destinations: z.array(iataSchema).min(1),
  window: windowSpecSchema,
  minNights: z.number().int().min(0).max(90),
  maxNights: z.number().int().min(0).max(90),
  cabin: cabinSchema,
  constraints: constraintsSchema,
  verification: verificationPolicySchema,
  budget: executionBudgetSchema,
  providers: providersConfigSchema,
  destinationNotes: z.record(z.string(), z.string()),
  onwardCostPence: z.record(z.string(), moneyPenceSchema),
  scheduleCron: cronSchema.nullable(),
  scheduleTz: z.string().min(1),
  enabled: z.boolean(),
  /** the explicit confirmation from the create click; stored only when it covers the current estimate */
  confirmedCostPence: moneyPenceSchema.optional(),
  /** decision 37: the calls of that same confirmation; a confirmation covers a run only with both */
  confirmedCalls: positiveInt.optional(),
};
const refineDefinition = (
  d: {
    origins: string[];
    destinations: string[];
    minNights: number;
    maxNights: number;
    providers: { verification: string[] };
    verification: { bookingLinks: boolean };
  },
  ctx: z.RefinementCtx,
) => {
  if (d.origins.some((o) => d.destinations.includes(o))) {
    ctx.addIssue({
      code: 'custom',
      path: ['destinations'],
      message: 'origins and destinations must be disjoint',
    });
  }
  if (d.minNights > d.maxNights)
    ctx.addIssue({ code: 'custom', path: ['maxNights'], message: 'maxNights must be at least minNights' });
  // why: spec §5.4: step 3 can show an OTA below the airline fare, so SearchApi verification always fetches booking options.
  if (d.providers.verification.includes('searchapi') && !d.verification.bookingLinks) {
    ctx.addIssue({
      code: 'custom',
      path: ['verification', 'bookingLinks'],
      message: 'bookingLinks must be true when searchapi verifies',
    });
  }
};
/** The unrefined field shape: used to read stored rows back, where the save-time policy refinements must not run. */
export const definitionShapeSchema = z
  .object(definitionFields)
  .omit({ confirmedCostPence: true, confirmedCalls: true });
export const definitionCreateRequestSchema = z.object(definitionFields).superRefine(refineDefinition);
export const definitionUpdateRequestSchema = z.object(definitionFields).partial();

export const budgetFitSchema = z.object({
  fits: z.boolean(),
  runsPerMonth: z.number().min(0),
  perScope: z.array(
    z.object({
      scope: z.string(),
      estimated: z.number().min(0),
      cap: z.number().int().min(0).nullable(),
      fits: z.boolean(),
    }),
  ),
});
export const estimateSchema: z.ZodType<Estimate> = z.object({
  cells: positiveInt,
  perProvider: z.array(
    z.object({
      providerId: providerIdSchema,
      stage: stageSchema,
      calls: positiveInt,
      planCalls: positiveInt,
      costMicroGbp: microGbpSchema,
      costPence: moneyPenceSchema,
      seconds: z.number().min(0),
      blocked: z.string().nullable(),
    }),
  ),
  totalCalls: positiveInt,
  totalPlanCalls: positiveInt,
  totalCostMicroGbp: microGbpSchema,
  totalCostPence: moneyPenceSchema,
  seconds: z.number().min(0),
  assumptions: z.array(z.string()),
  windowClamped: z.boolean(),
  retryFactor: z.number().min(1),
});
/** Both estimate routes return the estimate with its budget fit, so the form shows both before the create click. */
export const estimateResponseSchema = z.object({ estimate: estimateSchema, budgetFit: budgetFitSchema });
export const definitionResponseSchema = z.object({
  ...definitionFields,
  confirmedCostPence: moneyPenceSchema.nullable(),
  confirmedCalls: positiveInt.nullable(),
  id: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  budgetFit: budgetFitSchema,
  estimate: estimateSchema.nullable(),
  needsConfirmation: z
    .object({
      estimateMicroGbp: microGbpSchema,
      totalCalls: positiveInt,
      confirmedCostPence: moneyPenceSchema.nullable(),
      confirmedCalls: positiveInt.nullable(),
    })
    .nullable(),
  notices: z.array(z.string()),
});
export const coverageCheckRequestSchema = z.object({
  origins: z.array(iataSchema).min(1),
  destinations: z.array(iataSchema).min(1),
  window: windowSpecSchema,
  minNights: z.number().int().min(0).max(90),
  maxNights: z.number().int().min(0).max(90),
});
export const coverageCheckResponseSchema = z.object({
  pairs: z.array(
    z.object({
      origin: iataSchema,
      destination: iataSchema,
      months: z.array(z.object({ month: isoMonthSchema, cachedRows: positiveInt, cellsInBand: positiveInt })),
    }),
  ),
  calls: positiveInt,
  notes: z.array(z.string()),
});

export type BudgetFit = z.infer<typeof budgetFitSchema>;
export type CoverageCheckRequest = z.infer<typeof coverageCheckRequestSchema>;
export type CoverageCheckResponse = z.infer<typeof coverageCheckResponseSchema>;
export type DefinitionResponse = z.infer<typeof definitionResponseSchema>;
