/** Spec §4 basic auth with the failed-auth rate limit. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock, Config, Secret } from '@gmt/core';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * Constant-time basic-auth check (spec §4). Both sides are hashed to equal-length digests so
 * `timingSafeEqual` never sees different lengths, and both comparisons always run.
 */
export function credentialsMatch(
  header: string | undefined,
  expected: { user: string; pass: Secret },
): 'absent' | 'valid' | 'invalid' {
  if (header === undefined) return 'absent';
  // why: RFC 7235 auth schemes are case-insensitive, so `basic` is the same scheme (security review Minor 2).
  const scheme = /^basic +/i.exec(header);
  if (scheme === null) return 'invalid';
  const decoded = Buffer.from(header.slice(scheme[0].length), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return 'invalid';
  const userOk = timingSafeEqual(digest(decoded.slice(0, colon)), digest(expected.user));
  const passOk = timingSafeEqual(digest(decoded.slice(colon + 1)), digest(expected.pass.reveal()));
  return userOk && passOk ? 'valid' : 'invalid';
}

/**
 * Spec §4, plan decision 54 and ruling 13 of decision 67: 5 failed sign-ins a minute per client IP (TRUST_PROXY-aware,
 * see `clientIpFrom`), with a global fallback of 20 a minute across all sources, so a guesser spreading attempts over
 * many addresses is slowed too. In memory: one process, one operator. A correct credential always succeeds, whatever
 * either bucket says, so spending the global bucket slows guessing but never locks the operator out. A request whose
 * IP is unknown (no socket, no trusted proxy header) shares one per-IP bucket.
 * Memory is bounded by age and by size (review SEC-R2-1): past `maxSources` addresses the least recently failing one is
 * dropped, in constant time, so a spray of spoofed addresses cannot grow the map or slow each failure. (With
 * TRUST_PROXY=true a client that reaches the app directly can choose its address, which defeats any per-IP limit: that
 * setting is safe only when the app is reachable through the proxy alone.)
 */
export class FailedAuthLimiter {
  private readonly byIp = new Map<string, number[]>();
  /** Every recent failure from any source, oldest first (the global fallback). */
  private all: number[] = [];
  constructor(
    private readonly clock: Clock,
    private readonly limits = { perIp: 5, global: 20, windowMs: 60_000, maxSources: 10_000 },
  ) {}

  private now(): number {
    return Date.parse(this.clock.now());
  }

  private recent(ip: string, now: number): number[] {
    const list = (this.byIp.get(ip) ?? []).filter((t) => now - t < this.limits.windowMs);
    if (list.length === 0) this.byIp.delete(ip);
    else this.byIp.set(ip, list);
    return list;
  }

  /** Seconds until the oldest of the last `limit` failures in `list` leaves the window, or null under the limit. */
  private wait(list: readonly number[], limit: number, now: number): number | null {
    if (list.length < limit) return null;
    const pivot = list[list.length - limit] ?? now;
    return Math.max(1, Math.ceil((pivot + this.limits.windowMs - now) / 1000));
  }

  /** Seconds until this source may try again, or null when neither its bucket nor the global one is spent. */
  retryAfterSeconds(ip: string): number | null {
    const now = this.now();
    this.all = this.all.filter((t) => now - t < this.limits.windowMs);
    const perIp = this.wait(this.recent(ip, now), this.limits.perIp, now);
    const global = this.wait(this.all, this.limits.global, now);
    return perIp === null ? global : global === null ? perIp : Math.max(perIp, global);
  }

  recordFailure(ip: string): void {
    const now = this.now();
    this.all = [...this.all.filter((t) => now - t < this.limits.windowMs), now];
    const list = [...this.recent(ip, now), now];
    // why: delete then set, so the Map's insertion order is least recently failing first, and eviction takes the head.
    this.byIp.delete(ip);
    this.byIp.set(ip, list);
    while (this.byIp.size > this.limits.maxSources) {
      const oldest = this.byIp.keys().next().value;
      if (oldest === undefined) break;
      this.byIp.delete(oldest);
    }
  }

  /** How many source addresses the limiter is holding (tests). */
  get sources(): number {
    return this.byIp.size;
  }
}

/** The bucket of a request whose client IP is not known. */
export const UNKNOWN_IP = 'unknown';

/** Spec §4: `X-Forwarded-For` only when `TRUST_PROXY=true` (its last entry, appended by the proxy), else the socket. */
export function clientIpFrom(config: Config): (c: Context<AppEnv>) => string | null {
  return (c) => {
    if (config.trustProxy) {
      const parts = (c.req.header('x-forwarded-for') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      const last = parts[parts.length - 1];
      if (last !== undefined) return last;
    }
    try {
      return getConnInfo(c).remote.address ?? null;
    } catch {
      return null; // why: app.request() in tests has no socket
    }
  };
}

export interface AuthGateOptions {
  config: Config;
  /** `${method} ${path}` of every ROUTES entry whose auth flag is `public`. */
  publicKeys: ReadonlySet<string>;
  limiter: FailedAuthLimiter;
  clientIp: (c: Context<AppEnv>) => string | null;
}

/**
 * Spec §4: everything except the public `GET /api/health` needs auth, static files included. A valid credential is
 * accepted whatever the limiter says (decision 54); a wrong one from a source over its limit is 429 with Retry-After,
 * otherwise it counts and is 401 — on every route, the public health route included, so it cannot probe passwords. A
 * request without credentials is never counted.
 */
export function basicAuthGate(o: AuthGateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = o.config.auth;
    if (auth === null) {
      // why: config refuses this on a non-loopback bind unless ALLOW_UNAUTHENTICATED=true (spec §4); bootApp re-asserts it.
      c.set('authenticated', true);
      return next();
    }
    const isPublic = o.publicKeys.has(`${c.req.method} ${c.req.path}`);
    const header = c.req.header('authorization');
    if (header !== undefined) {
      if (credentialsMatch(header, auth) === 'valid') {
        c.set('authenticated', true);
        return next();
      }
      const ip = o.clientIp(c) ?? UNKNOWN_IP;
      const retry = o.limiter.retryAfterSeconds(ip);
      if (retry !== null) {
        c.header('Retry-After', String(retry));
        return c.json(envelope('auth_rate_limited', API_TEXT.rateLimited(retry)), 429);
      }
      o.limiter.recordFailure(ip);
    }
    c.set('authenticated', false);
    if (isPublic) return next();
    c.header('WWW-Authenticate', 'Basic realm="get-me-there", charset="UTF-8"');
    return c.json(envelope('unauthenticated', API_TEXT.unauthenticated), 401);
  };
}
