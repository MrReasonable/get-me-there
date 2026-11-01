// Spec revision 55 §2 (prov-int-017; ruling C1): the worker's one verified URL form, moved into core so the browser
// worker loads it and the camoufox search link reproduces it. The literals are the worker's own output before the move
// (apps/camoufox-worker/src/url.ts at 22f2e14d), never this function compared with itself.
import { beforeEach, describe, expect, it } from 'vitest';
import { pageUrl, RESULTS_BASE } from '../../src/camoufox/url.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('pageUrl (spec rev 55 §2: the q form, returning, hl=en-GB, gl the point of sale)', () => {
  it('is byte-equal to the worker’s former output for the worked cell', () => {
    expect(
      pageUrl({
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate('2026-11-05'),
        returnDate: asIsoDate('2026-11-15'),
        gl: 'GB',
      }),
    ).toBe(
      'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB',
    );
  });
  it('passes the second worked example and another gl through unchanged', () => {
    expect(
      pageUrl({
        origin: asIata('BHX'),
        destination: asIata('FRA'),
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        gl: 'US',
      }),
    ).toBe(
      'https://www.google.com/travel/flights?q=Flights+from+BHX+to+FRA+on+2027-03-14+returning+2027-03-28&curr=GBP&hl=en-GB&gl=US',
    );
  });
  it('names the one results page', () => {
    expect(RESULTS_BASE).toBe('https://www.google.com/travel/flights');
  });
});
