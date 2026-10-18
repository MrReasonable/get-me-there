import { AbortedError, BudgetExceeded, ProviderError } from '@gmt/core';
import Bottleneck from 'bottleneck';
import { errorProviderId, type HttpProviderId, type ProviderHttpLimits } from './types.js';

export interface LimiterRunOptions {
  signal: AbortSignal;
  maxWaitMs: number;
  providerId: HttpProviderId;
  endpointPath: string;
}

/** Gate in front of every attempt (spec §5.3: inside p-retry, before reserve). */
export interface ProviderLimiter {
  run<T>(fn: () => Promise<T>, o: LimiterRunOptions): Promise<T>;
  /** Whole seconds until the hourly window next refreshes (fixed window from creation). */
  secondsToHourRefresh(): number;
  /** Current reservoir levels (tests and diagnostics). */
  reservoirs(): Promise<{ minute: number; hour: number }>;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
const HEARTBEAT_MS = 5_000;

/**
 * Per-provider limiter. The hourly bottleneck (reservoir = ratePerHour − usedThisHour, refreshed to ratePerHour)
 * admits a job; the per-minute bottleneck (reservoir = ratePerMinute, maxConcurrent, minTime) then runs it.
 * The queue deadline is our own timer plus an age check at each release, because bottleneck's `expiration` bounds a
 * running job, not queue time. A job whose caller already gave up is dropped at the hourly stage (refunding its hour
 * token, never taking a per-minute launch slot) or at the per-minute stage (refunding both). An attempt refused by
 * the budget (BudgetExceeded from reserve) refunds both tokens: no call was sent (cost minor 2).
 */
export function createLimiter(l: ProviderHttpLimits, seed: { usedThisHour: number }): ProviderLimiter {
  const createdAt = Date.now();
  // why: a 5 s heartbeat (bottleneck's local default is 250 ms) keeps refresh checks cheap — both windows are multiples
  // of it — so hours of fake time in tests and idle limiters in production cost little; a refresh lands ≤ 5 s late.
  const perHour = new Bottleneck({
    reservoir: Math.max(0, l.ratePerHour - seed.usedThisHour),
    reservoirRefreshAmount: l.ratePerHour,
    reservoirRefreshInterval: HOUR_MS,
    heartbeatInterval: HEARTBEAT_MS,
  });
  const perMinute = new Bottleneck({
    maxConcurrent: l.concurrency,
    // why: smoothing only — the rate guarantee is per fixed bottleneck window from creation (plan decision 17);
    // a provider that states its own start-to-start spacing (camoufox, ruling 7) uses it directly.
    minTime: l.minIntervalMs ?? Math.ceil(MINUTE_MS / l.ratePerMinute),
    reservoir: l.ratePerMinute,
    reservoirRefreshAmount: l.ratePerMinute,
    reservoirRefreshInterval: MINUTE_MS,
    heartbeatInterval: HEARTBEAT_MS,
  });

  const secondsTo = (windowMs: number): number =>
    Math.max(1, Math.ceil((windowMs - ((Date.now() - createdAt) % windowMs)) / 1000));
  const reservoirs = async (): Promise<{ minute: number; hour: number }> => ({
    minute: (await perMinute.currentReservoir()) ?? 0,
    hour: (await perHour.currentReservoir()) ?? 0,
  });
  const refund = async (): Promise<void> => {
    await Promise.all([perMinute.incrementReservoir(1), perHour.incrementReservoir(1)]);
  };

  return {
    secondsToHourRefresh: () => secondsTo(HOUR_MS),
    reservoirs,
    run<T>(fn: () => Promise<T>, o: LimiterRunOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let state: 'queued' | 'running' | 'gone' = 'queued';
        const enqueuedAt = Date.now();
        const timedOut = (seconds: number): ProviderError =>
          new ProviderError({
            kind: 'limiter-timeout',
            retryable: false,
            providerId: errorProviderId(o.providerId),
            retryAfterSeconds: seconds,
            message: `${o.providerId} ${o.endpointPath}: waited more than ${Math.round(o.maxWaitMs / 1000)}s for a rate-limit slot [queue-wait-exceeded]`,
          });
        const leave = (): void => {
          state = 'gone';
          clearTimeout(timer);
          o.signal.removeEventListener('abort', onAbort);
        };
        const timeOut = (): void => {
          if (state !== 'queued') return;
          leave();
          // why: the error carries the seconds until the exhausted window reopens, so WP7's resume_after is data (po-003).
          reservoirs().then(
            ({ hour }) => reject(timedOut(hour === 0 ? secondsTo(HOUR_MS) : secondsTo(MINUTE_MS))),
            () => reject(timedOut(secondsTo(MINUTE_MS))),
          );
        };
        const onAbort = (): void => {
          if (state !== 'queued') return;
          leave();
          reject(new AbortedError());
        };
        const timer = setTimeout(timeOut, o.maxWaitMs);
        o.signal.addEventListener('abort', onAbort, { once: true });
        if (o.signal.aborted) onAbort();

        /** False (after settling the caller) when the caller has already given up or must now. */
        const wanted = (): boolean => {
          if (state === 'queued' && Date.now() - enqueuedAt > o.maxWaitMs) timeOut();
          if (state === 'queued' && o.signal.aborted) onAbort();
          return state === 'queued';
        };
        perHour
          .schedule(async () => {
            // why: a dead job leaves here with its hour token refunded, so a backlog of them never queues for
            // per-minute launch slots ahead of live jobs (cost minor 2, cost-006).
            if (!wanted()) {
              await perHour.incrementReservoir(1);
              return;
            }
            await perMinute.schedule(async () => {
              if (!wanted()) {
                await refund();
                return;
              }
              state = 'running';
              clearTimeout(timer);
              o.signal.removeEventListener('abort', onAbort);
              try {
                resolve(await fn());
              } catch (e) {
                // why: reserve refused before anything was sent; the tokens go back for the next caller.
                if (e instanceof BudgetExceeded) await refund();
                reject(e);
              }
            });
          })
          .catch((e: unknown) => {
            if (state !== 'queued') return;
            leave();
            reject(e instanceof Error ? e : new Error(String(e)));
          });
      });
    },
  };
}
