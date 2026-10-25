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
      /** Ruling 5: on a billed plan whose calls cost £0, which call cap is the hard stop; null otherwise. */
      capNote: z.string().nullable(),
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
  /**
   * The smoke's: the SearchApi credits tool runs already ledgered in this budget window when it checked its spend
   * (decision 20's running total, which `gmt smoke` prints and confirms; U7). Null for a refusal before that check and
   * for `record`.
   */
  searchApiCreditsLedgered: z.number().int().min(0).nullable(),
});
/**
 * Spec §10 `GET /api/tools/smoke/plan` (ledgers nothing; `gmt smoke` prints it before it asks): the smoke's worst case
 * per configured provider, from the tool's own `smokeWorstCase`. SearchApi credits are split into the calendar tile and
 * the itinerary chain, with the trial's remaining lifetime credits (null off the trial); Travelpayouts' free calls; the
 * browser pages and, in grid mode, the scroll allowance (0 in list mode). A provider not configured is null.
 */
export const smokePlanResponseSchema = z.strictObject({
  searchApi: z
    .strictObject({
      calendar: z.number().int().min(0),
      itinerary: z.number().int().min(0),
      trialLeft: z.number().int().min(0).nullable(),
    })
    .nullable(),
  travelpayouts: z.strictObject({ freeCalls: z.number().int().min(0) }).nullable(),
  camoufox: z.strictObject({ pages: z.number().int().min(0), scrolls: z.number().int().min(0) }).nullable(),
});

/**
 * Spec §10 `GET /api/status` (brief WP18 §5): one report of what works, how much of each search the last finished run
 * covered, and what to do about what does not. Every summary comes from a fixed template; no field carries a key, a
 * password, a database path or a `SOCS` value.
 */
export const statusStateSchema = z.enum(['ok', 'warn', 'fail', 'off']);
export const statusAreaSchema = z.enum([
  'app',
  'database',
  'backups',
  'schedule',
  'data',
  'provider',
  'worker',
  'consent',
  'email',
]);
export const statusCheckSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    area: statusAreaSchema,
    providerId: providerIdSchema.nullable(),
    state: statusStateSchema,
    /** What distinguishes the card when its area has several (a search definition's name); null otherwise. */
    label: z.string().max(200).nullable(),
    // why: never cut a fact a state rests on (review V6): the longest summary is well under this
    summary: z.string().max(600),
    /** An aside on any check, such as "first daily backup due 03:30"; it never counts toward the status bar. */
    note: z.string().max(600).nullable(),
    /** Only when `state` is `off`: why nothing is checked. */
    offReason: z.enum(['not-set-up', 'not-visible', 'awaiting-verification', 'disabled']).nullable(),
    fix: z
      .strictObject({
        text: z.string().max(200),
        command: z.string().startsWith('pnpm gmt ').nullable(),
      })
      .nullable(),
  })
  .refine((c) => (c.state === 'off') === (c.offReason !== null), {
    message: 'offReason is set exactly when the state is off',
    path: ['offReason'],
  });
export const statusResponseSchema = z.strictObject({
  generatedAt: isoDateTimeSchema,
  mode: z.enum(['native', 'container', 'dev']),
  version: z.string(),
  checks: z.array(statusCheckSchema),
});
/** Spec §10 `POST /api/alerts/test-email`: the class of the send (a refusal at the hourly ceiling is a 429, not this). */
export const testEmailResponseSchema = z.strictObject({
  result: z.enum(['sent', 'failed']),
  at: isoDateTimeSchema,
});

export type StatusState = z.infer<typeof statusStateSchema>;
export type StatusArea = z.infer<typeof statusAreaSchema>;
export type StatusCheck = z.infer<typeof statusCheckSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export type SchedulerJob = z.infer<typeof schedulerJobSchema>;
