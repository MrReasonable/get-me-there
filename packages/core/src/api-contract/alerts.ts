import { z } from 'zod';
import { isoDateTimeSchema } from '../types/ids.js';
import { moneyPenceSchema, resultBasisSchema } from './common.js';

const ruleFields = {
  definitionId: z.string(),
  type: z.enum(['absolute', 'dropPct', 'dropAbs']),
  thresholdPence: moneyPenceSchema.nullable(),
  pct: z.number().min(0).max(100).nullable(),
  basis: resultBasisSchema,
  requireAllVerified: z.boolean().nullable(),
  cooldownHours: z.number().int().min(1).default(336),
  enabled: z.boolean(),
};
const refineRule = (
  r: {
    type: string;
    thresholdPence: number | null;
    pct: number | null;
    basis: string;
    requireAllVerified: boolean | null;
  },
  ctx: z.RefinementCtx,
) => {
  if ((r.type === 'absolute' || r.type === 'dropAbs') && r.thresholdPence === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['thresholdPence'],
      message: `${r.type} rules need thresholdPence`,
    });
  }
  if (r.type === 'dropPct' && r.pct === null)
    ctx.addIssue({ code: 'custom', path: ['pct'], message: 'dropPct rules need pct' });
  // why: spec §6.8: requireAllVerified is meaningful only when verdicts exist (verified basis).
  if (r.basis === 'calendar' && r.requireAllVerified !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['requireAllVerified'],
      message: 'requireAllVerified applies to the verified basis only',
    });
  }
};
/** Spec §6.8 rule. */
export const alertRuleInputSchema = z.object(ruleFields).superRefine(refineRule);
export const alertRuleSchema = z.object({ ...ruleFields, id: z.string() }).superRefine(refineRule);
/** PUT body: any subset of the rule fields; the merged rule is re-validated with alertRuleInputSchema by the route. */
export const alertRuleUpdateRequestSchema = z.object(ruleFields).partial();
export const alertEventSchema = z.object({
  id: z.number().int(),
  ruleId: z.string(),
  identityKey: z.string(),
  observationId: z.number().int().nullable(),
  calendarPriceId: z.number().int().nullable(),
  dedupKey: z.string(),
  firedAt: isoDateTimeSchema,
  status: z.enum(['sent', 'failed', 'suppressed']),
  reason: z.string().nullable(),
  payload: z.unknown(),
});
export const alertEventsQuerySchema = z.object({
  ruleId: z.string().optional(),
  definitionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
/** `GET /alerts?definitionId=`: one object, so handlers can name it. */
export const alertRulesQuerySchema = alertEventsQuerySchema.pick({ definitionId: true });
