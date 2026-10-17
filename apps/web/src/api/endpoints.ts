import { type Cabin, type CellKey, apiContract as c, type Iata } from '@gmt/core';
import { call } from './client.js';
import type {
  AlertRuleBody,
  Basis,
  CoverageCheckBody,
  DefinitionBody,
  DefinitionUpdateBody,
  StartExecutionBody,
  VerifyCellBody,
} from './types.js';

/**
 * One wrapper per spec §10 route the WP9 views use. Each names its ROUTES path template and the
 * contract schema of that route's response; `call` checks the pair and parses with it.
 */
export const api = {
  providers: () => call(c.providersResponseSchema, 'GET', '/api/providers'),
  definitions: () => call(c.definitionResponseSchema.array(), 'GET', '/api/definitions'),
  estimateDraft: (body: DefinitionBody) =>
    call(c.estimateResponseSchema, 'POST', '/api/definitions/estimate', { body }),
  createDefinition: (body: DefinitionBody) =>
    call(c.definitionResponseSchema, 'POST', '/api/definitions', { body }),
  updateDefinition: (id: string, body: DefinitionUpdateBody) =>
    call(c.definitionResponseSchema, 'PUT', '/api/definitions/:id', { params: { id }, body }),
  coverageCheck: (body: CoverageCheckBody) =>
    call(c.coverageCheckResponseSchema, 'POST', '/api/definitions/coverage-check', { body }),
  startExecution: (id: string, body: StartExecutionBody) =>
    call(c.startExecutionResponseSchema, 'POST', '/api/definitions/:id/executions', { params: { id }, body }),
  execution: (id: string) =>
    call(c.executionResponseSchema, 'GET', '/api/executions/:id', { params: { id } }),
  cancel: (id: string) =>
    call(c.executionResponseSchema, 'POST', '/api/executions/:id/cancel', { params: { id } }),
  resume: (id: string) =>
    call(c.executionResponseSchema, 'POST', '/api/executions/:id/resume', { params: { id } }),
  verifyCell: (body: VerifyCellBody) =>
    call(c.startExecutionResponseSchema, 'POST', '/api/cells/verify', { body }),
  results: (id: string, basis: Basis | null) =>
    call(c.resultsResponseSchema, 'GET', '/api/definitions/:id/results', {
      params: { id },
      query: { basis: basis ?? undefined },
    }),
  coverage: (id: string) =>
    call(c.coverageResponseSchema, 'GET', '/api/definitions/:id/coverage', { params: { id } }),
  calendarGap: (id: string) =>
    call(c.calendarGapResponseSchema, 'GET', '/api/definitions/:id/calendar-gap', { params: { id } }),
  airports: (q: string) => call(c.airportsResponseSchema, 'GET', '/api/airports', { query: { q } }),
  // WP10 (spec §10; plan decision 53): both bases per day, for one destination when given, else every destination.
  calendar: (id: string, destination: Iata | null) =>
    call(c.calendarResponseSchema, 'GET', '/api/definitions/:id/calendar', {
      params: { id },
      query: { destination: destination ?? undefined },
    }),
  durationAnalysis: (id: string) =>
    call(c.durationAnalysisResponseSchema, 'GET', '/api/definitions/:id/duration-analysis', {
      params: { id },
    }),
  cellDetail: (id: string, k: CellKey) =>
    call(
      c.cellDetailResponseSchema,
      'GET',
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      {
        params: {
          id,
          origin: k.origin,
          destination: k.destination,
          departureDate: k.departureDate,
          returnDate: k.returnDate,
        },
      },
    ),
  itineraryHistory: (hash: string) =>
    call(c.itineraryHistoryResponseSchema, 'GET', '/api/itineraries/:hash/history', { params: { hash } }),
  // why: routeHistoryQuerySchema { cabin?: Cabin }; the view always passes the definition's cabin.
  routeHistory: (origin: string, destination: string, cabin: Cabin) =>
    call(c.routeHistoryResponseSchema, 'GET', '/api/routes/:origin/:destination/history', {
      params: { origin, destination },
      query: { cabin },
    }),
  alertRules: (definitionId: string) =>
    call(c.alertRuleSchema.array(), 'GET', '/api/alerts', { query: { definitionId } }),
  createAlertRule: (body: AlertRuleBody) => call(c.alertRuleSchema, 'POST', '/api/alerts', { body }),
  // why: DELETE soft-deletes the rule (AlertsRepo.softDelete); its events stay listed.
  deleteAlertRule: (id: string) => call(c.alertRuleSchema, 'DELETE', '/api/alerts/:id', { params: { id } }),
  alertEvents: (definitionId: string, limit: number) =>
    call(c.alertEventSchema.array(), 'GET', '/api/alerts/events', {
      query: { definitionId, limit: String(limit) },
    }),
};
