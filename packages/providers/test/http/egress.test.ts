import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS, TP, testLimits } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const key = SENTINELS.searchapi.reveal();

describe('egress allowlist (spec §5.3 "Egress")', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  const refused = async (r: Parameters<typeof req>[0]) => {
    const { kit, budget } = makeKit();
    const err = asProviderError(await driveError(kit.request(req(r))));
    expect(err).toMatchObject({
      kind: 'upstream',
      retryable: false,
      message: expect.stringContaining('[egress-denied]'),
    });
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('fetch')).toBe(0);
    return err;
  };

  it('refuses a host outside the provider allowlist before reserve, naming the host', async () => {
    expect((await refused({ url: TP })).message).toContain('api.travelpayouts.com');
  });
  it('refuses plain http for a real vendor', async () => {
    await refused({ url: 'http://www.searchapi.io/api/v1/search' });
  });
  it('refuses userinfo in the URL', async () => {
    await refused({ url: 'https://someone:pw@www.searchapi.io/api/v1/search' });
  });
  it('refuses an explicit port (sec-005)', async () => {
    await refused({ url: 'https://www.searchapi.io:8443/api/v1/search' });
  });
  it('refuses a credential in the query, keeping it out of the message', async () => {
    expect((await refused({ url: `${SEARCH}?api_key=${key}` })).message).not.toContain(key);
  });
  it('refuses a credential smuggled into a hostname without echoing it (sec-005)', async () => {
    expect((await refused({ url: `https://${key}.evil.example/api/v1/search` })).message).not.toContain(key);
  });
  it('refuses an endpointPath that is not the URL path or carries a query', async () => {
    await refused({ url: SEARCH, endpointPath: '/api/v1/search?engine=x' });
    await refused({ url: SEARCH, endpointPath: '/other' });
  });
  it('refuses a provider id with no limits configured', async () => {
    const limits = testLimits();
    const { kit, budget } = makeKit({ limits: { searchapi: limits.searchapi, fx: limits.fx } });
    expect(
      await driveError(kit.request(req({ url: TP, providerId: 'travelpayouts', headers: {} }))),
    ).toMatchObject({ message: expect.stringContaining('[egress-denied]') });
    expect(budget.reserveCalls).toBe(0);
  });
  it.each([
    'https://www.searchapi.io.evil.example/api/v1/search',
    'https://evil.example/www.searchapi.io',
    'https://www.searchapi.io@evil.example/api/v1/search',
    'https://www.searchapi.io./api/v1/search',
    'https://www.searchаpi.io/api/v1/search',
    'https://www.searchapi.io\\@evil.example/api/v1/search',
  ])('refuses the lookalike %s (sec-004)', async (url) => {
    await refused({ url, endpointPath: '/api/v1/search' });
  });
  it('an upper-case host is normalised by URL to the allowlisted host and allowed', async () => {
    const { kit } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    expect((await drive(kit.request(req({ url: 'https://WWW.SEARCHAPI.IO/api/v1/search' })))).body).toEqual({
      ok: true,
    });
  });
  it.each([
    ['fx', 'https://api.frankfurter.dev/v1/latest?from=GBP'],
    ['fixture', 'http://fixture.local/health'],
  ] as const)('refuses any credential header on a %s request (ruling 13)', async (providerId, url) => {
    await refused({ url, providerId, headers: { 'X-Access-Token': SENTINELS.travelpayouts.reveal() } });
  });
  it('allows plain http only for the fixture host', async () => {
    const { kit } = makeKit();
    server.use(
      http.get('http://fixture.local/health', () => HttpResponse.json({ synthetic: true, ok: true })),
    );
    expect(
      (
        await drive(
          kit.request(req({ url: 'http://fixture.local/health', providerId: 'fixture', headers: {} })),
        )
      ).body,
    ).toEqual({ synthetic: true, ok: true });
    await refused({ url: 'http://fixture.local/health', providerId: 'travelpayouts', headers: {} });
  });
});
