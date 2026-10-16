/**
 * SearchApi HTTP limits for http-kit, with the classifier they carry (spec §5.2, §5.3). The module name follows
 * travelpayouts/limits.ts; registered by apps/api httpLimitsFor (Task 5.10).
 */
import { type Config, ProviderError, type ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits, ResponseFacts } from '../http/types.js';
import { isRecord } from '../util.js';
import { SEARCHAPI_HOST } from './params.js';

/** The 401 body the spike recorded (spec §2 fact 5). */
const INVALID_KEY = 'Invalid API key.';

/**
 * http-kit's `classifyError` hook for SearchApi (spec §5.2, plan decision 15). It recognises SearchApi bodies
 * only and returns `undefined` for everything else, so http-kit's default table applies (401/403 auth, 402
 * quota, 400 parse with the vendor message, 404 upstream, 429 rate-limit, 5xx upstream); http-kit then applies
 * Retry-After, the hourly fallback for a header-less 429, limiter-timeout and scrubbing. Recognised today: the
 * recorded 401 body, so its vendor text reaches `last_error`. No quota body has been recorded (spec §2 fact 5),
 * so a 429 is never `quota`. `reason` stays unset: the outcome reason is the kind (spec §3).
 */
export function classifySearchApiError(f: ResponseFacts): ProviderError | undefined {
  const error = isRecord(f.body) ? f.body.error : undefined;
  if (f.status === 401 && error === INVALID_KEY) {
    return new ProviderError({
      kind: 'auth',
      retryable: false,
      httpStatus: 401,
      providerId: 'searchapi',
      message: `searchapi ${f.endpointPath}: HTTP 401 (${INVALID_KEY})`,
    });
  }
  return undefined;
}

/**
 * SearchApi's http-kit limits (plan contract). `billable: 'http-200'` makes a timeout non-retryable. No
 * `rateLimitFallbackWaitSeconds`: spec §5.2 configures none for SearchApi, so a 429 without Retry-After is
 * non-retryable `rate-limit` with a retry time at the hourly refresh. The vendor's 429 headers are undocumented
 * and unrecorded (plan decision 20), so that rule is the only one tested against synthetic labelled bodies.
 */
export function searchApiHttpLimits(
  limits: ProviderLimits,
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: [SEARCHAPI_HOST],
    ratePerMinute: limits.ratePerMinute,
    ratePerHour: limits.ratePerHour,
    concurrency: limits.concurrency,
    billable: 'http-200',
    costPerCallMicroGbp: limits.costPerCallMicroGbp,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
    classifyError: classifySearchApiError,
  };
}
