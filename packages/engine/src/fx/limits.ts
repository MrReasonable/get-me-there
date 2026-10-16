import type { Config } from '@gmt/core';
import type { ProviderHttpLimits } from '@gmt/providers';

/**
 * The http-kit policy of the FX client (decision 32: it lives beside the client; WP4b's httpLimitsFor imports it):
 * frankfurter's host only (decision 2: the `.app` host redirects and http-kit refuses redirects), a polite rate,
 * never billable, never ledgered (spec §5.3).
 */
export function fxHttpLimits(
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: ['api.frankfurter.dev'],
    ratePerMinute: 10,
    ratePerHour: 100,
    concurrency: 1,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
  };
}
