import { apiContract as c } from '@gmt/core';
import { call } from './client.js';
import type {
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
};
