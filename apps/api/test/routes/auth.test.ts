// Spec §4 basic auth, the failed-auth rate limit, auth over static files, the SPA fallback.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import type { Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FailedAuthLimiter } from '../../src/middleware/auth.js';
import type { AppEnv } from '../../src/routes/types.js';
import { errorOf } from '../helpers/contract.js';
import { SENTINEL_AUTH } from '../helpers/env.js';
import { AUTH_USER, basic, createHarness, type Harness, T0 } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

const WRONG = basic(AUTH_USER, 'wrong-password-000');
const RIGHT = basic(AUTH_USER, SENTINEL_AUTH);
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const byTestIp = { clientIp: (c: Context<AppEnv>) => c.req.header('x-test-ip') ?? null };

async function harness(opts: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  h = await createHarness(opts);
  return h;
}

describe('basic auth gate (spec §4)', () => {
  it('401 with a challenge without or with wrong credentials, 200 with the right ones', async () => {
    const x = await harness();
    const none = await x.request('/api/providers', { auth: false });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Basic');
    expect((await x.request('/api/providers', { headers: { authorization: WRONG } })).status).toBe(401);
    expect((await x.request('/api/providers', { headers: { authorization: RIGHT } })).status).toBe(200);
  });

  it('GET /api/health is public and minimal without credentials', async () => {
    const x = await harness();
    const res = await x.request('/api/health', { auth: false });
    expect(res.status).toBe(200);
    expect(Object.keys(z.looseObject({}).parse(await res.json())).sort()).toEqual(['degraded', 'ok']);
  });

  it('with no credentials configured on loopback no credentials are needed', async () => {
    const x = await harness({ env: { APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' } });
    expect((await x.request('/api/providers', { auth: false })).status).toBe(200);
  });
});

describe('failed-auth rate limit (spec §4, plan decision 54)', () => {
  const as = (x: Harness, authorization: string, ip: string, path = '/api/providers') =>
    x.request(path, { headers: { authorization, 'x-test-ip': ip } }).then((r) => r.status);

  it('5 failures from one IP limit that IP for a minute, not others; a correct credential always succeeds', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect(await as(x, WRONG, '203.0.113.7')).toBe(401);
    const blocked = await x.request('/api/providers', {
      headers: { authorization: WRONG, 'x-test-ip': '203.0.113.7' },
    });
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('auth_rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('cache-control')).toBe('no-store'); // decision 58: refusals are no-store too
    // why: decision 54: the limit slows guessing; it never locks out the operator, who knows the password
    expect(await as(x, RIGHT, '203.0.113.7')).toBe(200);
    expect(await as(x, WRONG, '203.0.113.8')).toBe(401);
    x.clock.advance(61_000);
    expect(await as(x, WRONG, '203.0.113.7')).toBe(401);
  });

  it('wrong credentials on the public /api/health still count; no credentials never do', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect(await as(x, WRONG, '203.0.113.9', '/api/health')).toBe(200);
    expect(await as(x, WRONG, '203.0.113.9')).toBe(429);
    for (let i = 0; i < 30; i++)
      await x.request('/api/health', { auth: false, headers: { 'x-test-ip': '198.51.100.1' } });
    expect(await as(x, WRONG, '198.51.100.1')).toBe(401);
  });

  it('the global fallback: 20 failures a minute over many IPs refuse the next wrong attempt from any IP; a correct credential still succeeds (spec §4, ruling 13)', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 20; i++) expect(await as(x, WRONG, `198.51.100.${i}`)).toBe(401);
    expect(await as(x, WRONG, '192.0.2.1')).toBe(429);
    // why: decision 54 still holds: the limit slows guessing and never locks out the operator, who knows the password.
    expect(await as(x, RIGHT, '192.0.2.1')).toBe(200);
    x.clock.advance(61_000);
    expect(await as(x, WRONG, '192.0.2.1')).toBe(401);
  });

  it('19 failures over many IPs are under the global fallback', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 19; i++) await as(x, WRONG, `198.51.100.${i}`);
    expect(await as(x, WRONG, '192.0.2.1')).toBe(401);
  });

  it('holds at most maxSources addresses, dropping the least recently failing one (review SEC-R2-1)', () => {
    const clock = fixedClock(T0);
    const limiter = new FailedAuthLimiter(clock, {
      perIp: 2,
      global: 1_000,
      windowMs: 60_000,
      maxSources: 3,
    });
    for (const ip of ['a', 'b', 'c']) limiter.recordFailure(ip);
    limiter.recordFailure('a'); // a is now the most recent
    expect(limiter.retryAfterSeconds('a')).not.toBeNull();
    limiter.recordFailure('d'); // evicts b, the least recently failing
    expect(limiter.sources).toBe(3);
    for (let i = 0; i < 100; i++) limiter.recordFailure(`spray-${i}`);
    expect(limiter.sources).toBe(3);
    expect(limiter.retryAfterSeconds('a')).toBeNull(); // evicted by the spray: forgotten, never grown
  });

  it('TRUST_PROXY=true keys on the last X-Forwarded-For entry', async () => {
    const x = await harness({ env: { TRUST_PROXY: 'true' } });
    const xff = (authorization: string, chain: string) =>
      x
        .request('/api/providers', { headers: { authorization, 'x-forwarded-for': chain } })
        .then((r) => r.status);
    for (let i = 0; i < 5; i++) await xff(WRONG, '198.51.100.7');
    expect(await xff(WRONG, '198.51.100.7')).toBe(429);
    expect(await xff(WRONG, '198.51.100.7, 198.51.100.8')).toBe(401);
  });

  it('TRUST_PROXY=false ignores X-Forwarded-For: every unknown-IP request shares one bucket', async () => {
    const x = await harness();
    for (let i = 0; i < 5; i++)
      await x.request('/api/providers', {
        headers: { authorization: WRONG, 'x-forwarded-for': `198.51.100.${i}` },
      });
    // why: no socket under app.request() and no trusted proxy, so the five spoofed addresses were one source
    const res = await x.request('/api/providers', {
      headers: { authorization: WRONG, 'x-forwarded-for': '203.0.113.1' },
    });
    expect(res.status).toBe(429);
  });
});

