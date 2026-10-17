/** Spec §4 request hardening: Host allowlist, Origin check, JSON and X-Requested-With on mutating calls; no caching. */
import type { Config, Logger } from '@gmt/core';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type Exempt = (c: Context<AppEnv>) => boolean;
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** True when `host` is one of ALLOWED_HOSTS (case-insensitive). */
export function hostAllowed(config: Config, host: string | undefined): boolean {
  return host !== undefined && config.allowedHosts.some((h) => h.toLowerCase() === host.toLowerCase());
}

/**
 * Spec §4 `ALLOWED_HOSTS`: the rejection names the received Host and the variable, never the allowed values (plan
 * decision 54); the values go to the log for the operator. The public GET /api/health is exempt.
 */
export function hostAllowlist(config: Config, exempt: Exempt, log: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (exempt(c)) return next();
    const host = c.req.header('host');
    if (hostAllowed(config, host)) return next();
    log.warn({ host: host ?? null, allowedHosts: config.allowedHosts }, 'Host not in ALLOWED_HOSTS');
    const shown = host === undefined || host === '' ? '(none)' : host;
    return c.json(envelope('host_not_allowed', API_TEXT.hostRejected(shown)), 403);
  };
}

/** Spec §4: `Origin`, when present, must name an allowed host. */
export function originCheck(config: Config, exempt: Exempt): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin === undefined || exempt(c)) return next();
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      host = origin; // why: "null" and garbage are compared as-is, so they never match
    }
    if (hostAllowed(config, host)) return next();
    return c.json(envelope('origin_not_allowed', API_TEXT.originRejected(origin)), 403);
  };
}

/** Authenticated API responses are private: never cached by a browser or a proxy (review SEC-8). */
export function noStore(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  };
}

/** Spec §4: mutating API routes need JSON and the custom header (a CSRF barrier for a basic-auth app). */
export function mutatingRequestCheck(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    if (!/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? ''))
      return c.json(envelope('content_type', API_TEXT.contentType), 415);
    if (c.req.header('x-requested-with') !== 'get-me-there')
      return c.json(envelope('requested_with', API_TEXT.requestedWith), 403);
    return next();
  };
}
