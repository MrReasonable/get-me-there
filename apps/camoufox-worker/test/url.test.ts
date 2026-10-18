import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { pageUrl, probeUrl } from '../src/url.js';

describe('pageUrl (spec §2: the feasibility form, never tfs)', () => {
  it('builds the q form with exactly q, curr, hl and gl', () => {
    const u = new URL(
      pageUrl({
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate('2026-11-05'),
        returnDate: asIsoDate('2026-11-15'),
        gl: 'GB',
      }),
    );
    expect(`${u.origin}${u.pathname}`).toBe('https://www.google.com/travel/flights');
    expect([...u.searchParams.keys()]).toEqual(['q', 'curr', 'hl', 'gl']);
    expect(u.searchParams.get('q')).toBe('Flights from LHR to JFK on 2026-11-05 returning 2026-11-15');
    expect(u.searchParams.get('curr')).toBe('GBP');
    expect(u.searchParams.get('hl')).toBe('en-GB');
    expect(u.searchParams.get('gl')).toBe('GB');
    expect(u.searchParams.has('tfs')).toBe(false);
  });
  it('the probe page names no airport', () => {
    expect(probeUrl('GB')).toBe('https://www.google.com/travel/flights?curr=GBP&hl=en-GB&gl=GB');
  });
});

// why: fix round 1 (arch M13): gl is the request's own, whatever it is
describe('pageUrl gl', () => {
  it('passes another point of sale through unchanged', () => {
    const u = new URL(
      pageUrl({
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate('2026-11-05'),
        returnDate: asIsoDate('2026-11-15'),
        gl: 'US',
      }),
    );
    expect(u.searchParams.get('gl')).toBe('US');
    expect(probeUrl('US')).toBe('https://www.google.com/travel/flights?curr=GBP&hl=en-GB&gl=US');
  });
});
