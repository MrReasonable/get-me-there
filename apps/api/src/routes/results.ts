/** Spec §10 read routes over a definition's executions: results and the four views, and the cell detail. */
import { apiContract, type CellKey, iataSchema, isoDateSchema } from '@gmt/core';
import { ApiError } from '../errors.js';
import { assembleCalendar, assembleCalendarGap } from '../read/calendar.js';
import { assembleCellDetail } from '../read/cell.js';
import { assembleCoverage } from '../read/coverageView.js';
import { assembleDuration } from '../read/duration.js';
import { assembleResults } from '../read/results.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

/** Path parameters of the cell route; the route declares no params schema, so they are validated here. */
function cellFromPath(input: { params: Record<string, string> }): CellKey {
  const o = iataSchema.safeParse(param(input, 'origin'));
  const d = iataSchema.safeParse(param(input, 'destination'));
  const dep = isoDateSchema.safeParse(param(input, 'departureDate'));
  const ret = isoDateSchema.safeParse(param(input, 'returnDate'));
  if (!o.success || !d.success || !dep.success || !ret.success)
    throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return { origin: o.data, destination: d.data, departureDate: dep.data, returnDate: ret.data };
}

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': route(
    { request: NO_INPUT, query: apiContract.resultsQuerySchema },
    (c, input, ctx) =>
      c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), input.query, ctx.ports)),
  ),
  // why: plan decision 53: both bases come back per day; `destination` narrows the day to one destination's cells.
  'GET /api/definitions/:id/calendar': route(
    { request: NO_INPUT, query: apiContract.calendarQuerySchema },
    (c, input, ctx) =>
      c.json(
        assembleCalendar(getLiveDefinition(ctx, param(input, 'id')), input.query.destination, ctx.ports),
      ),
  ),
  'GET /api/definitions/:id/duration-analysis': plain((c, input, ctx) =>
    c.json(assembleDuration(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  ),
  'GET /api/definitions/:id/coverage': plain((c, input, ctx) =>
    c.json(assembleCoverage(getLiveDefinition(ctx, param(input, 'id')), ctx.ports, ctx.engine)),
  ),
  'GET /api/definitions/:id/calendar-gap': plain((c, input, ctx) =>
    c.json(assembleCalendarGap(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  ),
  'GET /api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate': plain((c, input, ctx) =>
    c.json(
      assembleCellDetail(
        getLiveDefinition(ctx, param(input, 'id')),
        cellFromPath(input),
        ctx.ports,
        ctx.engine,
      ),
    ),
  ),
};
