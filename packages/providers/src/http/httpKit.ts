import { AbortedError, isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import { assertEgress, assertKitConfig } from './egress.js';
import { createLimiter, HOUR_MS, type ProviderLimiter } from './limiter.js';
import { sleep } from './sleep.js';
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
  assertKitConfig(deps);
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
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    const limiter = limiters.get(r.providerId);
    // why: unreachable after assertEgress (every configured id has a limiter); kept for type narrowing.
    if (limiter === undefined) throw new Error(`no limiter for ${r.providerId}`);
    const run = {
      signal: r.signal,
      maxWaitMs: limits.maxWaitSeconds * 1000,
      providerId: r.providerId,
      endpointPath: r.endpointPath,
    };
    inFlight += 1;
    try {
      const result = await pRetry(
        (attempt) =>
          limiter.run(
            () =>
              runAttempt(deps, r, limits, {
                attempt,
                secondsToHourRefresh: () => limiter.secondsToHourRefresh(),
              }),
            run,
          ),
        {
          retries: MAX_ATTEMPTS - 1,
          minTimeout: BACKOFF_BASE_MS,
          factor: 2,
          // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
          randomize: true,
          signal: r.signal,
          shouldRetry: ({ error }) => isRetryable(error),
          // why: p-retry calls onFailedAttempt even when shouldRetry will refuse, so the wait checks retryability
          // and remaining attempts itself; the sleep is abortable.
          onFailedAttempt: async ({ error, retriesLeft }) => {
            if (retriesLeft > 0 && isRetryable(error) && error.retryAfterSeconds !== undefined)
              await sleep(error.retryAfterSeconds * 1000, r.signal);
          },
        },
      );
      return { ...result, fromCache: false, cacheKey: '' };
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
