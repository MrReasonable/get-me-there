/**
 * camoufox HTTP limits for http-kit (spec §2, §5.3, §12 rev 32; decision 69): the worker's own scheme, host and explicit
 * port; never billable, cost 0, concurrency 1; the start-to-start spacing as the limiter's minimum interval; the
 * request timeout is the worker's page timeout plus 15 s; transport failures are never retried; a refused connection is
 * `provider-unavailable`; each attempt's page class comes from `x-gmt-google-contacted` (absent → `page`, the
 * conservative reading); a flights answer's `pagesLoaded` is the attempt's page count (spec rev 56 §5.3), and any
 * answer's `nextLoadNotBefore` holds the provider's next start, while the request timeout stays discovery's (a flights
 * request with a return phase sends its own). `camoufox-status` is the unledgered id of GET /v1/status and POST /v1/awake (the keep-awake lease) only.
 */
import {
  type Config,
  GOOGLE_CONTACTED_HEADER,
  GRID_MOVE_BUDGET_MS,
  GRID_MOVE_RESERVE_MS,
  type IsoDateTime,
  isoDateTimeSchema,
} from '@gmt/core';
import type { ProviderHttpLimits } from '../http/types.js';
import { classifyWorkerAnswer } from './answer.js';

/** One move's own budget and its reserve, in seconds (core's shared constants: the worker uses the same). */
const MOVE_SECONDS = (GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS) / 1000;

type CamoufoxConfig = NonNullable<Config['providers']['camoufox']>;

function workerOrigin(c: CamoufoxConfig): { host: string; port: number; scheme: 'http:' | 'https:' } {
  const u = new URL(c.workerUrl);
  return { host: u.hostname, port: Number(u.port), scheme: u.protocol === 'https:' ? 'https:' : 'http:' };
}

/** What a worker answer states under `key`, still unnarrowed; undefined for a body that is no JSON object. */
function stated(bodyText: string, key: 'scrolls' | 'pagesLoaded' | 'nextLoadNotBefore'): unknown {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  // why: only an object states a value; an absent key reads as undefined, which states nothing
  if (typeof body !== 'object' || body === null) return undefined;
  return Reflect.get(body, key);
}

/** A count a worker answer states under `key` (a whole number, 0 admitted); undefined when absent or not a count. */
function statedCount(bodyText: string, key: 'scrolls' | 'pagesLoaded'): number | undefined {
  const n = stated(bodyText, key);
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** The scroll clicks a worker answer states (spec §7 rev 34, CB-4); undefined for an answer that states none. */
export function scrollCountOf(bodyText: string): number | undefined {
  return statedCount(bodyText, 'scrolls');
}

/**
 * Spec rev 56 §5.3 (R-zero): the documents a worker answer states it loaded (`pagesLoaded`, 0 when its first load was
 * refused), for the ledger row's `page_count`; undefined for an answer that states none (the guard then writes 1 on a
 * contacted page) or a body that is not one.
 */
export function pageCountOf(bodyText: string): number | undefined {
  return statedCount(bodyText, 'pagesLoaded');
}

/**
 * Spec rev 56 §5.3 (R-spacing; ruling 21.4): when the worker's next document load may start, as any answer states it
 * once the phase started the reload (`nextLoadNotBefore`), 2xx or not; http-kit holds the provider's next start until
 * then. Undefined for an answer that states none or a value `isoDateTimeSchema` refuses.
 */
export function nextStartOf(bodyText: string): IsoDateTime | undefined {
  const at = isoDateTimeSchema.safeParse(stated(bodyText, 'nextLoadNotBefore'));
  return at.success ? at.data : undefined;
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
    pageCountOf,
    nextStartOf,
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
