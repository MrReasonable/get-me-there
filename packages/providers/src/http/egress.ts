import { ProviderError, type Secret } from '@gmt/core';
import { FIXTURE_HOST } from '../fixture/constants.js';
import { CREDENTIAL_HEADERS } from './cacheKey.js';
import { containsSecret } from './scrub.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits } from './types.js';

const PATH_ONLY = /^\/[^?#]*$/;
/** Shortest secret http-kit accepts; matches scripts/secret-scan.mjs (sec-003). */
export const MIN_SECRET_LENGTH = 8;

/**
 * Construction checks (ruling 7, sec-003): the in-process seam names fixture.local only; it and limits.fixture
 * need syntheticAllowed; every non-empty secret is at least MIN_SECRET_LENGTH long; a real provider needs at
 * least one secret, otherwise scrubbing, the cache-key filter, egress and the recorder would all be silent.
 */
export function assertKitConfig(
  deps: Pick<HttpKitDeps, 'inProcessHosts' | 'limits' | 'syntheticAllowed' | 'secrets'>,
): void {
  const hosts = Object.keys(deps.inProcessHosts ?? {});
  for (const host of hosts)
    if (host !== FIXTURE_HOST) throw new Error(`inProcessHosts may name only ${FIXTURE_HOST}, got ${host}`);
  if ((hosts.length > 0 || deps.limits.fixture !== undefined) && !deps.syntheticAllowed) {
    throw new Error('inProcessHosts and limits.fixture require syntheticAllowed (spec §5.5)');
  }
  // why: the fixture provider's only host is fixture.local, and no real provider may name it: a real provider's
  // request (credential header included) would otherwise be dispatched to the in-process router (security minor 1).
  const fixtureHosts = deps.limits.fixture?.hosts;
  if (fixtureHosts !== undefined && (fixtureHosts.length !== 1 || fixtureHosts[0] !== FIXTURE_HOST))
    throw new Error(`limits.fixture.hosts must be exactly ['${FIXTURE_HOST}']`);
  for (const id of ['searchapi', 'travelpayouts', 'fx'] as const)
    if (deps.limits[id]?.hosts.includes(FIXTURE_HOST))
      throw new Error(`limits.${id}.hosts may not include ${FIXTURE_HOST}`);
  const values = deps.secrets.map((s) => s.reveal()).filter((v) => v !== '');
  if (values.some((v) => v.length < MIN_SECRET_LENGTH))
    throw new Error(`every configured secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (
    (deps.limits.searchapi !== undefined || deps.limits.travelpayouts !== undefined) &&
    values.length === 0
  ) {
    throw new Error('secrets must be non-empty when a real provider is configured');
  }
}

/**
 * Spec §5.3 "Egress", checked before the cache, the ledger or the network: the provider has limits; no secret in
 * any form appears in the URL (checked first, so a key in a hostname never reaches a message); no userinfo; no
 * explicit port; https (plain http only for the fixture provider at fixture.local); the hostname is exactly in the
 * provider's allowlist (URL normalises case); `endpointPath` equals the URL path; `fx` and `fixture` requests carry
 * no credential header (ruling 13).
 */
export function assertEgress(
  r: HttpKitRequest,
  limits: ProviderHttpLimits | undefined,
  secrets: readonly Secret[],
): asserts limits is ProviderHttpLimits {
  const safePath =
    PATH_ONLY.test(r.endpointPath) && !containsSecret(r.endpointPath, secrets)
      ? r.endpointPath
      : '<invalid endpointPath>';
  function deny(why: string): never {
    throw new ProviderError({
      kind: 'upstream',
      retryable: false,
      providerId: r.providerId,
      message: `${r.providerId} ${safePath}: egress denied (${why}) [egress-denied]`,
    });
  }
  if (limits === undefined) deny('no HTTP limits configured for this provider');
  const u = r.url;
  if (containsSecret(u.href, secrets)) deny('a credential appears in the URL');
  if (u.username !== '' || u.password !== '') deny('userinfo in URL');
  if (u.port !== '') deny('explicit port');
  const schemeOk =
    u.protocol === 'https:' ||
    (u.protocol === 'http:' && r.providerId === 'fixture' && u.hostname === FIXTURE_HOST);
  if (!schemeOk) deny(`scheme ${u.protocol} not allowed`);
  if (!limits.hosts.includes(u.hostname)) deny(`host ${u.hostname} not in the allowlist`);
  if (!PATH_ONLY.test(r.endpointPath) || r.endpointPath !== u.pathname)
    deny('endpointPath must equal the URL path');
  if (r.providerId === 'fx' || r.providerId === 'fixture') {
    for (const [name, value] of Object.entries(r.headers)) {
      if (CREDENTIAL_HEADERS.has(name.toLowerCase()))
        deny(`credential header ${name.toLowerCase()} on a ${r.providerId} request`);
      // why: a header name outside the credential list can still carry a key; scan every value (security minor 2).
      if (containsSecret(value, secrets))
        deny(`a credential appears in a header on a ${r.providerId} request`);
    }
    if (r.body !== undefined && containsSecret(r.body, secrets))
      deny(`a credential appears in the body of a ${r.providerId} request`);
  }
}
