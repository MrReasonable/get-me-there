import { z } from 'zod';
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
