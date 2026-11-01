import { HttpResponse, http, type JsonBodyType } from 'msw';
import {
  API,
  airports,
  budgetResponse,
  calendarGap,
  coverageCheck,
  coverageResponse,
  definition,
  estimateResponse,
  execution,
  providersResponse,
  resultsResponse,
  statusReport,
} from '../fixtures.js';
import { datesHandlers } from './datesHandlers.js';
import { searchesHandlers } from './searchesHandlers.js';
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
    body: estimateResponse(),
  },
  // WP20 Task 20.5 R2: a saved search's estimate, of its draft or as stored
  { method: 'POST', path: '/api/definitions/:id/estimate', body: estimateResponse() },
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
  // WP19: the Dates view's route, the worked example
  ...datesHandlers,
  // WP20: the first screen's cards, Remove and Undo
  ...searchesHandlers,
  http.get(url('/api/alerts'), () => HttpResponse.json([])),
  http.get(url('/api/alerts/events'), () => HttpResponse.json([])),
  http.get(url('/api/budget'), () => HttpResponse.json(budgetResponse())),
  http.get(url('/api/providers'), () => HttpResponse.json(providersResponse())),
  // WP18: a clean report, so the status bar's link shows nothing unless a test says otherwise
  http.get(url('/api/status'), () => HttpResponse.json(statusReport())),
  http.get(url('/api/definitions'), () => HttpResponse.json([definition()])),
  http.get(url('/api/definitions/:id/results'), () => HttpResponse.json(resultsResponse())),
  http.get(url('/api/executions/:id'), () =>
    HttpResponse.json(
      // why: the run the date-pairs fixtures summarise (runSummary): started 12:00, finished 13:00 (UTC)
      execution({
        status: 'completed',
        stage: 'verification',
        startedAt: '2026-10-14T12:00:00.000Z',
        finishedAt: '2026-10-14T13:00:00.000Z',
      }),
    ),
  ),
  http.get(url('/api/definitions/:id/coverage'), () => HttpResponse.json(coverageResponse())),
  http.get(url('/api/definitions/:id/calendar-gap'), () => HttpResponse.json(calendarGap({ cells: [] }))),
  http.get(url('/api/airports'), () => HttpResponse.json(airports)),
  ...MUTATIONS.map((m) =>
    (m.method === 'POST' ? http.post : http.put)(url(m.path), () => HttpResponse.json(m.body)),
  ),
];
