import { asIata, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { FIXED_PARAMS, PAGE_LIMIT, PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ALLOWLIST,
  ctx,
  discoveryOf,
  envelope,
  eventsOf,
  makeHarness,
  makeProvider,
  only,
  query,
  TOKEN,
} from './harness.js';

const tp = {
  origin: 'LON',
  pairOrigin: asIata('LHR'),
  destination: asIata('JFK'),
  month: asIsoMonth('2027-03'),
};
const sent = (): URL => buildRequestUrl(tp, 1);

describe('assertRequestAllowed (WP4) on Travelpayouts requests (spec §5.2: names and values)', () => {
  it('accepts exactly what the adapter sends', () => {
    expect(() => assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, sent())).not.toThrow();
  });

  it.each([
    ['an extra parameter', (u: URL) => u.searchParams.set('sorting', 'price')],
    ['market (ignored by the vendor, spec §2 fact 1)', (u: URL) => u.searchParams.set('market', 'uk')],
    ['trip_class (ignored by the vendor)', (u: URL) => u.searchParams.set('trip_class', '1')],
    ['return_at (month tiles send none)', (u: URL) => u.searchParams.set('return_at', '2027-03')],
    ['a wrong fixed value', (u: URL) => u.searchParams.set('currency', 'usd')],
    ['a duplicated parameter', (u: URL) => u.searchParams.append('origin', 'LGW')],
  ] as const)('refuses %s', (_label, mutate) => {
    const u = sent();
    mutate(u);
    expect(() => assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, u)).toThrow();
  });

  it('refuses a token parameter without echoing its value', () => {
    const u = sent();
    u.searchParams.set('token', TOKEN.reveal());
    let caught: unknown;
    try {
      assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, u);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(TOKEN.reveal());
  });

  it('the page size sent is the page size the short-page rule uses (arch-015)', () => {
    expect(FIXED_PARAMS.limit).toBe(String(PAGE_LIMIT));
  });
});

describe('requests on the wire', () => {
  it('carry exactly the allowlisted names and values, the metro origin, and the token only in X-Access-Token', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    server.use(
      http.get(TP, ({ request }) => {
        seen.push({ url: request.url, token: request.headers.get('x-access-token') });
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    await d.fetchTile(only(d.plan(q)), q, ctx());
    const req = only(seen);
    expect(Object.fromEntries(new URL(req.url).searchParams)).toEqual({
      origin: 'LON',
      destination: 'JFK',
      departure_at: '2027-03',
      one_way: 'false',
      currency: 'gbp',
      limit: '1000',
      page: '1',
    });
    expect(req.token).toBe(TOKEN.reveal());
    expect(req.url).not.toContain(TOKEN.reveal());
    // the token reaches no log line and no ledger row (spec §5.3 sentinel rule)
    expect(h.log.lines.join('\n')).not.toContain(TOKEN.reveal());
    expect(JSON.stringify(eventsOf(h, 'reserve'))).not.toContain(TOKEN.reveal());
  });

  it('an adapter request outside the allowlist is refused before any request is sent', async () => {
    const h = makeHarness();
    const narrow = {
      ...ALLOWLIST,
      endpoints: { [PRICES_FOR_DATES_PATH]: { names: ['origin'], values: { origin: 'any' as const } } },
    };
    const d = discoveryOf(makeProvider(h, { paramsAllowlist: narrow }));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx())).rejects.toThrow(/not in the/);
    expect(h.events).toEqual([]);
  });
});
