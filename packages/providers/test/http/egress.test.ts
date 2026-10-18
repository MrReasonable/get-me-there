import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_TOKEN_PARAMS, CREDENTIAL_WORDS, isCredentialParam } from '../../src/http/egress.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { TRAVELPAYOUTS_PARAMS } from '../../src/travelpayouts/params.js';
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
  // why: CodeRabbit batch 3 and PR #3 review — the value check knows only configured secrets, so an unconfigured key
  // in a credential parameter (?api_key=…) passed, reached fetch and could be recorded. A name is refused when any
  // of its words (split on _, - and camelCase) is a credential word; SearchApi's two itinerary tokens are the only
  // exceptions. Every case is derived from the exported lists, so a removed entry fails a test.
  const refusedName = async (name: string) => {
    const err = await refused({ url: `${SEARCH}?engine=google_flights&${name}=not-a-configured-secret-9f` });
    expect(err.message).toContain(`credential query parameter ${name.toLowerCase()}`);
    expect(err.message).not.toContain('not-a-configured-secret-9f');
  };
  it.each([...CREDENTIAL_WORDS])('refuses the credential word %s as a whole name', refusedName);
  it.each([...CREDENTIAL_WORDS].map((w) => `x_${w}`))('refuses %s (the word as a suffix)', refusedName);
  it.each([...CREDENTIAL_WORDS].map((w) => `${w}_base`))('refuses %s (the word as a prefix)', refusedName);
  it.each([
    'API_KEY',
    'api-key',
    'apiKey',
    'accessToken',
    'X-Access-Token',
    'x-auth-token',
    'secret_key_base',
    'session_token',
    'private_key',
    'client_secret',
  ])('refuses %s (case, hyphen and camelCase forms)', refusedName);
  it('allows the itinerary-token parameters SearchApi steps 2 and 3 send', async () => {
    const { kit } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    for (const name of ALLOWED_TOKEN_PARAMS)
      expect(
        (await drive(kit.request(req({ url: `${SEARCH}?engine=google_flights&${name}=WyJDalJJ` })))).body,
      ).toEqual({ ok: true });
  });
  it.each(['departure_token_x', 'x_departure_token', 'departureToken2'])(
    'refuses %s: only the exact itinerary-token names are allowed',
    refusedName,
  );
  it('an allowed itinerary token beside a credential name is still refused', async () => {
    const err = await refused({
      url: `${SEARCH}?engine=google_flights&departure_token=WyJD&access_token=abc123`,
    });
    expect(err.message).toContain('credential query parameter access_token');
  });
  it('a google_flights request with show_cheapest_flights=true passes the credential-name rule', async () => {
    const { kit } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    expect(isCredentialParam('show_cheapest_flights')).toBe(false);
    const url = `${SEARCH}?engine=google_flights&sort_by=price&show_cheapest_flights=true`;
    expect((await drive(kit.request(req({ url })))).body).toEqual({ ok: true });
  });
  it('every parameter name the adapters send passes the name check', () => {
    const names = [SEARCHAPI_PARAMS, TRAVELPAYOUTS_PARAMS].flatMap((a) =>
      Object.values(a.endpoints).flatMap((e) => e.names),
    );
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => isCredentialParam(n))).toEqual([]);
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

describe('fixture host pinning and credential sentinels on fx and fixture requests (security review minors 1–2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('refuses limits.fixture whose hosts are not exactly fixture.local', () => {
    expect(() => makeKit({ overrides: { fixture: { hosts: ['evil.example'] } } })).toThrow(/fixture\.local/);
    expect(() => makeKit({ overrides: { fixture: { hosts: ['fixture.local', 'evil.example'] } } })).toThrow(
      /fixture\.local/,
    );
  });
  it.each(['searchapi', 'travelpayouts', 'fx'] as const)(
    'refuses fixture.local in the %s host list',
    (id) => {
      expect(() =>
        makeKit({ overrides: { [id]: { hosts: [testLimits()[id].hosts[0] ?? '', 'fixture.local'] } } }),
      ).toThrow(/fixture\.local/);
    },
  );
  it.each([
    ['fx', 'https://api.frankfurter.dev/v1/latest'],
    ['fixture', 'http://fixture.local/health'],
  ] as const)(
    'refuses a %s request carrying a secret under any header name or in its body',
    async (providerId, url) => {
      const run = async (o: Partial<Parameters<typeof req>[0]>) => {
        const { kit, budget } = makeKit();
        const err = asProviderError(
          await driveError(kit.request(req({ url, providerId, headers: {}, ...o }))),
        );
        expect(err.message).toContain('[egress-denied]');
        expect(err.message).not.toContain(SENTINELS.smtp.reveal());
        expect(budget.count('fetch')).toBe(0);
      };
      await run({ headers: { 'x-rapidapi-key': SENTINELS.searchapi.reveal() } });
      await run({ headers: { 'x-note': `b64 ${Buffer.from(SENTINELS.smtp.reveal()).toString('base64')}` } });
      await run({ method: 'POST', body: JSON.stringify({ k: SENTINELS.travelpayouts.reveal() }) });
    },
  );
});
