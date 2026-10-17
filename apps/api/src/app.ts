/** The single HTTP surface of spec §10, mounted from `@gmt/core` api-contract ROUTES. */
import { apiContract } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { envelope, notFound, onError } from './errors.js';
import { basicAuthGate, clientIpFrom, FailedAuthLimiter } from './middleware/auth.js';
import { hostAllowlist, mutatingRequestCheck, noStore, originCheck } from './middleware/hardening.js';
import { securityHeaders } from './middleware/headers.js';
import { NO_INPUT } from './routes/define.js';
import { HANDLERS } from './routes/index.js';
import {
  API_PREFIX,
  type AppEnv,
  type HttpToolRunners,
  OWNED_ELSEWHERE,
  type RawInput,
  type RouteContext,
} from './routes/types.js';
import { mountStatic } from './static.js';
import { API_TEXT } from './text.js';
import type { Ports } from './wiring.js';

export { API_PREFIX };

/** The largest request body the api reads (review SEC-1): a definition is a few kilobytes; nothing needs more. */
export const MAX_BODY_BYTES = 64 * 1024;

export interface AppOptions {
  /** Directory of the built SPA (`apps/web/dist`); null serves no static files. */
  webRoot?: string | null;
  tools?: HttpToolRunners;
  /** Source IP for the failed-auth limit; tests inject it, production derives it from the socket or the proxy. */
  clientIp?: (c: Context<AppEnv>) => string | null;
  /** The route table to mount; defaults to `apiContract.ROUTES`. Tests pass a modified table. */
  routes?: readonly apiContract.RouteDef[];
}

export function publicRouteKeys(routes: readonly apiContract.RouteDef[]): Set<string> {
  return new Set(routes.filter((r) => r.auth === 'public').map((r) => `${r.method} ${r.path}`));
}

/** The JSON body of a route that takes one: undefined when empty, a 400 envelope when it is not JSON. */
async function readBody(c: Context<AppEnv>): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await c.req.text();
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The single HTTP surface (spec §10): one Hono app mounting every ROUTES entry from `@gmt/core` api-contract (paths
 * carry `/api`), each body and query validated once by its handler against the entry's own schemas (decision 54), the
 * error envelope, the spec §4 hardening and the auth gate. Strict: a ROUTES entry without a handler (unless another
 * package owns it), a handler without a ROUTES entry, or a handler whose schemas are not its entry's refuses to build.
 */
export function createApp(ports: Ports, engine: Engine, options: AppOptions = {}): Hono<AppEnv> {
  const routes = options.routes ?? apiContract.ROUTES;
  const ctx: RouteContext = {
    ports,
    engine,
    tools: options.tools ?? {},
    busy: new Set(),
  };
  const app = new Hono<AppEnv>();
  app.onError(onError(ports.log, ports.secrets));
  app.notFound(notFound);
  const publicKeys = publicRouteKeys(routes);
  const isPublic = (c: Context<AppEnv>) => publicKeys.has(`${c.req.method} ${c.req.path}`);
  // why: ROUTES paths carry /api, so the public key is 'GET /api/health'.
  // Order (spec §4, decision 58): no-store first on API calls, so every API response carries it — the 401, 403, 413 and
  // 429 refusals included → headers on everything → Host → Origin → auth → body size, JSON + X-Requested-With.
  app.use(`${API_PREFIX}/*`, noStore());
  app.use('*', securityHeaders());
  app.use('*', hostAllowlist(ports.config, isPublic, ports.log));
  app.use('*', originCheck(ports.config, isPublic));
  app.use(
    '*',
    basicAuthGate({
      config: ports.config,
      publicKeys,
      limiter: new FailedAuthLimiter(ports.clock),
      clientIp: options.clientIp ?? clientIpFrom(ports.config),
    }),
  );
  app.use(
    `${API_PREFIX}/*`,
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(envelope('body_too_large', API_TEXT.bodyTooLarge), 413),
    }),
  );
  app.use(`${API_PREFIX}/*`, mutatingRequestCheck());
  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const key of Object.keys(HANDLERS)) {
    // why: a handler for a route the contract no longer has is dead code the web client cannot reach.
    if (!routeKeys.has(key)) throw new Error(`no route for handler ${key}`);
  }
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (OWNED_ELSEWHERE.has(key)) continue; // why: another package mounts it (plan decision 4: smoke is WP13's)
    const handler = HANDLERS[key];
    // why: spec §10 is the route table; an entry without a handler is a contract the api does not honour.
    if (handler === undefined) throw new Error(`no handler for ${key}`);
    // why: the handler validates with the schemas it was typed against; they must be the entry's own objects.
    if (handler.request !== (route.request ?? NO_INPUT) || handler.query !== (route.query ?? NO_INPUT))
      throw new Error(`handler for ${key} validates with schemas other than its ROUTES entry's`);
    app.on(route.method, route.path, async (c) => {
      let body: unknown;
      if (route.request !== undefined) {
        const read = await readBody(c);
        if (!read.ok) return c.json(envelope('validation', API_TEXT.malformedJson), 400);
        body = read.value;
      }
      const raw: RawInput = {
        body,
        query: route.query === undefined ? undefined : c.req.query(),
        params: c.req.param(),
      };
      return handler.handle(c, raw, ctx);
    });
  }
  if (options.webRoot) mountStatic(app, options.webRoot);
  return app;
}
