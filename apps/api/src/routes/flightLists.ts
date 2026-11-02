/**
 * Spec revision 55 §10 (WP20 Task 20.9): `GET /definitions/:id/flight-lists` (the flights on a search's page) and
 * `POST /definitions/:id/flight-lists` (one date pair's flight list read on demand, §8.1 "Reading one date pair's
 * flights"). The POST answers 202 `{ accepted: true }` once the read has started; its refusals are the engine's codes.
 */
import { apiContract } from '@gmt/core';
import type { FlightReadStart } from '@gmt/engine';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError } from '../errors.js';
import { assembleFlightLists, parsePairs } from '../read/flightLists.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, route } from './define.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

type Refusal = Extract<FlightReadStart, { ok: false }>;

/** Spec §10: each refusal's status and wire code (`busy` is `browser_busy` on the wire; ruling A33 for the reason). */
const REFUSED: Record<Refusal['code'], { status: ContentfulStatusCode; code: string; message: string }> = {
  busy: { status: 409, code: 'browser_busy', message: API_TEXT.browserBusy },
  fresh: { status: 409, code: 'fresh', message: API_TEXT.flightsFresh },
  not_available: { status: 409, code: 'not_available', message: API_TEXT.flightsNotAvailable },
  outside_space: { status: 422, code: 'outside_space', message: API_TEXT.datePairOutsideSpace },
  no_price: { status: 422, code: 'no_price', message: API_TEXT.flightsNoPrice },
  not_found: { status: 404, code: 'definition_not_found', message: API_TEXT.definitionNotFound },
  'shutting-down': { status: 503, code: 'shutting-down', message: API_TEXT.shuttingDown },
};

export const flightListHandlers: HandlerTable = {
  'GET /api/definitions/:id/flight-lists': route(
    { request: NO_INPUT, query: apiContract.flightListsQuerySchema },
    (c, input, ctx) => {
      const def = getLiveDefinition(ctx, param(input, 'id'));
      return c.json(assembleFlightLists(def, parsePairs(input.query.pairs), ctx.ports, ctx.engine));
    },
  ),
  'POST /api/definitions/:id/flight-lists': route(
    { request: apiContract.readFlightListRequestSchema, query: NO_INPUT },
    async (c, input, ctx) => {
      const def = getLiveDefinition(ctx, param(input, 'id'));
      const r = await ctx.engine.readFlightList(def.id, input.body);
      if (r.ok) return c.json({ accepted: true as const }, 202);
      const m = REFUSED[r.code];
      throw new ApiError(
        m.status,
        m.code,
        m.message,
        r.code === 'not_available' ? { reason: r.reason } : undefined,
      );
    },
  ),
};
