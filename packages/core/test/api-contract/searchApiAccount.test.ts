import { describe, expect, it } from 'vitest';
import { ROUTES, searchApiAccountResponseSchema } from '../../src/api-contract/index.js';

const account = {
  remaining: 38,
  monthlyAllowance: 0,
  periodEnd: null,
  fetchedAt: '2026-11-19T14:05:00.000Z',
};

describe('GET /api/searchapi/account (settings plan ruling 10)', () => {
  it('is an authenticated GET route answered by the account response', () => {
    const r = ROUTES.find((x) => x.method === 'GET' && x.path === '/api/searchapi/account');
    expect(r?.auth).toBe('required');
    expect(r?.response).toBe(searchApiAccountResponseSchema);
  });
  it('takes a balance or null, with the reset day as a date or null', () => {
    expect(searchApiAccountResponseSchema.safeParse({ account: null }).success).toBe(true);
    expect(searchApiAccountResponseSchema.safeParse({ account }).success).toBe(true);
    expect(
      searchApiAccountResponseSchema.safeParse({ account: { ...account, periodEnd: '2026-12-01' } }).success,
    ).toBe(true);
  });
  it.each([
    ['a negative balance', { ...account, remaining: -1 }],
    ['a fractional balance', { ...account, remaining: 1.5 }],
    ['a reset day that is not a date', { ...account, periodEnd: 'soon' }],
    ['a read time that is not an instant', { ...account, fetchedAt: 'now' }],
  ])('refuses %s', (_name, bad) => {
    expect(searchApiAccountResponseSchema.safeParse({ account: bad }).success).toBe(false);
  });
});
