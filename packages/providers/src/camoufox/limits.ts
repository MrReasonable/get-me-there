/**
 * camoufox HTTP limits for http-kit (spec §2, §5.3, §12 rev 32; decision 69): the worker's own scheme, host and explicit
 * port; never billable, cost 0, concurrency 1; the start-to-start spacing as the limiter's minimum interval; the
 * request timeout is the worker's page timeout plus 15 s; transport failures are never retried; a refused connection is
 * `provider-unavailable`; each attempt's page class comes from `x-gmt-google-contacted` (absent → `page`, the
 * conservative reading). `camoufox-status` is the unledgered preflight's id, GET /v1/status only.
 */
import { type Config, GOOGLE_CONTACTED_HEADER } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/types.js';
import { classifyWorkerAnswer } from './answer.js';

type CamoufoxConfig = NonNullable<Config['providers']['camoufox']>;

function workerOrigin(c: CamoufoxConfig): { host: string; port: number; scheme: 'http:' | 'https:' } {
  const u = new URL(c.workerUrl);
  return { host: u.hostname, port: Number(u.port), scheme: u.protocol === 'https:' ? 'https:' : 'http:' };
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
    requestTimeoutSeconds: c.pageTimeoutSeconds + 15,
    minIntervalMs: c.minSpacingSeconds * 1000,
    retryTransport: false,
    connectRefusedKind: 'provider-unavailable',
    pageClass: pageClassOf,
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
