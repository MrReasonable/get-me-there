/** Spec §10 history routes. */
import { apiContract, iataSchema } from '@gmt/core';
import { ApiError } from '../errors.js';
import { itineraryHistory, routeHistory } from '../read/history.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { param } from './shared.js';
import type { HandlerTable } from './types.js';

export const historyHandlers: HandlerTable = {
  'GET /api/itineraries/:hash/history': plain((c, input, ctx) =>
    c.json(itineraryHistory(param(input, 'hash'), ctx.ports)),
  ),

  'GET /api/routes/:origin/:destination/history': route(
    { request: NO_INPUT, query: apiContract.routeHistoryQuerySchema },
    (c, input, ctx) => {
      const o = iataSchema.safeParse(param(input, 'origin'));
      const d = iataSchema.safeParse(param(input, 'destination'));
      if (!o.success || !d.success) throw new ApiError(400, 'validation', API_TEXT.validation('path'));
      return c.json(routeHistory(o.data, d.data, input.query.cabin ?? 'economy', ctx.ports));
    },
  ),
};
