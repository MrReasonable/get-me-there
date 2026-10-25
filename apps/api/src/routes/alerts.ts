/** Spec §6.8, §10 alert rule storage and events; evaluation and delivery are WP11's. */
import { type AlertRule, apiContract } from '@gmt/core';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

function requireDefinition(ctx: RouteContext, id: string): void {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(
      422,
      'definition_not_found',
      API_TEXT.definitionNotFound,
      fieldsDetail([{ field: 'definitionId', message: API_TEXT.definitionNotFound }]),
    );
}

function getRule(ctx: RouteContext, id: string): AlertRule {
  const rule = ctx.ports.repos.alerts.get(id);
  if (rule === null) throw new ApiError(404, 'alert_not_found', API_TEXT.alertNotFound);
  return rule;
}

export const alertHandlers: HandlerTable = {
  /**
   * Spec §10: one fixed test message through the configured email notifier, inside ALERT_EMAIL_MAX_PER_HOUR (429 past
   * it); 409 when email is not configured. The class and time are kept in the process ("since the app started"); the
   * server's own text is never returned or kept.
   */
  'POST /api/alerts/test-email': plain(async (c, _input, ctx) => {
    if (ctx.ports.config.smtp === null || ctx.email === null)
      throw new ApiError(409, 'email_not_configured', API_TEXT.emailNotConfigured);
    const result = await ctx.email.sendTest();
    // why: V7 — a test send has its own one-a-minute limit apart from the alert ceiling; the notifier keeps the result
    if (result === 'refused') throw new ApiError(429, 'email_limit', API_TEXT.emailLimit);
    return c.json({ result, at: ctx.ports.clock.now() });
  }),

  'GET /api/alerts': route(
    { request: NO_INPUT, query: apiContract.alertRulesQuerySchema },
    (c, { query }, ctx) => c.json(ctx.ports.repos.alerts.rules(query.definitionId)),
  ),

  'POST /api/alerts': route(
    { request: apiContract.alertRuleInputSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      requireDefinition(ctx, body.definitionId);
      return c.json(ctx.ports.repos.alerts.create(body), 201);
    },
  ),

  'PUT /api/alerts/:id': route(
    { request: apiContract.alertRuleUpdateRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const { id, ...current } = getRule(ctx, param(input, 'id'));
      // why: validate the merged rule, so a partial update cannot slip past the requireAllVerified refinement (spec §6.8).
      const merged = apiContract.alertRuleInputSchema.safeParse({ ...current, ...input.body });
      if (!merged.success)
        throw new ApiError(
          422,
          'invalid_alert_rule',
          API_TEXT.validation('body'),
          fieldsDetail(issuesToFields(merged.error.issues)),
        );
      if (merged.data.definitionId !== current.definitionId) requireDefinition(ctx, merged.data.definitionId);
      return c.json(ctx.ports.repos.alerts.update(id, merged.data));
    },
  ),

  'DELETE /api/alerts/:id': plain((c, input, ctx) => {
    const existing = getRule(ctx, param(input, 'id'));
    // why: alert rules soft-delete so their events stay readable (plan decision 15).
    ctx.ports.repos.alerts.softDelete(existing.id);
    return c.json(existing);
  }),

  // why: events are read generically through WP3's repository and validated by the contract's `alertEventSchema`, so
  // the route works before and after WP11's migration 0002 (statuses `queued | notified | suppressed`) and needs no
  // change when WP11 adds `alertEventPayloadSchema` (decision 56).
  'GET /api/alerts/events': route(
    { request: NO_INPUT, query: apiContract.alertEventsQuerySchema },
    (c, { query }, ctx) =>
      c.json(
        ctx.ports.repos.alerts.events({
          ...(query.ruleId === undefined ? {} : { ruleId: query.ruleId }),
          ...(query.definitionId === undefined ? {} : { definitionId: query.definitionId }),
          limit: query.limit ?? 100,
        }),
      ),
  ),
};
