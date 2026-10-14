import { ProviderError } from '@gmt/core';
import type { ResponseFacts } from './types.js';

/** Minimal classification: 5xx is retryable upstream, anything else non-retryable upstream. Spec §5.2. */
export function classifyResponse(f: ResponseFacts): ProviderError {
  return new ProviderError({
    kind: 'upstream',
    retryable: f.status >= 500,
    httpStatus: f.status,
    providerId: f.providerId,
    message: `${f.providerId} ${f.endpointPath}: HTTP ${f.status}`,
  });
}
