import { isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import { createLimiter, HOUR_MS, type ProviderLimiter } from './limiter.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId } from './types.js';

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
const HTTP_PROVIDER_IDS = [
  'travelpayouts',
  'searchapi',
  'fixture',
  'fx',
] as const satisfies readonly HttpProviderId[];

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; the gated in-process seam for fixture.local arrives in Task 4.5. */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
  const since = isoDateTimeOfEpochMs(Date.parse(deps.clock.now()) - HOUR_MS);
  for (const id of HTTP_PROVIDER_IDS) {
    const l = deps.limits[id];
    if (l === undefined) continue;
    // why: seed the hourly reservoir from the ledger so a restart inside an hour does not grant a fresh one (ruling 9); fx is not ledgered.
    limiters.set(
      id,
      createLimiter(l, { usedThisHour: id === 'fx' ? 0 : deps.budget.recentCalls(id, since) }),
    );
  }
  let inFlight = 0;

  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    const limits = deps.limits[r.providerId];
    const limiter = limiters.get(r.providerId);
    if (limits === undefined || limiter === undefined) {
      throw new ProviderError({
        kind: 'upstream',
        retryable: false,
        providerId: r.providerId,
        message: `${r.providerId}: no HTTP limits configured [egress-denied]`,
      });
    }
    const run = {
      signal: r.signal,
      maxWaitMs: limits.maxWaitSeconds * 1000,
      providerId: r.providerId,
      endpointPath: r.endpointPath,
    };
    inFlight += 1;
    try {
      const result = await pRetry(
        (attempt) => limiter.run(() => runAttempt(deps, r, limits, { attempt }), run),
        {
          retries: MAX_ATTEMPTS - 1,
          minTimeout: BACKOFF_BASE_MS,
          factor: 2,
          // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
          randomize: true,
          shouldRetry: ({ error }) => isRetryable(error),
        },
      );
      return { ...result, fromCache: false, cacheKey: '' };
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
