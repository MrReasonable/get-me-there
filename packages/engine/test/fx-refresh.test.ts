import { asIsoDate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { fxHttpLimits } from '../src/fx/limits.js';
import { FRANKFURTER_LATEST_URL, parseFrankfurter, refreshFx } from '../src/fx/refresh.js';
import { FX_SOURCE } from '../src/normalise.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import { createHarness } from './support/harness.js';
import { mapPrices } from './support/wrappers.js';

const body = frankfurterBody({ USD: 1.27, JPY: 190.5, XAU: 0.0004 });

describe('FX refresh (spec §5.3 "FX refresh goes through http-kit under the id fx", §5.6)', () => {
  it('calls the .dev/v1 URL on the only host the fx limits allow (plan decisions 2, 32)', () => {
    expect(FRANKFURTER_LATEST_URL).toBe('https://api.frankfurter.dev/v1/latest?from=GBP');
    expect(fxHttpLimits({ maxWaitSeconds: 60, requestTimeoutSeconds: 10 })).toMatchObject({
      hosts: ['api.frankfurter.dev'],
      billable: 'never',
      costPerCallMicroGbp: 0,
    });
  });

  it('fetches the latest GBP rates through http-kit, stores GBP-per-unit × 1e9 for ECB currencies only, never ledgered', async () => {
    const h = createHarness();
    const stub = stubFrankfurter(() => Response.json(body));
    const r = await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    expect(r).toEqual({ date: '2026-10-14', stored: 2 });
    expect(stub.urls).toEqual(['https://api.frankfurter.dev/v1/latest?from=GBP']);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'USD')).toBe(787_401_575);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'JPY')).toBe(5_249_344);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'XAU')).toBeNull();
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())?.source).toBe(FX_SOURCE);
    // why: plan decision 2 — 'fx' goes through http-kit but is never ledgered
    expect(h.count('provider_requests')).toBe(0);
  });

  it.each([
    ['another base', { ...body, base: 'EUR' }],
    ['no rates', { amount: 1, base: 'GBP', date: '2026-10-14' }],
    ['a bad date', { ...body, date: '14/10/2026' }],
    ['a non-positive rate', { ...body, rates: { USD: 0 } }],
    // why: rates[C] is units of C per `amount` GBP; the stored rate assumes 1, so any other amount is refused (prov M2)
    ['an amount other than 1', { ...body, amount: 100 }],
  ])('rejects %s as a parse error and stores nothing', async (_n, bad) => {
    expect(parseFrankfurter(bad)).toBeInstanceOf(ProviderError);
    const h = createHarness();
    stubFrankfurter(() => Response.json(bad));
    await expect(
      refreshFx(buildContext(h.deps, h.options), new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).toBeNull();
  });

  it.each([
    [
      'a 301 to another URL (http-kit refuses redirects)',
      () => new Response(null, { status: 301, headers: { location: 'https://api.frankfurter.app/latest' } }),
      1,
    ],
    [
      '429 after retries',
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }),
      3,
    ],
    ['503 after retries', () => new Response('down', { status: 503 }), 3],
    ['a network error after retries', () => Response.error(), 3],
  ])(
    '%s → a ProviderError; the stored rates are untouched; nothing is ledgered',
    async (_n, answer, attempts) => {
      const h = createHarness({ fakeTimers: true });
      h.repos.fx.upsert([
        { date: asIsoDate('2026-10-13'), currency: 'USD', rateNano: 790_000_000, source: FX_SOURCE },
      ]);
      const stub = stubFrankfurter(answer);
      await expect(
        h.drive(refreshFx(buildContext(h.deps, h.options), new AbortController().signal)),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(stub.urls).toHaveLength(attempts);
      expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).toMatchObject({
        rateNano: 790_000_000,
        date: '2026-10-13',
      });
      expect(h.count('provider_requests')).toBe(0);
    },
  );

  it('after a refresh, USD calendar prices convert instead of failing fx-unavailable', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    stubFrankfurter(() => Response.json(body));
    await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(28);
  });
});
