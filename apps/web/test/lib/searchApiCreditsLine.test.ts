import { asIsoDate, asIsoDateTime, type SearchApiAccount } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { searchApiCreditsLine } from '../../src/lib/searchApiCreditsLine.js';
import { budgetResponse, providersResponse, usage } from '../fixtures.js';

// Settings plan ruling 10: one helper words SearchApi's credits left for every caller (the top bar, the panel's Where to
// look, the search form's field): SearchApi's own balance when it was read, this app's count of the window in use when
// it was not.

const providers = (plan: 'trial' | '40usd', enabled = true) => {
  const base = providersResponse();
  return {
    ...base,
    providers: base.providers.map((p) => (p.providerId === 'searchapi' ? { ...p, plan, enabled } : p)),
  };
};
/** Both windows present with different calls, as a plan change leaves them: only the plan says which is in use. */
const both = budgetResponse({
  scopes: [
    usage('provider-month:searchapi', 49, 100),
    usage('provider-lifetime:searchapi', 9, 24),
    usage('global-month', 0, 35_000_000, 0),
  ],
});
const READ_AT = '2026-11-19T14:05:00.000Z';
const readAt = Date.parse(READ_AT);
const account = (over: Partial<SearchApiAccount> = {}): SearchApiAccount => ({
  remaining: 38,
  monthlyAllowance: 0,
  periodEnd: null,
  fetchedAt: asIsoDateTime(READ_AT),
  ...over,
});

describe('searchApiCreditsLine: SearchApi’s own balance', () => {
  it('words the trial’s balance with nothing after it', () => {
    expect(searchApiCreditsLine(account(), both, providers('trial'), readAt)).toEqual({
      left: 38,
      cap: null,
      tail: '',
      line: 'SearchApi: 38 credits left',
    });
  });
  it('adds the day a monthly plan resets', () => {
    const got = searchApiCreditsLine(
      account({ remaining: 9_988, monthlyAllowance: 10_000, periodEnd: asIsoDate('2026-12-01') }),
      both,
      providers('40usd'),
      readAt,
    );
    expect(got).toEqual({
      left: 9_988,
      cap: null,
      tail: '· resets 1 Dec',
      line: 'SearchApi: 9,988 credits left · resets 1 Dec',
    });
  });
  it('adds "as of" with the London time once the read is older than ten minutes (600,000 ms), not before', () => {
    expect(searchApiCreditsLine(account(), both, providers('trial'), readAt + 600_000)?.line).toBe(
      'SearchApi: 38 credits left',
    );
    expect(searchApiCreditsLine(account(), both, providers('trial'), readAt + 600_001)?.line).toBe(
      'SearchApi: 38 credits left · as of 14:05',
    );
    expect(
      searchApiCreditsLine(
        account({ periodEnd: asIsoDate('2026-12-01') }),
        both,
        providers('40usd'),
        readAt + 600_001,
      )?.line,
    ).toBe('SearchApi: 38 credits left · resets 1 Dec · as of 14:05');
  });
  it('says one credit in the singular', () => {
    expect(searchApiCreditsLine(account({ remaining: 1 }), both, providers('trial'), readAt)?.line).toBe(
      'SearchApi: 1 credit left',
    );
  });
  it('says nothing when SearchApi is not enabled or not listed, whatever the balance', () => {
    expect(searchApiCreditsLine(account(), both, providers('40usd', false), readAt)).toBeNull();
    const without = providersResponse();
    expect(
      searchApiCreditsLine(
        account(),
        both,
        { ...without, providers: without.providers.filter((p) => p.providerId !== 'searchapi') },
        readAt,
      ),
    ).toBeNull();
  });
});

describe('searchApiCreditsLine: this app’s count, when SearchApi could not be asked', () => {
  it('reads the month on the $40 plan, from the two windows', () => {
    expect(searchApiCreditsLine(null, both, providers('40usd'))).toEqual({
      left: 51,
      cap: 100,
      tail: "(this app's count)",
      line: "SearchApi: 51 of 100 credits left (this app's count)",
    });
  });
  it('reads the one-off allowance on the trial, from the same two windows', () => {
    expect(searchApiCreditsLine(null, both, providers('trial'))?.line).toBe(
      "SearchApi: 15 of 24 credits left (this app's count)",
    );
  });
  it('never goes below none left', () => {
    const over = budgetResponse({ scopes: [usage('provider-month:searchapi', 120, 100)] });
    expect(searchApiCreditsLine(null, over, providers('40usd'))?.left).toBe(0);
  });
  it('is absent when SearchApi is disabled, not listed, or has no usage or no cap', () => {
    expect(searchApiCreditsLine(null, both, providers('40usd', false))).toBeNull();
    expect(searchApiCreditsLine(null, budgetResponse(), providers('40usd'))).toBeNull();
    const uncapped = budgetResponse({ scopes: [usage('provider-month:searchapi', 5, null)] });
    expect(searchApiCreditsLine(null, uncapped, providers('40usd'))).toBeNull();
  });
});
