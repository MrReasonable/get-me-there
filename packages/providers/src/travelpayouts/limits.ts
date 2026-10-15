/**
 * Travelpayouts HTTP limits for http-kit. Spec §2 (free, 600/min), §5.3 (never billable, per-provider host
 * allowlist). Registered by apps/api httpLimitsFor (Task 6.10).
 */
import type { Config, ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/types.js';
import { TRAVELPAYOUTS_HOST } from './params.js';

/** Vendor per-minute ceiling for prices_for_dates (spec §2; docs/providers.md). */
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE = 600;

/**
 * Wait for a 429 that carries no Retry-After (spec §5.2: "Travelpayouts 60 s"). why: the vendor states its limits
 * per minute (docs/providers.md, help article 4402565416594), so a refused request can succeed once the minute turns
 * over. Retry-After itself is unverified against this vendor (no 429 was recorded, plan decision 20).
 */
export const TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS = 60;

/**
 * The configured limits with the rate clamped to the vendor's ceiling; never billable, cost 0.
 * why: no classifyError, because WP4's default table already maps every Travelpayouts case spec §5.2 lists
 * (401/403 → auth, 400 → parse, 402 → quota, 404 → upstream, 429 → rate-limit, 5xx → upstream); there is nothing
 * vendor-specific to recognise, and http-kit applies Retry-After, the fallback wait and limiter-timeout either way.
 */
export function travelpayoutsHttpLimits(
  limits: ProviderLimits,
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: [TRAVELPAYOUTS_HOST],
    ratePerMinute: Math.min(limits.ratePerMinute, TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE),
    ratePerHour: limits.ratePerHour,
    concurrency: limits.concurrency,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
    rateLimitFallbackWaitSeconds: TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS,
  };
}
