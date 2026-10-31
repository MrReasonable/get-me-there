import { z } from 'zod';
import { SKIP_CODES } from '../types/execution.js';
import { isoDateTimeSchema } from '../types/ids.js';
import {
  bucketsSchema,
  cellKeySchema,
  countSchema,
  executionStatusSchema,
  microGbpSchema,
  moneyPenceSchema,
  providerIdSchema,
  stageSchema,
  triggerSchema,
  usageSchema,
} from './common.js';
import { estimateSchema } from './definitions.js';

const count = countSchema;
export const executionResponseSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  isChild: z.boolean(),
  cell: cellKeySchema.nullable(),
  status: executionStatusSchema,
  stage: stageSchema.nullable(),
  reason: z.string().nullable(),
  resumeAfter: isoDateTimeSchema.nullable(),
  trigger: triggerSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  errorText: z.string().nullable(),
  /** Review S8: the firing the row stands for and, on a missed firing, why it was not caught up, as History names them. */
  scheduledFor: isoDateTimeSchema.nullable(),
  isCatchUp: z.boolean(),
  skipCode: z.enum(SKIP_CODES).nullable(),
  progress: z.array(
    z.object({ stage: stageSchema, providerId: providerIdSchema, buckets: bucketsSchema, total: count }),
  ),
  budget: z.array(usageSchema),
  estimate: estimateSchema.nullable(),
  ledger: z.object({
    calls: count,
    costMicroGbp: microGbpSchema,
    costPence: moneyPenceSchema,
    tiles: count,
    cacheHits: count,
    perProvider: z.array(
      z.object({
        providerId: providerIdSchema,
        stage: stageSchema.nullable(),
        calls: count,
        costMicroGbp: microGbpSchema,
      }),
    ),
  }),
  parityBreak: z.boolean(),
  overrun: z.boolean(),
  disabledProviders: z.array(providerIdSchema),
});
/**
 * Decision 37: a manual start confirms the pence and the calls the operator saw; one without the other covers nothing.
 * Spec revision 55 §8.1 (Search again): `requireCovered` refuses `confirm` whenever the runnable estimate exceeds the
 * confirmation in pence or calls (the press confirms exactly the figures beside the button, for that run only), and
 * `replaceStopped` supersedes a stopped (`paused_*` or `interrupted`) latest run of the search with a fresh start, in
 * one transaction. Both optional, so every existing caller is unchanged; the route passes them to `StartOptions`.
 */
export const startExecutionRequestSchema = z.object({
  confirmCostPence: moneyPenceSchema.optional(),
  confirmCalls: z.number().int().min(0).optional(),
  requireCovered: z.boolean().optional(),
  replaceStopped: z.boolean().optional(),
});
export const startExecutionResponseSchema = z.object({ executionId: z.string() });
/** WP7: a single-cell verification above SOFT_CONFIRM needs the confirmation a start would, pence and calls together. */
export const verifyCellRequestSchema = z.object({
  definitionId: z.string(),
  cell: cellKeySchema,
  confirmCostPence: moneyPenceSchema.optional(),
  confirmCalls: z.number().int().min(0).optional(),
});

/**
 * Spec §10 `GET /api/executions/active` (decision 80: `gmt update` reads it): the oldest execution with a pass in flight,
 * a parent run (`run`) or a single-cell verification (`cell-verification`, which spends credits too), with its estimated
 * finish: now plus the seconds its remaining cells are estimated to take, so a resumed run never reads as finished in the
 * past; null without an estimate. `execution` is null when nothing is in flight.
 */
export const activeExecutionResponseSchema = z.strictObject({
  execution: z
    .strictObject({
      // why: ids are plain strings across the contract (executionResponseSchema's own), so no new id schema is minted
      id: z.string(),
      definitionId: z.string(),
      definitionName: z.string(),
      kind: z.enum(['run', 'cell-verification']),
      startedAt: isoDateTimeSchema,
      estimatedFinishAt: isoDateTimeSchema.nullable(),
    })
    .nullable(),
});
