import {
  type IsoDateTime,
  ProviderError,
  type ProviderErrorKind,
  type Secret,
  stripUrlsInText,
} from '@gmt/core';
import { isRecord } from '../util.js';
import { scrubSecrets } from './scrub.js';
import {
  errorProviderId,
  type HttpProviderId,
  type ProviderHttpLimits,
  type ResponseFacts,
} from './types.js';

type Where = { providerId: HttpProviderId; endpointPath: string };
interface ErrorParts {
  kind: ProviderErrorKind;
  retryable: boolean;
  detail: string;
  httpStatus?: number;
  code?: string;
  retryAfterSeconds?: number;
}

/**
 * Builds a ProviderError whose message names provider and path only, never a URL, ending in a bracketed diagnostic
 * code (`[timeout]`, `[redirect-refused]`, …) that tests and logs match.
 * why: `ProviderError.reason` becomes `cell_outcomes.reason` (spec §8.1 `reason = error.reason ?? kind`), which
 * holds the kind or a spec-named reason only (spec §3), so http-kit never sets `reason`; vendor text travels in
 * the message, which the engine writes to `last_error`.
 */
function providerError(w: Where, p: ErrorParts): ProviderError {
  return new ProviderError({
    kind: p.kind,
    retryable: p.retryable,
    providerId: errorProviderId(w.providerId),
    message: `${w.providerId} ${w.endpointPath}: ${p.detail}${p.code === undefined ? '' : ` [${p.code}]`}`,
    ...(p.httpStatus === undefined ? {} : { httpStatus: p.httpStatus }),
    ...(p.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: p.retryAfterSeconds }),
  });
}

/** Retry-After as whole seconds: delta-seconds or an HTTP-date relative to `now` (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now: IsoDateTime): number | undefined {
  if (value === null) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.parse(now)) / 1000));
}

/** The vendor's own message (`error` or `message` field, or a text body) from an already-scrubbed body; URL-free, ≤ 200 chars. */
export function vendorMessage(body: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof body === 'string') raw = body;
  else if (isRecord(body)) {
    const m = body.error ?? body.message;
    if (typeof m === 'string') raw = m;
  }
  if (raw === undefined || raw.trim() === '') return undefined;
  return stripUrlsInText(raw).trim().slice(0, 200);
}

/**
 * The default spec §5.2 (rev 11) table: 401/403 auth · 402 quota · 400 parse (vendor message in the message) ·
 * 404 upstream · 429 rate-limit (retryable; quota only through an adapter's classifyError) · 5xx upstream
 * (retryable) · any other status upstream (non-retryable). Waits are applied afterwards by `finishError`.
 */
export function classifyResponse(f: ResponseFacts): ProviderError {
  const w: Where = { providerId: f.providerId, endpointPath: f.endpointPath };
  const httpStatus = f.status;
  if (httpStatus === 401 || httpStatus === 403)
    return providerError(w, {
      kind: 'auth',
      retryable: false,
      httpStatus,
      detail: `HTTP ${httpStatus} (credentials refused)`,
    });
  if (httpStatus === 402)
    return providerError(w, { kind: 'quota', retryable: false, httpStatus, detail: 'HTTP 402 (plan quota)' });
  if (httpStatus === 400) {
    const vendor = vendorMessage(f.body);
    return providerError(w, {
      kind: 'parse',
      retryable: false,
      httpStatus,
      code: 'bad-request',
      detail: `HTTP 400${vendor ? ` (${vendor})` : ''}`,
    });
  }
  if (httpStatus === 404)
    return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: 'HTTP 404' });
  if (httpStatus === 429)
    return providerError(w, { kind: 'rate-limit', retryable: true, httpStatus, detail: 'HTTP 429' });
  if (httpStatus >= 500)
    return providerError(w, { kind: 'upstream', retryable: true, httpStatus, detail: `HTTP ${httpStatus}` });
  return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: `HTTP ${httpStatus}` });
}

export interface FinishContext {
  facts: ResponseFacts;
  limits: ProviderHttpLimits;
  now: IsoDateTime;
  secrets: readonly Secret[];
  secondsToHourRefresh: () => number;
}

/** Kinds that are never retried whatever a classifier says (spec §5.2: auth, quota, parse; the limiter's own deadline). */
const NEVER_RETRIED: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  'auth',
  'quota',
  'parse',
  'limiter-timeout',
  // why: spec §5.1 rev 32: camoufox's blocked page and unreachable worker are never retried.
  'blocked',
  'provider-unavailable',
]);

/**
 * The post-step for whichever error classification produced (adapter or default), spec §5.2 rev 11:
 * the message and any reason are re-scrubbed and URL-stripped (an adapter may have copied vendor text or a key);
 * a retryable error waits `Retry-After`, else (429) `rateLimitFallbackWaitSeconds`; a wait above `maxWaitSeconds`
 * becomes non-retryable `limiter-timeout` carrying the wait; a retryable 429 with no wait at all becomes
 * non-retryable `rate-limit` with `retryAfterSeconds` = seconds to the limiter's hourly refresh.
 */
