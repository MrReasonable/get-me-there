import { z } from 'zod';
import { iataSchema, isoDateTimeSchema, isoMonthSchema } from '../types/ids.js';
import {
  capabilityInfoSchema,
  cronSchema,
  microGbpSchema,
  moneyPenceSchema,
  providerIdSchema,
  usageSchema,
} from './common.js';
import { executionBudgetSchema, providersConfigSchema } from './definitions.js';

const count = z.number().int().min(0);
/** Unauthenticated shape (spec §10): no detail that could leak. */
export const healthPublicSchema = z.strictObject({ ok: z.boolean(), degraded: z.boolean() });
export const healthDetailSchema = z.object({
  ok: z.boolean(),
  degraded: z.boolean(),
  db: z.object({ ok: z.boolean(), sizeBytes: count }),
  providers: z.array(
    z.object({ providerId: providerIdSchema, configured: z.boolean(), healthy: z.boolean().nullable() }),
  ),
  scheduler: z.object({
    jobCount: count,
    nextRun: isoDateTimeSchema.nullable(),
    lastExecutionAt: isoDateTimeSchema.nullable(),
    degraded: z.boolean(),
    blockedSince: isoDateTimeSchema.nullable(),
  }),
});
export const healthResponseSchema = z.union([healthPublicSchema, healthDetailSchema]);
export const providersResponseSchema = z.object({
  providers: z.array(
    z.object({
      providerId: providerIdSchema,
      displayName: z.string(),
      enabled: z.boolean(),
      capabilities: z.object({
        discovery: capabilityInfoSchema.nullable(),
        verification: capabilityInfoSchema.nullable(),
      }),
      plan: z.enum(['trial', '40usd', 'free', 'synthetic']),
      usage: z.array(usageSchema),
      excludedFromSchedule: z.boolean(),
      notices: z.array(z.string()),
    }),
  ),
  synthetic: z.boolean(),
  presets: z.object({
    policy: z.object({
      maxCells: count,
      topN: count,
      expandTop: z.number().int().min(1),
      bookingLinks: z.boolean(),
    }),
    providers: providersConfigSchema,
    budget: executionBudgetSchema,
    discoveryRefreshHours: z.number().int().min(1),
    schedulerTimezone: z.string(),
  }),
  pointOfSale: z.string(),
});
export const budgetResponseSchema = z.object({
  scopes: z.array(usageSchema),
  monthlyCapMicroGbp: microGbpSchema,
  monthlyCapPence: moneyPenceSchema,
  fixedFeesMicroGbp: microGbpSchema,
  ceilingNote: z.string(),
});
export const schedulerJobSchema = z.object({
  id: z.string(),
  kind: z.enum(['definition', 'resume']),
  definitionId: z.string(),
  executionId: z.string().nullable(),
  cron: cronSchema.nullable(),
  tz: z.string(),
  nextRun: isoDateTimeSchema.nullable(),
});
export const schedulerJobsResponseSchema = z.object({ jobs: z.array(schedulerJobSchema) });
export const toolRecordRequestSchema = z.object({
  budget: z.number().int().min(1),
  origins: z.array(iataSchema).min(1),
  destinations: z.array(iataSchema).min(1),
  month: isoMonthSchema,
});
/**
 * Spec §9 item 7, §10 `/tools/smoke`: the smoke's two airports; as for recording, the SearchApi credits tool runs may
 * have ledgered in the provider's budget window, this run included (plan decision 20); and `dryRun`, which prints the
 * spend position and the plan and sends nothing (plan decision 66).
 */
export const toolSmokeRequestSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  budget: z.number().int().min(1),
  dryRun: z.boolean().optional(),
});
export const toolRunResponseSchema = z.object({
  exitCode: z.number().int().min(0),
  summary: z.string(),
  lines: z.array(z.string()),
  fixturesWritten: z.array(z.string()),
});

export type SchedulerJob = z.infer<typeof schedulerJobSchema>;
