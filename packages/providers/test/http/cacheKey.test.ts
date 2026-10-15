import { describe, expect, it } from 'vitest';
import { canonicalCacheKey } from '../../src/http/cacheKey.js';
import { ALL_SECRETS, req, SEARCH, SENTINELS } from '../fakes.js';

const url = `${SEARCH}?engine=google_flights&departure_id=LHR&arrival_id=JFK`;

describe('canonicalCacheKey (spec §5.3: sha256 over the credential-free canonical request)', () => {
  it('is 64 lower-case hex characters and never contains a secret', () => {
    const k = canonicalCacheKey(req({ url }), ALL_SECRETS);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    for (const s of ALL_SECRETS) expect(k).not.toContain(s.reveal());
  });
  it('ignores credential headers and their values', () => {
    const a = canonicalCacheKey(
      req({ url, headers: { authorization: `Bearer ${SENTINELS.searchapi.reveal()}` } }),
      ALL_SECRETS,
    );
    const b = canonicalCacheKey(
      req({ url, headers: { authorization: 'Bearer another-key-entirely' } }),
      ALL_SECRETS,
    );
    const c = canonicalCacheKey(
      req({ url, headers: { 'X-Access-Token': SENTINELS.travelpayouts.reveal() } }),
      ALL_SECRETS,
    );
    expect([b, c]).toEqual([a, a]);
  });
  it('is independent of query parameter order', () => {
    const reordered = `${SEARCH}?arrival_id=JFK&engine=google_flights&departure_id=LHR`;
    expect(canonicalCacheKey(req({ url }), ALL_SECRETS)).toBe(
      canonicalCacheKey(req({ url: reordered }), ALL_SECRETS),
    );
  });
  it('changes with any parameter value, the host, the method or the body', () => {
    const base = canonicalCacheKey(req({ url }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url: url.replace('JFK', 'EWR') }), ALL_SECRETS)).not.toBe(base);
    expect(
      canonicalCacheKey(req({ url: url.replace('www.searchapi.io', 'api.travelpayouts.com') }), ALL_SECRETS),
    ).not.toBe(base);
    expect(canonicalCacheKey(req({ url, method: 'POST' }), ALL_SECRETS)).not.toBe(base);
    expect(canonicalCacheKey(req({ url, body: '{"a":1}' }), ALL_SECRETS)).not.toBe(base);
  });
  it('never includes executionId, tileIndex or providerId, so sibling pairs share a cached metro response (plan decision 14)', () => {
    const base = canonicalCacheKey(req({ url, executionId: 'exec-1', tileIndex: 0 }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url, executionId: 'exec-2', tileIndex: 7 }), ALL_SECRETS)).toBe(base);
    expect(canonicalCacheKey(req({ url, executionId: null, tileIndex: null }), ALL_SECRETS)).toBe(base);
    expect(canonicalCacheKey(req({ url, providerId: 'travelpayouts' }), ALL_SECRETS)).toBe(base);
  });
  it('drops a parameter whose value is a secret, so the key matches the credential-free request', () => {
    const leaky = `${url}&api_key=${SENTINELS.searchapi.reveal()}`;
    expect(canonicalCacheKey(req({ url: leaky }), ALL_SECRETS)).toBe(
      canonicalCacheKey(req({ url }), ALL_SECRETS),
    );
  });
  it('keeps a non-credential header such as accept-language', () => {
    const a = canonicalCacheKey(req({ url, headers: { 'accept-language': 'en' } }), ALL_SECRETS);
    const b = canonicalCacheKey(req({ url, headers: { 'accept-language': 'fr' } }), ALL_SECRETS);
    expect(a).not.toBe(b);
  });
});
