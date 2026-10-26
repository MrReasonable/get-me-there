import {
  AbortedError,
  BudgetExceeded,
  type ErrorReason,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  ProviderError,
  stripUrlsInText,
} from '@gmt/core';

/** Upstream errors whose `reason` names a non-retryable outcome of its own (spec §5.4, §7; decision 37). */
const KEPT_REASONS = ['no-return-legs', 'no-priced-options'] as const satisfies readonly ErrorReason[];

/** What the engine does with one failed tile or cell call (spec §8.1 error table, both stages). */
export type FailureDecision =
  | { kind: 'abort' }
  | {
      kind: 'cell-error';
      reason: ErrorReason;
      lastError: string;
      parse: boolean;
      /**
       * A camoufox page that did not settle within its page timeout (`parse`, reason `page-not-ready`): Ian's ruling of
       * 2026-10-26 (spec §8.1 rev 49) lets three in a row, not two, disable the provider.
       */
      notReady: boolean;
      disableProvider: boolean;
      /** camoufox's worker refused the connection (spec §8.1 rev 32): disabled for the run as provider_unavailable. */
      unavailable: boolean;
      /** A block's cool-down end, as the worker stated it (fix round 1, arch I1); keys the once-per-cool-down notice. */
      cooldownUntil: IsoDateTime | null;
    }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded }
  | { kind: 'fatal'; message: string };

/** `at` plus `seconds`, minted through core's helper (the as* helpers are the only brand mint sites). */
export function addSeconds(at: IsoDateTime, seconds: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) + seconds * 1000);
}

/**
 * Pure classification. Order matters: an abort wins over whatever error it caused; a budget breach is never a cell
 * error (spec §8.1 "BudgetExceeded is never recorded as error").
 *
 * The stored `reason` is the error kind, except `no-return-legs` and `no-priced-options` (spec §5.4), each its own reason
 * in core's closed list (decision 37), which spec §7's resume query excludes by reason. The vendor's message goes to
 * `last_error`, URL-free (spec §3).
 */
export function classifyFailure(err: unknown, aborted: boolean, now: IsoDateTime): FailureDecision {
  if (err instanceof AbortedError || aborted) return { kind: 'abort' };
  if (err instanceof BudgetExceeded) return { kind: 'budget', error: err };
  if (err instanceof ProviderError) {
    // why: decision 15 — http-kit sets retryAfterSeconds on every limiter-timeout to the exhausted reservoir's refresh
    // (or the vendor's Retry-After); without it there is no known reopen time, so no one-shot job
    if (err.kind === 'limiter-timeout')
      return {
        kind: 'limiter-timeout',
        resumeAfter: err.retryAfterSeconds === undefined ? null : addSeconds(now, err.retryAfterSeconds),
      };
    const kept = err.kind === 'upstream' ? KEPT_REASONS.find((r) => r === err.reason) : undefined;
    return {
      kind: 'cell-error',
      reason: kept ?? err.kind,
      lastError: stripUrlsInText(err.message),
      parse: err.kind === 'parse',
      notReady: err.kind === 'parse' && err.providerId === 'camoufox' && err.reason === 'page-not-ready',
      // why: spec §8.1 rev 32: a camoufox block disables the provider like auth and quota do
      disableProvider: err.kind === 'auth' || err.kind === 'quota' || err.kind === 'blocked',
      unavailable: err.kind === 'provider-unavailable',
      cooldownUntil: err.cooldownUntil ?? null,
    };
  }
  return { kind: 'fatal', message: errorText(err) };
}

/** Message text for any thrown value, URL-free (spec §5.3 secret scrubbing). */
export function errorText(err: unknown): string {
  return stripUrlsInText(err instanceof Error ? err.message : String(err));
}
