import { z } from 'zod';
import { isoDateTimeSchema } from '../types/ids.js';
import { provenanceSchema } from '../types/provenance.js';
import { constraintNameSchema, moneyPenceSchema, resultBasisSchema, verdictClassSchema } from './common.js';

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
// why: the create schema defaults cooldownHours to 336; zod 4 applies a default inside .partial() too, so a body naming
// only `enabled` would silently reset a custom cooldown. The update shape therefore carries no default.
export const alertRuleUpdateRequestSchema = z
  .object({ ...ruleFields, cooldownHours: ruleFields.cooldownHours.unwrap() })
  .partial();
export const alertEventSchema = z.object({
  id: z.number().int(),
  ruleId: z.string(),
  identityKey: z.string(),
  observationId: z.number().int().nullable(),
  calendarPriceId: z.number().int().nullable(),
  dedupKey: z.string(),
  firedAt: isoDateTimeSchema,
  status: z.enum(['queued', 'notified', 'suppressed']),
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

/**
 * Decision 56: the payload the alert runner (WP11, engine) stores on every alert event and the Alerts view (WP11, web)
 * reads; one schema, no local copies. The fare and the previous price each carry their provenance, so the view prints
 * both through PriceCell (decision 52). Marks are stored as facts the view can re-judge later: the stale threshold
 * that applied (core's isStale recomputes against now) and the instant of the newer search that did not see the fare.
 */
export const alertEventPayloadSchema = z.object({
  /** The digest the event went out in; null for a suppressed event. */
  digestId: z.string().nullable(),
  executionId: z.string(),
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  /** The price a drop was measured against, or the out-of-window price of a "new" cell; null when none. */
  previous: z.object({ pricePence: moneyPenceSchema, provenance: provenanceSchema }).nullable(),
  /** Listed in the digest's "new" section (spec §6.8 absent-then-present); never a drop firing. */
  isNew: z.boolean(),
  /** The cell in words, e.g. "LHR→JFK 14 Mar–28 Mar (14n)". */
  route: z.string(),
  /** The results row's vocabulary (verdictClassSchema plus 'unchecked'); `failed` never fires (decision 59). */
  verdictClass: z.union([verdictClassSchema.exclude(['failed']), z.literal('unchecked')]),
  unverified: z.array(constraintNameSchema),
  /** Reason parts: what fired, and the whole hours between the previous fetch and this one when a previous price exists. */
  reason: z.object({
    kind: z.enum(['threshold', 'drop', 'new']),
    gapHours: z.number().int().min(0).nullable(),
  }),
  /** The basis threshold this price is judged against (decisions 54, 55). */
  staleThresholdHours: z.number().int().min(1),
  /** From a discovery tile the page cap cut short: "cheapest of the rows read" (decision 30). */
  truncated: z.boolean(),
  /** A newer itinerary search of the cell did not see this fare; `at` is that search's fetch instant when known. */
  notSeenInLatest: z.object({ at: isoDateTimeSchema.nullable() }).nullable(),
});
export type AlertEventPayload = z.output<typeof alertEventPayloadSchema>;
