import { describe, expect, it } from 'vitest';
import { LINK_ALLOWLIST, MAX_URL_LENGTH, validateVendorUrl } from '../../src/normalise/vendorUrl.js';

describe('validateVendorUrl (spec §5.2 "Vendor links")', () => {
  it.each([
    ['https://www.google.com/travel/flights/booking?tfs=abc', 'www.google.com'],
    ['https://google.com/x', 'google.com'],
    ['https://WWW.GOOGLE.COM/x', 'www.google.com'],
  ])('accepts %s for SearchApi', (url, host) => {
    expect(validateVendorUrl(url, LINK_ALLOWLIST.searchapi)).toEqual({
      kind: 'get',
      url: new URL(url).href,
      host,
    });
  });

  it('accepts a subdomain of aviasales.com for Travelpayouts', () => {
    expect(
      validateVendorUrl(
        'https://search.aviasales.com/flights/?origin_iata=LHR',
        LINK_ALLOWLIST.travelpayouts,
      ),
    ).toMatchObject({ kind: 'get', host: 'search.aviasales.com' });
  });

  it.each([
    'http://www.google.com/travel', // not https
    'https://user:pw@www.google.com/x', // userinfo
    'https://user@www.google.com/x', // username only
    'https://:pw@www.google.com/x', // password only
    'https://google.com.evil.example/x', // allowlist entry as a prefix
    'https://evilgoogle.com/x', // suffix without the dot
    'https://www.aviasales.com/x', // another provider's host
    'https://www.british-airways.example/x', // a seller host is never linked
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'https://www.google.com:8443/x', // explicit non-default port: refused by decision
    'https://www.google.com./x', // trailing-dot host
    'https://xn--ggle-0nda.com/x', // punycode look-alike
    'https://evil.example\\@www.google.com/x', // backslash read as a path separator: host is evil.example
    'not a url',
    '',
  ])('rejects %j → none', (url) => {
    expect(validateVendorUrl(url, LINK_ALLOWLIST.searchapi)).toEqual({ kind: 'none' });
  });

  // why: fix round 1 (prov M3): camoufox links reach google.com and its subdomains only
  it('camoufox: www.google.com is kept; any other host is none', () => {
    expect(validateVendorUrl('https://www.google.com/travel/flights', LINK_ALLOWLIST.camoufox).kind).toBe(
      'get',
    );
    for (const u of [
      'https://www.searchapi.io/x',
      'https://www.aviasales.com/x',
      'https://google.com.evil.test/x',
    ])
      expect(validateVendorUrl(u, LINK_ALLOWLIST.camoufox), u).toEqual({ kind: 'none' });
    expect(LINK_ALLOWLIST.camoufox).toEqual(['google.com']);
  });
  it('the fixture provider has an empty allowlist, so nothing it supplies is linked', () => {
    expect(validateVendorUrl('https://www.google.com/x', LINK_ALLOWLIST.fixture)).toEqual({ kind: 'none' });
  });
});

describe('validateVendorUrl length cap and default port (review sec-001)', () => {
  it('keeps a URL of exactly MAX_URL_LENGTH and refuses one character more', () => {
    const base = 'https://www.google.com/';
    const at = base + 'a'.repeat(MAX_URL_LENGTH - base.length);
    expect(validateVendorUrl(at, LINK_ALLOWLIST.searchapi).kind).toBe('get');
    expect(validateVendorUrl(`${at}a`, LINK_ALLOWLIST.searchapi)).toEqual({ kind: 'none' });
  });
  it('an explicit :443 is the default port and is kept', () => {
    expect(validateVendorUrl('https://www.google.com:443/x', LINK_ALLOWLIST.searchapi)).toEqual({
      kind: 'get',
      url: 'https://www.google.com/x',
      host: 'www.google.com',
    });
  });
});
