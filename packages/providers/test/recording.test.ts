import { asIata, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as recording from '../src/recording/index.js';

describe('@gmt/providers/recording (plan decision 32: what the record tool shares instead of copying)', () => {
  it('exports exactly the shared money conversion, the page size and the adapter URL builder', () => {
    expect(Object.keys(recording).sort()).toEqual([
      'MAX_PAGES',
      'PAGE_LIMIT',
      'buildRequestUrl',
      'majorToMinor',
    ]);
    expect(recording.majorToMinor(412.55, 'GBP')).toBe(41255);
    expect(recording.PAGE_LIMIT).toBe(1000);
    expect(recording.MAX_PAGES).toBe(3);
  });

  it('builds the same URL the adapter sends', () => {
    const url = recording.buildRequestUrl(
      { origin: asIata('LHR'), destination: asIata('JFK'), month: asIsoMonth('2027-03') },
      2,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: 'LHR',
      destination: 'JFK',
      departure_at: '2027-03',
      one_way: 'false',
      currency: 'gbp',
      limit: '1000',
      page: '2',
    });
    expect(url.origin + url.pathname).toBe('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
  });
});
