/** Spec §10 read routes over a definition's executions: results (Task 8.12 adds the four views and the cell detail). */
import { apiContract } from '@gmt/core';
import { assembleResults } from '../read/results.js';
import { NO_INPUT, route } from './define.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': route(
    { request: NO_INPUT, query: apiContract.resultsQuerySchema },
    (c, input, ctx) =>
      c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), input.query, ctx.ports)),
  ),
};
