import { HttpResponse, http, type JsonBodyType } from 'msw';
import {
  API,
  airports,
  calendarGap,
  coverageCheck,
  coverageResponse,
  definition,
  estimate,
  execution,
  providersResponse,
  resultsResponse,
} from '../fixtures.js';
import { wp10Handlers } from './wp10Handlers.js';

/** A valid response body for each mutation the views send. */
const MUTATIONS: ReadonlyArray<{ method: 'POST' | 'PUT'; path: string; body: JsonBodyType }> = [
  { method: 'POST', path: '/api/executions/:id/cancel', body: execution({ status: 'cancelled' }) },
  { method: 'POST', path: '/api/executions/:id/resume', body: execution({ status: 'running' }) },
  { method: 'POST', path: '/api/definitions/:id/executions', body: { executionId: 'exec-0002' } },
  { method: 'POST', path: '/api/cells/verify', body: { executionId: 'exec-child-1' } },
  {
    method: 'POST',
    path: '/api/definitions/estimate',
    body: { estimate: estimate(), budgetFit: definition().budgetFit },
  },
  { method: 'POST', path: '/api/definitions/coverage-check', body: coverageCheck() },
  { method: 'POST', path: '/api/definitions', body: definition({ id: 'def-0002' }) },
  { method: 'PUT', path: '/api/definitions/:id', body: definition() },
];

/** The body a default handler returns for a mutation; tests reuse it when they override a handler. */
export function fixtureFor(method: 'POST' | 'PUT', path: string): JsonBodyType {
  const m = MUTATIONS.find((x) => x.method === method && x.path === path);
  if (m === undefined) throw new Error(`no fixture body for ${method} ${path}`);
  return m.body;
}

/** Handler URLs are absolute: API already ends in /api, and the paths start with it. */
const url = (path: string) => `${API}${path.slice('/api'.length)}`;

/** Default API: one definition, both providers, a completed run with two itinerary rows. */
export const handlers = [
  ...wp10Handlers,
  http.get(url('/api/providers'), () => HttpResponse.json(providersResponse())),
  http.get(url('/api/definitions'), () => HttpResponse.json([definition()])),
  http.get(url('/api/definitions/:id/results'), () => HttpResponse.json(resultsResponse())),
  http.get(url('/api/executions/:id'), () =>
    HttpResponse.json(
      execution({ status: 'completed', stage: 'verification', finishedAt: '2026-10-14T13:00:00.000Z' }),
    ),
  ),
  http.get(url('/api/definitions/:id/coverage'), () => HttpResponse.json(coverageResponse())),
  http.get(url('/api/definitions/:id/calendar-gap'), () => HttpResponse.json(calendarGap({ cells: [] }))),
  http.get(url('/api/airports'), () => HttpResponse.json(airports)),
  ...MUTATIONS.map((m) =>
    (m.method === 'POST' ? http.post : http.put)(url(m.path), () => HttpResponse.json(m.body)),
  ),
];
