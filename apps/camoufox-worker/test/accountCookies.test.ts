import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_COOKIE_NAMES, accountCookiesIn, checkAccountCookies } from '../src/accountCookies.js';
import { FakeContext } from './support/fakeContext.js';

// Brief §6, verbatim and independent of the module's list (so a mutated name in the module is caught).
const BRIEF_NAMES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
  'SIDCC',
  'LSID',
  '__Host-1PLSID',
  '__Host-3PLSID',
  '__Host-GAPS',
  'OSID',
  '__Secure-OSID',
  'ACCOUNT_CHOOSER',
];
const c = (name: string, domain: string, value = 'synthetic-value-never-logged') => ({
  name,
  value,
  domain,
  path: '/',
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('account cookies (spec §2; brief §6; ruling 8, PIE-R2-08, SEC-R2-002)', () => {
  it('the dated set is exactly the 21 names of brief §6', () => {
    expect([...ACCOUNT_COOKIE_NAMES].sort()).toEqual([...BRIEF_NAMES].sort());
  });
  it.each(BRIEF_NAMES)('%s on .google.com is a signed-in profile', (name) => {
    expect(accountCookiesIn([c(name, '.google.com')])).toEqual({ found: true, names: [name] });
  });
  it('a set name on accounts.google.com and on www.google.com both count', () => {
    expect(accountCookiesIn([c('SID', '.accounts.google.com'), c('HSID', 'www.google.com')])).toEqual({
      found: true,
      names: ['HSID', 'SID'],
    });
  });
  it('a host-only cookie of any name on accounts.google.com is found', () => {
    expect(accountCookiesIn([c('ANYTHING', 'accounts.google.com')])).toEqual({
      found: true,
      names: ['ANYTHING'],
    });
  });
  it('NID and SOCS on .google.com are not account cookies', () => {
    expect(accountCookiesIn([c('NID', '.google.com'), c('SOCS', '.google.com')])).toEqual({
      found: false,
      names: [],
    });
  });
  it('a set name on another domain is not found', () => {
    expect(accountCookiesIn([c('SID', '.example.test'), c('SID', 'notgoogle.com')])).toEqual({
      found: false,
      names: [],
    });
  });
  it('google.com itself counts', () => {
    expect(accountCookiesIn([c('SID', 'google.com')]).found).toBe(true);
  });
  it('reads every domain with no URL argument, stamps the clock and never returns a value', async () => {
    const ctx = new FakeContext();
    ctx.jar = [c('SID', '.google.com', 'secret-sid-value'), c('NID', '.google.com')];
    const r = await checkAccountCookies(ctx, fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z')));
    expect(ctx.cookieCalls).toEqual([undefined]);
    expect(r).toEqual({ found: true, names: ['SID'], checkedAt: '2026-10-18T05:00:00.000Z' });
    expect(JSON.stringify(r)).not.toContain('secret-sid-value');
  });
});
