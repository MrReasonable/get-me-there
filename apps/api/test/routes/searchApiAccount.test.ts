// GET /api/searchapi/account (settings plan ruling 10): SearchApi's own balance, through the pass's cache. The cache is a
// double here; its ten-minute and run-end behaviour is tested in test/read.
import { apiContract, asIsoDate, asIsoDateTime } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { SearchApiAccountPort } from '../../src/read/searchApiAccount.js';
import { expectContract } from '../helpers/contract.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const port = (account: apiContract.SearchApiAccount | null): SearchApiAccountPort => ({
  read: () => Promise.resolve(account),
  runEnded: () => undefined,
  close: () => undefined,
});

describe('GET /api/searchapi/account', () => {
  it('gives the balance the cache holds', async () => {
    const account = {
      remaining: 38,
      monthlyAllowance: 0,
      periodEnd: asIsoDate('2026-12-01'),
      fetchedAt: asIsoDateTime('2026-11-19T14:05:00.000Z'),
    };
    h = await createHarness({ app: { searchApiAccount: port(account) } });
    const body = await expectContract(
      await h.request('/api/searchapi/account'),
      'GET',
      '/api/searchapi/account',
      apiContract.searchApiAccountResponseSchema,
    );
    expect(body).toEqual({ account });
  });

  it('gives null when the cache has none', async () => {
    h = await createHarness({ app: { searchApiAccount: port(null) } });
    const body = await expectContract(
      await h.request('/api/searchapi/account'),
      'GET',
      '/api/searchapi/account',
      apiContract.searchApiAccountResponseSchema,
    );
    expect(body).toEqual({ account: null });
  });

  it('with no SearchApi key set, the app’s own cache answers null and asks nothing', async () => {
    h = await createHarness();
    const res = await h.request('/api/searchapi/account');
    expect(await res.json()).toEqual({ account: null });
  });

  it('needs the basic-auth login', async () => {
    h = await createHarness({ app: { searchApiAccount: port(null) } });
    expect((await h.request('/api/searchapi/account', { auth: false })).status).toBe(401);
  });
});