export function finishError(err: ProviderError, c: FinishContext): ProviderError {
  const clean = (s: string): string => stripUrlsInText(scrubSecrets(s, c.secrets));
  const message = clean(err.message);
  // why: http-kit is the single owner of retries; an adapter classifier cannot make these kinds retryable (cost minor 3).
  const retryable = err.retryable && !NEVER_RETRIED.has(err.kind);
  const base = {
    kind: err.kind,
    retryable,
    providerId: errorProviderId(c.facts.providerId),
    ...(err.httpStatus === undefined ? {} : { httpStatus: err.httpStatus }),
    ...(err.reason === undefined ? {} : { reason: clean(err.reason) }),
    ...(err.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: err.retryAfterSeconds }),
    // why: fix round 1 (arch I1): a block's cool-down end survives the re-scrub as data
    ...(err.cooldownUntil === undefined ? {} : { cooldownUntil: err.cooldownUntil }),
    // why: W3: the worker's monthly cap figures survive the re-scrub as data, for the adapter's BudgetExceeded
    ...(err.monthlyCap === undefined ? {} : { monthlyCap: err.monthlyCap }),
  };
  if (!retryable) return new ProviderError({ ...base, message });
  const is429 = c.facts.status === 429;
  const wait =
    parseRetryAfter(c.facts.headers.get('retry-after'), c.now) ??
    (is429 ? c.limits.rateLimitFallbackWaitSeconds : undefined);
  if (wait === undefined) {
    if (!is429) return new ProviderError({ ...base, message });
    return new ProviderError({
      ...base,
      retryable: false,
      retryAfterSeconds: c.secondsToHourRefresh(),
      message: `${message} [no-retry-after]`,
    });
  }
  if (wait > c.limits.maxWaitSeconds) {
    return new ProviderError({
      ...base,
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: wait,
      message: `${message} (asks to wait ${wait}s, beyond MAX_WAIT_SECONDS ${c.limits.maxWaitSeconds}) [retry-after-exceeds-max-wait]`,
    });
  }
  return new ProviderError({ ...base, retryAfterSeconds: wait, message });
}

/** A 2xx whose body is not JSON. Spec §5.2: malformed → parse. */
export function malformedBody(w: Where, httpStatus: number): ProviderError {
  return providerError(w, {
    kind: 'parse',
    retryable: false,
    httpStatus,
    code: 'malformed-json',
    detail: `HTTP ${httpStatus} with a body that is not JSON`,
  });
}

/** A 3xx reached us, or fetch refused to follow one (`redirect: 'error'`). Spec §5.3 egress. */
export function redirectRefused(w: Where, httpStatus?: number): ProviderError {
  return providerError(w, {
    kind: 'upstream',
    retryable: false,
    code: 'redirect-refused',
    detail: 'redirect refused (redirect: error)',
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
}

/** Per-request timeout. Spec §5.2: network, finalised unknown, not retried for billed vendors nor for camoufox. */
export function requestTimeout(
  w: Where,
  billable: 'http-200' | 'never',
  retryTransport = true,
): ProviderError {
  return providerError(w, {
    kind: 'network',
    retryable: billable === 'never' && retryTransport,
    code: 'timeout',
    detail: 'request timed out (REQUEST_TIMEOUT_SECONDS)',
  });
}

/** The status line arrived but the body could not be read; billed 200s are not retried (the vendor charged them). */
export function bodyReadFailed(
  w: Where,
  httpStatus: number,
  billed: boolean,
  retryTransport = true,
): ProviderError {
  return providerError(w, {
    kind: 'network',
    retryable: !billed && retryTransport,
    httpStatus,
    code: 'body-read-failed',
    detail: `HTTP ${httpStatus}, body read failed`,
  });
}

/** A body above MAX_BODY_BYTES. */
export function bodyTooLarge(w: Where, httpStatus: number): ProviderError {
  return providerError(w, {
    kind: 'upstream',
    retryable: false,
    httpStatus,
    code: 'body-too-large',
    detail: `HTTP ${httpStatus} with a body above the size cap`,
  });
}

/** The connection-refused codes (decision 69): nothing was sent, so nothing was loaded. */
const REFUSED_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'EHOSTUNREACH']);

/** True when a fetch rejection's `cause` (or every error of an AggregateError cause) carries a refused-connection code. */
export function connectionRefused(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  const codeOf = (x: unknown): unknown =>
    typeof x === 'object' && x !== null && 'code' in x ? x.code : undefined;
  const code = codeOf(cause);
  if (typeof code === 'string' && REFUSED_CODES.has(code)) return true;
  const errors = typeof cause === 'object' && cause !== null && 'errors' in cause ? cause.errors : undefined;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every((e) => {
      const c = codeOf(e);
      return typeof c === 'string' && REFUSED_CODES.has(c);
    })
  );
}

/**
 * A rejection from fetch itself: a refused redirect; a refused connection, which an adapter may name its own kind
 * (camoufox: `provider-unavailable`, non-retryable); or another socket-level failure (network, retryable unless the
 * provider never retries transport failures).
 */
export function classifyThrown(
  err: unknown,
  w: Where,
  o: { retryTransport?: false; connectRefusedKind?: 'provider-unavailable' } = {},
): ProviderError {
  const cause = err instanceof Error ? err.cause : undefined;
  const text = `${err instanceof Error ? err.message : String(err)} ${cause instanceof Error ? cause.message : String(cause ?? '')}`;
  if (/redirect/i.test(text)) return redirectRefused(w);
  if (o.connectRefusedKind !== undefined && connectionRefused(err))
    return providerError(w, {
      kind: o.connectRefusedKind,
      retryable: false,
      code: 'connection-refused',
      detail: 'connection refused',
    });
  return providerError(w, {
    kind: 'network',
    retryable: o.retryTransport !== false,
    code: 'socket',
    detail: 'network error',
  });
}
