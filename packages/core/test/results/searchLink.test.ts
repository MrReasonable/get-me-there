// Spec revision 55 §2 and §6.9 (prov-int-017; ruling C1): a camoufox row's search link is the page the browser worker
// read, in its verified URL form (`camoufox/url.ts`'s pageUrl), with `gl` the point of sale ('unknown' → GB, the
// worker's own default market); the other providers' links are unchanged (test/results/filterBandLink.test.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { pageUrl } from '../../src/camoufox/url.js';
import { LINK_ALLOWLIST, validateVendorUrl } from '../../src/normalise/vendorUrl.js';
import { SEARCH_LINK_LABEL, searchLinkFor } from '../../src/results/searchLink.js';
import { key } from '../helpers/space.js';

const cell = key('LHR', 'JFK', '2027-03-14', '2027-03-24');
const WORKED =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2027-03-14+returning+2027-03-24&curr=GBP&hl=en-GB&gl=GB';

beforeEach(() => {
  expect.hasAssertions();
});

describe('searchLinkFor camoufox (spec rev 55 §2: the worker’s verified URL form)', () => {
  it("builds pageUrl with gl GB when the point of sale is 'unknown', the default", () => {
    const link = searchLinkFor('camoufox', cell, 'economy');
    expect(link).toEqual({ url: WORKED, host: 'www.google.com', label: SEARCH_LINK_LABEL });
    expect(searchLinkFor('camoufox', cell, 'economy', 'unknown')).toEqual(link);
    expect(link?.url).toBe(pageUrl({ ...cell, gl: 'GB' }));
  });
  it('takes gl from a stated point of sale', () => {
    const link = searchLinkFor('camoufox', key('BHX', 'FRA', '2027-03-14', '2027-03-24'), 'economy', 'US');
    expect(link?.url).toBe(
      'https://www.google.com/travel/flights?q=Flights+from+BHX+to+FRA+on+2027-03-14+returning+2027-03-24&curr=GBP&hl=en-GB&gl=US',
    );
    expect(link?.host).toBe('www.google.com');
  });
  it('stays under the camoufox link allowlist', () => {
    const link = searchLinkFor('camoufox', cell, 'economy', 'GB');
    expect(validateVendorUrl(link?.url ?? '', LINK_ALLOWLIST.camoufox)).toEqual({
      kind: 'get',
      url: WORKED,
      host: 'www.google.com',
    });
  });
  it('gives no link for a cabin the worker never reads, nor for a synthetic cell', () => {
    expect(searchLinkFor('camoufox', cell, 'business')).toBeNull();
    expect(searchLinkFor('fixture', cell, 'economy')).toBeNull();
    expect(searchLinkFor('fixture', cell, 'economy', 'GB')).toBeNull();
  });
  it('leaves the other providers’ links unchanged by the point of sale', () => {
    expect(searchLinkFor('searchapi', cell, 'economy', 'US')).toEqual(
      searchLinkFor('searchapi', cell, 'economy'),
    );
    expect(searchLinkFor('travelpayouts', cell, 'economy', 'US')).toEqual(
      searchLinkFor('travelpayouts', cell, 'economy'),
    );
  });
});
