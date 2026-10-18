import { createHash } from 'node:crypto';
import type { Secret } from '@gmt/core';
import { byPair } from '../util.js';
import { containsSecret, scrubSecrets } from './scrub.js';
import type { HttpKitRequest } from './types.js';

/** Header names that carry credentials for any vendor this app talks to; never in a cache key or a recording. */
export const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-access-token',
  'x-api-key',
  'cookie',
  // why: arch-013: the camoufox worker key (WORKER_KEY_HEADER in core's protocol).
  'x-gmt-worker-key',
]);

/**
 * Cache key = sha256 hex over method + credential-free URL (origin, path, sorted query pairs without any
 * secret-bearing pair) + sorted non-credential headers + the body with secrets redacted — nothing else
 * (plan http-kit block). Never `executionId`, `tileIndex` or `providerId`.
 * why: Travelpayouts sibling pairs that share a metro code issue identical requests from different tiles and
 * executions and must share the cached response (plan decision 14, spec §5.2).
 */
export function canonicalCacheKey(r: HttpKitRequest, secrets: readonly Secret[]): string {
  const query = [...r.url.searchParams.entries()]
    .filter(([k, v]) => !containsSecret(k, secrets) && !containsSecret(v, secrets))
    .sort(byPair);
  const headers = Object.entries(r.headers)
    .map(([k, v]): [string, string] => [k.toLowerCase(), v])
    .filter(([k, v]) => !CREDENTIAL_HEADERS.has(k) && !containsSecret(v, secrets))
    .sort(byPair);
  const canonical = JSON.stringify({
    method: r.method,
    origin: r.url.origin,
    path: r.url.pathname,
    query,
    headers,
    body: r.body === undefined ? null : scrubSecrets(r.body, secrets),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
