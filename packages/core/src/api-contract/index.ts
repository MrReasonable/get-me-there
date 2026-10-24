import type { z } from 'zod';
import { airportsQuerySchema, airportsResponseSchema } from './airports.js';
import {
  alertEventSchema,
  alertEventsQuerySchema,
  alertRuleInputSchema,
  alertRuleSchema,
  alertRulesQuerySchema,
  alertRuleUpdateRequestSchema,
} from './alerts.js';
import {
  coverageCheckRequestSchema,
  coverageCheckResponseSchema,
  definitionCreateOptionalSchema,
  definitionCreateRequestSchema,
  definitionResponseSchema,
  definitionUpdateRequestSchema,
  estimateResponseSchema,
} from './definitions.js';
import {
  activeExecutionResponseSchema,
  executionResponseSchema,
  startExecutionRequestSchema,
  startExecutionResponseSchema,
  verifyCellRequestSchema,
} from './executions.js';
import {
  calendarGapResponseSchema,
  calendarQuerySchema,
  calendarResponseSchema,
  cellDetailResponseSchema,
  coverageResponseSchema,
  durationAnalysisResponseSchema,
  itineraryHistoryResponseSchema,
  resultsQuerySchema,
  resultsResponseSchema,
  routeHistoryQuerySchema,
  routeHistoryResponseSchema,
} from './results.js';
import {
  budgetResponseSchema,
  healthResponseSchema,
  providersResponseSchema,
  schedulerJobsResponseSchema,
  smokePlanResponseSchema,
  toolRecordRequestSchema,
  toolRunResponseSchema,
  toolSmokeRequestSchema,
} from './system.js';

export * from './airports.js';
export * from './alerts.js';
export * from './common.js';
export * from './definitions.js';
export * from './executions.js';
export * from './results.js';
export * from './system.js';

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** starts with /api/ */
  path: string;
  request?: z.ZodType;
  query?: z.ZodType;
  response: z.ZodType;
  auth: 'public' | 'required';
}
const route = (
  method: RouteDef['method'],
  path: string,
  response: z.ZodType,
  extra: Partial<Pick<RouteDef, 'request' | 'query' | 'auth'>> = {},
): RouteDef => ({
  method,
  path: `/api${path}`,
  response,
  auth: 'required',
  ...extra,
});
const deleted = definitionResponseSchema.pick({ id: true, deletedAt: true });
/** One entry per spec §10 row; api mounts these, web derives its client from them. */
export const ROUTES: readonly RouteDef[] = [
  route('GET', '/health', healthResponseSchema, { auth: 'public' }),
  route('GET', '/airports', airportsResponseSchema, { query: airportsQuerySchema }),
  route('GET', '/providers', providersResponseSchema),
  route('GET', '/definitions', definitionResponseSchema.array()),
  route('POST', '/definitions', definitionResponseSchema, { request: definitionCreateOptionalSchema }),
  route('POST', '/definitions/estimate', estimateResponseSchema, { request: definitionCreateRequestSchema }),
  route('POST', '/definitions/coverage-check', coverageCheckResponseSchema, {
    request: coverageCheckRequestSchema,
  }),
  route('GET', '/definitions/:id', definitionResponseSchema),
  route('PUT', '/definitions/:id', definitionResponseSchema, { request: definitionUpdateRequestSchema }),
  route('DELETE', '/definitions/:id', deleted),
  route('POST', '/definitions/:id/estimate', estimateResponseSchema),
  route('POST', '/definitions/:id/executions', startExecutionResponseSchema, {
    request: startExecutionRequestSchema,
  }),
  // why: before '/executions/:id', so the static path is never read as an execution id
  route('GET', '/executions/active', activeExecutionResponseSchema),
  route('GET', '/executions/:id', executionResponseSchema),
  route('POST', '/executions/:id/cancel', executionResponseSchema),
  route('POST', '/executions/:id/resume', executionResponseSchema),
  route('POST', '/cells/verify', startExecutionResponseSchema, { request: verifyCellRequestSchema }),
  route('GET', '/definitions/:id/results', resultsResponseSchema, { query: resultsQuerySchema }),
  route('GET', '/definitions/:id/calendar', calendarResponseSchema, { query: calendarQuerySchema }),
  route('GET', '/definitions/:id/duration-analysis', durationAnalysisResponseSchema),
  route('GET', '/definitions/:id/coverage', coverageResponseSchema),
  route('GET', '/definitions/:id/calendar-gap', calendarGapResponseSchema),
  route(
    'GET',
    '/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
    cellDetailResponseSchema,
  ),
  route('POST', '/tools/smoke', toolRunResponseSchema, { request: toolSmokeRequestSchema }),
  route('GET', '/tools/smoke/plan', smokePlanResponseSchema),
  route('POST', '/tools/record', toolRunResponseSchema, { request: toolRecordRequestSchema }),
  route('GET', '/itineraries/:hash/history', itineraryHistoryResponseSchema),
  route('GET', '/routes/:origin/:destination/history', routeHistoryResponseSchema, {
    query: routeHistoryQuerySchema,
  }),
  route('GET', '/alerts', alertRuleSchema.array(), { query: alertRulesQuerySchema }),
  route('POST', '/alerts', alertRuleSchema, { request: alertRuleInputSchema }),
  route('PUT', '/alerts/:id', alertRuleSchema, { request: alertRuleUpdateRequestSchema }),
  route('DELETE', '/alerts/:id', alertRuleSchema),
  route('GET', '/alerts/events', alertEventSchema.array(), { query: alertEventsQuerySchema }),
  route('GET', '/scheduler/jobs', schedulerJobsResponseSchema),
  route('GET', '/budget', budgetResponseSchema),
];
