import { describe, expect, it } from 'vitest';
import { searchApiCallsLeft } from '../../src/lib/searchApiCallsLeft.js';
import { budgetResponse, providersResponse, usage } from '../fixtures.js';

// Design 2026-11-08 Ruling 10: one helper, which the top bar and the new-search panel share, says how many SearchApi
// calls are left in the window the plan uses.

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

describe('searchApiCallsLeft', () => {
  it('reads the month on the $40 plan, from the two windows', () => {
    expect(searchApiCallsLeft(both, providers('40usd'))).toEqual({ left: 51, cap: 100, window: 'month' });
  });
  it('reads the one-off allowance on the trial, from the same two windows', () => {
    expect(searchApiCallsLeft(both, providers('trial'))).toEqual({ left: 15, cap: 24, window: 'trial' });
  });
  it('never goes below none left', () => {
    const over = budgetResponse({ scopes: [usage('provider-month:searchapi', 120, 100)] });
    expect(searchApiCallsLeft(over, providers('40usd'))?.left).toBe(0);
  });
  it('is absent when SearchApi is disabled, not listed, or has no usage or no cap', () => {
    expect(searchApiCallsLeft(both, providers('40usd', false))).toBeNull();
    const without = providersResponse();
    expect(
      searchApiCallsLeft(both, {
        ...without,
        providers: without.providers.filter((p) => p.providerId !== 'searchapi'),
      }),
    ).toBeNull();
    expect(searchApiCallsLeft(budgetResponse(), providers('40usd'))).toBeNull();
    const uncapped = budgetResponse({ scopes: [usage('provider-month:searchapi', 5, null)] });
    expect(searchApiCallsLeft(uncapped, providers('40usd'))).toBeNull();
  });
});
