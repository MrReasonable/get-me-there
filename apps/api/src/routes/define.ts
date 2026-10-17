/** One validation per request (plan decision 54): each handler declares the ROUTES schemas and receives their output. */
import type { Context } from 'hono';
import { z } from 'zod';
import { envelope, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { AppEnv, RouteContext, RouteHandler } from './types.js';

/** The schema of an input a route does not take: only `undefined` passes. Shared, so createApp can compare identity. */
export const NO_INPUT = z.undefined();

/** The validated inputs a handler receives, typed from its schemas. */
export interface Input<B extends z.ZodType, Q extends z.ZodType> {
  body: z.output<B>;
  query: z.output<Q>;
  params: Record<string, string>;
}

/**
 * Defines a handler over the ROUTES entry's `request` and `query` (pass `NO_INPUT` for one the route does not take).
 * The body and the query are parsed here, once; a refusal is the 400 `validation` envelope with `details.fields`.
 * why: the table-driven mount loses Hono's static input types; binding the schema objects to the handler keeps the
 * types without a cast, and createApp refuses a handler whose schemas are not the ROUTES entry's own.
 */
export function route<B extends z.ZodType, Q extends z.ZodType>(
  schemas: { request: B; query: Q },
  run: (c: Context<AppEnv>, input: Input<B, Q>, ctx: RouteContext) => Response | Promise<Response>,
): RouteHandler {
  return {
    request: schemas.request,
    query: schemas.query,
    handle: (c, raw, ctx) => {
      const body = schemas.request.safeParse(raw.body);
      if (!body.success)
        return c.json(
          envelope(
            'validation',
            API_TEXT.validation('body'),
            fieldsDetail(issuesToFields(body.error.issues)),
          ),
          400,
        );
      const query = schemas.query.safeParse(raw.query);
      if (!query.success)
        return c.json(
          envelope(
            'validation',
            API_TEXT.validation('query'),
            fieldsDetail(issuesToFields(query.error.issues)),
          ),
          400,
        );
      return run(c, { body: body.data, query: query.data, params: raw.params }, ctx);
    },
  };
}

/** A route without a body or a query. */
export function plain(
  run: (
    c: Context<AppEnv>,
    input: Input<typeof NO_INPUT, typeof NO_INPUT>,
    ctx: RouteContext,
  ) => Response | Promise<Response>,
): RouteHandler {
  return route({ request: NO_INPUT, query: NO_INPUT }, run);
}
