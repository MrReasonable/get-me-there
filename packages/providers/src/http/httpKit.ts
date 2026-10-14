import { AbortedError, BudgetExceeded, isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { type AttemptResult, raceAbort, runAttempt } from './attempt.js';
import { canonicalCacheKey } from './cacheKey.js';
import { assertEgress, assertKitConfig } from './egress.js';
import { createLimiter, HOUR_MS, type ProviderLimiter } from './limiter.js';
import { sleep } from './sleep.js';
import type {
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
} from './types.js';

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

/** A body worth caching: not null, not empty text, and admitted by the adapter's veto (spec §5.3 rev 11). */
function shouldCache(cache: { accept?: (body: unknown) => boolean }, body: unknown): boolean {
  if (body === null || body === '') return false;
  return cache.accept === undefined ? true : cache.accept(body);
}

interface Flight {
  promise: Promise<HttpKitResponse>;
  leader: HttpKitRequest;
}

/**
 * Spec §5.3 (rev 11) http-kit over globalThis.fetch; the only other transport is the gated `inProcessHosts` seam
 * for fixture.local. 'fx' is never ledgered.
 *
 *   egress → cache lookup ─hit─▶ recordCacheHit → { body, fetchedAt: storedAt }
 *     │miss
 *   in-flight dedup (joiners ledger a cache hit, own their abort) → p-retry (3 attempts) {
 *       limiter (queue age, abort) → budget.reserve → fetch → reservation.finalise → classify
 *   } → cache.set when cacheable → { body, fetchedAt: now }
 *
 * Throws ProviderError (classified), BudgetExceeded (from reserve, before any fetch), AbortedError.
 */
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
  const inFlight = new Map<string, Flight>();

  async function upstream(
    r: HttpKitRequest,
    limits: ProviderHttpLimits,
    limiter: ProviderLimiter,
    key: string,
  ): Promise<HttpKitResponse> {
    const run = {
      signal: r.signal,
      maxWaitMs: limits.maxWaitSeconds * 1000,
      providerId: r.providerId,
      endpointPath: r.endpointPath,
    };
    let result: AttemptResult;
    try {
      result = await pRetry(
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
    } catch (err) {
      deps.log.warn(
        {
          providerId: r.providerId,
          endpointPath: r.endpointPath,
          error: err instanceof Error ? err.message : String(err),
        },
        'http request failed',
      );
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    }
    if (r.cache !== 'never' && shouldCache(r.cache, result.body))
      deps.cache.set(key, result.body, r.cache.ttlSeconds, result.fetchedAt);
    return {
      status: result.status,
      body: result.body,
      fetchedAt: result.fetchedAt,
      fromCache: false,
      cacheKey: key,
    };
  }

  async function join(r: HttpKitRequest, flight: Flight): Promise<HttpKitResponse> {
    let shared: HttpKitResponse;
    try {
      shared = await raceAbort(flight.promise, r.signal);
    } catch (err) {
      if (r.signal.aborted) throw new AbortedError();
      const leaderAborted = err instanceof AbortedError;
      const othersCap =
        err instanceof BudgetExceeded &&
        err.scope.startsWith('execution-') &&
        flight.leader.executionId !== r.executionId;
      // why: the leader's cancellation or its own execution cap says nothing about this caller (ruling 4);
      // it re-issues under its own signal and its own scopes.
      if (leaderAborted || othersCap) return request(r);
      throw err;
    }
    // why: parity counts first-attempt rows plus cache hits per tile (spec §8.1), so a joiner leaves its own row.
    if (r.providerId !== 'fx')
      deps.budget.recordCacheHit({
        providerId: r.providerId,
        executionId: r.executionId,
        tileIndex: r.tileIndex,
        endpointPath: r.endpointPath,
      });
    deps.log.debug(
      { providerId: r.providerId, endpointPath: r.endpointPath },
      'http joined in-flight request',
    );
    return { ...shared, fromCache: true };
  }

  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    const limiter = limiters.get(r.providerId);
    // why: unreachable after assertEgress (every configured id has a limiter); kept for type narrowing.
    if (limiter === undefined) throw new Error(`no limiter for ${r.providerId}`);
    const key = canonicalCacheKey(r, deps.secrets);

    if (r.cache !== 'never') {
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        // why: spec §5.3 — cache hits are ledgered as non-billable rows so parity counts them; 'fx' is not ledgered.
        if (r.providerId !== 'fx')
          deps.budget.recordCacheHit({
            providerId: r.providerId,
            executionId: r.executionId,
            tileIndex: r.tileIndex,
            endpointPath: r.endpointPath,
          });
        deps.log.debug({ providerId: r.providerId, endpointPath: r.endpointPath }, 'http cache hit');
        return { status: 200, body: hit.body, fetchedAt: hit.storedAt, fromCache: true, cacheKey: key };
      }
    }

    const flight = inFlight.get(key);
    if (flight !== undefined) return join(r, flight);
    const promise: Promise<HttpKitResponse> = upstream(r, limits, limiter, key).finally(() => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    });
    inFlight.set(key, { promise, leader: r });
    return promise;
  }

  return { request, stats: () => ({ inFlight: inFlight.size }) };
}
