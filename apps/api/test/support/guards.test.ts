// The setup file's network guards are live in apps/api (r2-ts-006): an unstubbed request to a vendor host fails in
// process and is recorded as a stray (cleared here, so the guard's afterEach does not fail this test).
import dns from 'node:dns';
import { takeStrays } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';

describe('apps/api network guards (plan decision 18)', () => {
  it('an unstubbed fetch to a vendor host is refused in process and recorded as a stray', async () => {
    await expect(fetch('https://www.searchapi.io/api/v1/search?engine=google_flights')).rejects.toThrow();
    expect(takeStrays()).toEqual(['GET https://www.searchapi.io/api/v1/search']);
  });

  it('a DNS lookup in process is refused with ENOTFOUND, so nothing unstubbed can resolve a host (ts minor 3)', async () => {
    const error = await new Promise<unknown>((resolve) => {
      dns.lookup('www.searchapi.io', (e) => resolve(e));
    });
    expect(error).toMatchObject({ code: 'ENOTFOUND', message: expect.stringContaining('www.searchapi.io') });
  });
});
