// Spec §4 security headers and request hardening.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/app.js';
import { API_TEXT } from '../../src/text.js';
import { errorOf } from '../helpers/contract.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

describe('security headers (spec §4)', () => {
  it.each([
    ['public health', '/api/health', true],
    ['authenticated route', '/api/providers', true],
    ['401', '/api/providers', false],
    ['404', '/api/nothing-here', true],
  ] as const)('%s carries CSP, nosniff and no-referrer', async (_label, path, auth) => {
    const res = await h.request(path, { auth });
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('Host allowlist (spec §4)', () => {
  it('rejects an unknown Host naming the value and the variable, never the allowed hosts, before auth', async () => {
    const res = await h.request('/api/providers', { auth: false, headers: { host: 'evil.example:3000' } });
    expect(res.status).toBe(403);
    const e = await errorOf(res);
    expect(e.code).toBe('host_not_allowed');
    expect(e.message).toBe(API_TEXT.hostRejected('evil.example:3000'));
    expect(e.message).toContain('ALLOWED_HOSTS');
    // why: decision 54: the allowed values would tell a stranger the host names; they go to the log only
    for (const allowed of h.ports.config.allowedHosts) expect(JSON.stringify(e)).not.toContain(allowed);
    expect(h.logLines.join('')).toContain(h.ports.config.allowedHosts[0] ?? 'no allowed host');
  });
  it('names a missing Host as (none)', async () => {
    const res = await h.request('/api/providers', { headers: { host: '' } });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toContain('(none)');
  });
  it('matches case-insensitively', async () => {
    expect((await h.request('/api/providers', { headers: { host: 'LOCALHOST:3000' } })).status).toBe(200);
  });
  it('exempts the public GET /api/health', async () => {
    expect(
      (await h.request('/api/health', { auth: false, headers: { host: 'healthcheck.internal' } })).status,
    ).toBe(200);
  });
});

describe('Origin check (spec §4)', () => {
  it.each(['https://evil.example', 'null', 'http://localhost:9999'])('rejects Origin %s', async (origin) => {
    const res = await h.request('/api/providers', { headers: { origin } });
    expect(res.status).toBe(403);
    const e = await errorOf(res);
    expect(e.code).toBe('origin_not_allowed');
    expect(e.message).toContain(origin);
  });
  it('accepts an allowed Origin and an absent one', async () => {
    expect((await h.request('/api/providers', { headers: { origin: 'http://localhost:3000' } })).status).toBe(
      200,
    );
    expect((await h.request('/api/providers')).status).toBe(200);
  });
});

describe('mutating requests (spec §4)', () => {
  it.each(['POST', 'PUT', 'DELETE'] as const)(
    '%s without Content-Type: application/json → 415',
    async (method) => {
      const res = await h.request('/api/nothing-here', {
        method,
        csrf: false,
        body: 'x',
        headers: { 'content-type': 'text/plain' },
      });
      expect(res.status).toBe(415);
      expect((await errorOf(res)).code).toBe('content_type');
    },
  );
  it('without X-Requested-With: get-me-there → 403', async () => {
    const res = await h.request('/api/nothing-here', {
      method: 'POST',
      csrf: false,
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('requested_with');
  });
  it('with both headers (charset allowed) the request reaches the router', async () => {
    const res = await h.request('/api/nothing-here', {
      method: 'POST',
      csrf: false,
      body: '{}',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-requested-with': 'get-me-there' },
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
  });
  it('GET needs neither', async () => {
    expect((await h.request('/api/providers')).status).toBe(200);
  });
});

describe('body size, caching and cross-origin (reviews SEC-1, SEC-8)', () => {
  it('a body over MAX_BODY_BYTES is 413 before it is parsed', async () => {
    const spy = vi.spyOn(h.engine, 'estimate');
    const res = await h.request('/api/definitions/estimate', {
      method: 'POST',
      body: JSON.stringify({ name: 'x'.repeat(MAX_BODY_BYTES) }),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('body_too_large');
    expect(spy).not.toHaveBeenCalled();
  });

  it('every API response is no-store; none carries an Access-Control header, and a preflight is not approved', async () => {
    for (const path of ['/api/providers', '/api/health', '/api/nothing-here']) {
      const res = await h.request(path, { headers: { origin: 'http://localhost:3000' } });
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      expect(
        [...res.headers.keys()].filter((k) => k.startsWith('access-control-')),
        path,
      ).toEqual([]);
    }
    // decision 58: the refusals too, which return before any route runs (the 429 is pinned in auth.test.ts)
    const refusals = await Promise.all([
      h.request('/api/providers', { auth: false }),
      h.request('/api/providers', { headers: { host: 'evil.example:3000' } }),
      h.request('/api/providers', { headers: { origin: 'https://evil.example' } }),
      h.request('/api/definitions/estimate', { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }),
    ]);
    expect(refusals.map((r) => r.status)).toEqual([401, 403, 403, 413]);
    for (const r of refusals) expect(r.headers.get('cache-control'), String(r.status)).toBe('no-store');
    const preflight = await h.request('/api/definitions', {
      method: 'OPTIONS',
      csrf: false,
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.status).not.toBe(204);
  });
});
