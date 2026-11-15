import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../../src/copy.js';
import { carriersText, datesShort, hoursText, pairKey } from '../../../../src/lib/flightLines.js';
import { londonDaysAgo } from '../../../../src/views/Dates/stateLines.js';
import { NOW } from '../../../render.js';

// Spec rev 55 §11 Flights: the words a flight read is said in, kept beside their users once the flights block went
// (design 2026-11-08 Ruling 21). NOW is 2026-10-14T15:00Z, 16:00 London.

const F = COPY.flights;

describe('the London day (finding 7: the day decides, never the words)', () => {
  it('23:30 London yesterday is yesterday though under a day old', () => {
    expect(londonDaysAgo(asIsoDateTime('2026-10-13T22:30:00.000Z'), NOW)).toBe(1);
    expect(londonDaysAgo(asIsoDateTime('2026-10-13T23:30:00.000Z'), NOW)).toBe(0);
  });
});

describe('the limit words', () => {
  it('whole hours read "25h", else hours and minutes', () => {
    expect(hoursText(1500)).toBe('25h');
    expect(hoursText(1600)).toBe('26h 40m');
  });
});

describe('datesShort', () => {
  it('one month once; across a month end both', () => {
    expect(datesShort('2027-03-14', '2027-03-24', F)).toBe('14 → 24 Mar');
    expect(datesShort('2027-03-28', '2027-04-07', F)).toBe('28 Mar → 7 Apr');
  });
});

describe('pairKey and carriersText', () => {
  it("the wire's departure_return key", () => {
    expect(pairKey({ departureDate: '2027-03-14', returnDate: '2027-03-24' })).toBe('2027-03-14_2027-03-24');
  });
  it('the carriers, and the operator when the page names one', () => {
    expect(carriersText({ carriers: ['Virgin Atlantic'], operatedBy: null }, F)).toBe('Virgin Atlantic');
    expect(carriersText({ carriers: ['Aer Lingus', 'Virgin Atlantic'], operatedBy: 'QQ Air' }, F)).toBe(
      F.operatedBy('Aer Lingus, Virgin Atlantic', 'QQ Air'),
    );
  });
});
