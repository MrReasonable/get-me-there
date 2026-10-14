import { ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse } from './types.js';

export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
  ResponseFacts,
} from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1–2 s before attempt 2, 2–4 s before attempt 3 (randomised). */
export const BACKOFF_BASE_MS = 1000;

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; the gated in-process seam for fixture.local arrives in Task 4.5. */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    const limits = deps.limits[r.providerId];
    if (limits === undefined) {
      throw new ProviderError({
        kind: 'upstream',
        retryable: false,
        providerId: r.providerId,
        message: `${r.providerId}: no HTTP limits configured [egress-denied]`,
      });
    }
    inFlight += 1;
    try {
      const result = await pRetry((attempt) => runAttempt(deps, r, limits, { attempt }), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
        randomize: true,
        shouldRetry: ({ error }) => isRetryable(error),
      });
      return { ...result, fromCache: false, cacheKey: '' };
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
