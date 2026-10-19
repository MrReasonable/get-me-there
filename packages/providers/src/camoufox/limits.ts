/**
 * camoufox HTTP limits for http-kit (spec §2, §5.3, §12 rev 32; decision 69): the worker's own scheme, host and explicit
 * port; never billable, cost 0, concurrency 1; the start-to-start spacing as the limiter's minimum interval; the
 * request timeout is the worker's page timeout plus 15 s; transport failures are never retried; a refused connection is
 * `provider-unavailable`; each attempt's page class comes from `x-gmt-google-contacted` (absent → `page`, the
 * conservative reading). `camoufox-status` is the unledgered preflight's id, GET /v1/status only.
 */
import { type Config, GOOGLE_CONTACTED_HEADER, GRID_MOVE_BUDGET_MS, GRID_MOVE_RESERVE_MS } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/types.js';
import { classifyWorkerAnswer } from './answer.js';

/** One move's own budget and its reserve, in seconds (core's shared constants: the worker uses the same). */
const MOVE_SECONDS = (GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS) / 1000;

type CamoufoxConfig = NonNullable<Config['providers']['camoufox']>;

function workerOrigin(c: CamoufoxConfig): { host: string; port: number; scheme: 'http:' | 'https:' } {
  const u = new URL(c.workerUrl);
  return { host: u.hostname, port: Number(u.port), scheme: u.protocol === 'https:' ? 'https:' : 'http:' };
}

/** The scroll clicks a worker answer states (spec §7 rev 34, CB-4); undefined for an answer that states none. */
export function scrollCountOf(bodyText: string): number | undefined {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body !== 'object' || body === null || !('scrolls' in body)) return undefined;
    const n = body.scrolls;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** `page` unless the worker states it contacted no Google page. */
export function pageClassOf(f: { status: number | null; headers: Headers | null }): 'page' | 'no-page' {
  return f.headers?.get(GOOGLE_CONTACTED_HEADER) === '0' ? 'no-page' : 'page';
}

export function camoufoxHttpLimits(
  c: CamoufoxConfig,
  cfg: Pick<Config, 'maxWaitSeconds'>,
): ProviderHttpLimits {
  const w = workerOrigin(c);
  return {
    hosts: [w.host],
    workerPort: w.port,
    workerScheme: w.scheme,
    ratePerMinute: c.limits.ratePerMinute,
    ratePerHour: c.limits.ratePerHour,
    concurrency: 1,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    // why: spec §2 rev 34 (ruling 10): a grid page may run its first view's budget (twice the page timeout) and, per
    // scroll, the spacing and a move's own budget with its reserve (core's GRID_MOVE_*, 60 s)
    requestTimeoutSeconds:
      c.mode === 'grid'
        ? 2 * c.pageTimeoutSeconds + c.gridScrollCap * (c.gridScrollSpacingSeconds + MOVE_SECONDS) + 15
        : c.pageTimeoutSeconds + 15,
    minIntervalMs: c.minSpacingSeconds * 1000,
    retryTransport: false,
    connectRefusedKind: 'provider-unavailable',
    pageClass: pageClassOf,
    scrollCountOf,
    classifyError: classifyWorkerAnswer,
  };
}

/** The status route's limits: the same origin, a short timeout, never ledgered (the id is unledgered), never retried. */
export function camoufoxStatusHttpLimits(
  c: CamoufoxConfig,
  cfg: Pick<Config, 'maxWaitSeconds'>,
): ProviderHttpLimits {
  const w = workerOrigin(c);
  return {
    hosts: [w.host],
    workerPort: w.port,
    workerScheme: w.scheme,
    ratePerMinute: 60,
    ratePerHour: 3600,
    concurrency: 1,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: 10,
    retryTransport: false,
    connectRefusedKind: 'provider-unavailable',
  };
}
