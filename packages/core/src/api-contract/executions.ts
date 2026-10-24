import { z } from 'zod';
import { SKIP_CODES } from '../types/execution.js';
import { isoDateTimeSchema } from '../types/ids.js';
import {
  bucketsSchema,
  cellKeySchema,
  executionStatusSchema,
  microGbpSchema,
  moneyPenceSchema,
  providerIdSchema,
  stageSchema,
  usageSchema,
} from './common.js';
import { estimateSchema } from './definitions.js';

const count = z.number().int().min(0);
export const executionResponseSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  isChild: z.boolean(),
  cell: cellKeySchema.nullable(),
  status: executionStatusSchema,
  stage: stageSchema.nullable(),
  reason: z.string().nullable(),
  resumeAfter: isoDateTimeSchema.nullable(),
  trigger: z.enum(['manual', 'schedule', 'tool']),
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
/** Decision 37: a manual start confirms the pence and the calls the operator saw; one without the other covers nothing. */
export const startExecutionRequestSchema = z.object({
  confirmCostPence: moneyPenceSchema.optional(),
  confirmCalls: z.number().int().min(0).optional(),
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