describe('the Basic scheme is case-insensitive (RFC 7235; security review Minor 2)', () => {
  it.each(['basic', 'BASIC', 'bAsIc'])('accepts the %s scheme with a valid credential', async (scheme) => {
    const x = await harness();
    const token = RIGHT.slice('Basic '.length);
    const res = await x.request('/api/providers', { headers: { authorization: `${scheme} ${token}` } });
    expect(res.status).toBe(200);
  });
  it('still refuses another scheme', async () => {
    const x = await harness();
    const token = RIGHT.slice('Basic '.length);
    expect(
      (await x.request('/api/providers', { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
  });
});

describe('static files and SPA fallback (spec §4, §13)', () => {
  function webRoot(dir = tempDir('gmt-web-')): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>gmt</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1);');
    return dir;
  }

  it('static files need auth', async () => {
    const x = await harness({ app: { webRoot: webRoot() } });
    expect((await x.request('/', { auth: false })).status).toBe(401);
    expect((await x.request('/assets/app.js', { auth: false })).status).toBe(401);
  });

  it('serves files, falls back to index.html for SPA paths, and never for /api', async () => {
    const x = await harness({ app: { webRoot: webRoot() } });
    const index = await x.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<title>gmt</title>');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    const js = await x.request('/assets/app.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await (await x.request('/results/abc')).text()).toContain('<title>gmt</title>');
    const api = await x.request('/api/nope');
    expect(api.status).toBe(404);
    expect((await errorOf(api)).code).toBe('not_found');
    expect((await x.request('/somewhere', { method: 'POST', json: {} })).status).toBe(404);
  });

  it('every response is no-store: static files, the SPA fallback, and the non-API 401 and 403 (security review Minor 1)', async () => {
    const x = await harness({ app: { webRoot: webRoot() } });
    const responses = [
      await x.request('/'),
      await x.request('/assets/app.js'),
      await x.request('/results/abc'),
      await x.request('/', { auth: false }),
      await x.request('/', { headers: { host: 'evil.example' } }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 401, 403]);
    for (const r of responses) expect(r.headers.get('cache-control'), String(r.status)).toBe('no-store');
  });

  it.each([
    '/..%2fsecret.txt',
    '/..%2f..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
  ])('never serves a file outside the web root: %s (security review Minor 3)', async (path) => {
    // why: the web root sits inside a private temp dir that also holds the file a traversal would reach.
    const outside = tempDir('gmt-trav-');
    writeFileSync(join(outside, 'secret.txt'), 'outside-the-web-root');
    const root = webRoot(join(outside, 'web'));
    const x = await harness({ app: { webRoot: root } });
    const res = await x.request(path);
    expect(await res.text()).not.toContain('outside-the-web-root');
  });
});
