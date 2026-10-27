import { asIata, asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { readList, tabPriceMinor } from '../src/list.js';

const REQ = {
  mode: 'list' as const,
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  gl: 'GB',
  departureDate: asIsoDate('2026-11-05'),
  returnDate: asIsoDate('2026-11-15'),
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const name = (pounds: number, o: { on?: string; from?: string; to?: string } = {}) =>
  `From ${pounds} British pounds round trip total. 1 stop flight with Example Air. Leaves ${o.from ?? 'Heathrow Airport'} at 12:25 on ${o.on ?? 'Thursday, November 5'} and arrives at ${o.to ?? 'John F. Kennedy International Airport'} at 20:05 on ${o.on ?? 'Thursday, November 5'}. Total duration 12 hrs 40 min. Select flight`;
const facts = (
  names: Array<string | null>,
  o: Partial<{ tab: string; stated: number | null; currency: string | null; location: string | null }> = {},
) => ({
  names,
  cheapestTabName: o.tab ?? 'Cheapest from 451 British pounds',
  resultsStated: o.stated === undefined ? names.length : o.stated,
  currencyName: o.currency === undefined ? 'Currency GBP' : o.currency,
  locationName: o.location === undefined ? 'Location·United Kingdom' : o.location,
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('readList (spec §2 list mode)', () => {
  it('the minimum over every link for this cell, with the tab price, currency and point of sale', () => {
    expect(readList(facts([name(478), name(534), name(451)]), REQ)).toMatchObject({
      minMinor: 45100,
      tabMinor: 45100,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsSeen: 3,
      currency: 'GBP',
      pointOfSale: 'GB',
    });
  });
  it.each([
    ['a reworded name', 'Reworded by Google'],
    ['a nameless link', ''],
    ['a name over the limit', null],
  ])('%s counts as unparsed, never vanishes', (_n, bad) => {
    const r = readList(facts([name(478), bad]), REQ);
    expect(r).toMatchObject({ minMinor: 47800, optionsUnparsed: 1, resultsSeen: 2 });
  });
  it('another day or another airport counts as another cell', () => {
    expect(
      readList(
        facts([
          name(300, { on: 'Friday, November 6' }),
          name(310, { to: 'Newark Liberty International Airport' }),
          name(451),
        ]),
        REQ,
      ),
    ).toMatchObject({ minMinor: 45100, optionsOtherCell: 2 });
  });
  it('another month on the same day, and another origin, are other cells', () => {
    expect(
      readList(
        facts([name(300, { on: 'Saturday, December 5' }), name(310, { from: 'Gatwick Airport' })]),
        REQ,
      ),
    ).toMatchObject({
      minMinor: null,
      optionsOtherCell: 2,
    });
  });
  it('no option for this cell: minMinor null', () => {
    expect(readList(facts([name(300, { on: 'Friday, November 6' })]), REQ).minMinor).toBeNull();
  });
  it.each([
    ['United States', 'US'],
    ['Elsewhere', 'unknown'],
  ])('location %s → %s, stored as stated', (place, pos) => {
    expect(readList(facts([name(451)], { location: `Location·${place}` }), REQ).pointOfSale).toBe(pos);
  });
  it('no location control: unknown point of sale', () => {
    expect(readList(facts([name(451)], { location: null }), REQ).pointOfSale).toBe('unknown');
  });
  it('no currency control: currency null; an unreadable one too', () => {
    expect(readList(facts([name(451)], { currency: null }), REQ).currency).toBeNull();
    expect(readList(facts([name(451)], { currency: 'Pounds' }), REQ).currency).toBeNull();
  });
  it('sorts numerically', () => {
    expect(readList(facts([name(1000), name(999)]), REQ).minMinor).toBe(99900);
  });
  it('every link is priced, another cell’s or unparsed (PIE-R2-10)', () => {
    const r = readList(facts([name(451), null, '', 'x', name(300, { on: 'Friday, November 6' })]), REQ);
    expect(r.optionsUnparsed + r.optionsOtherCell + r.parsedForThisCell).toBe(r.resultsSeen);
  });
  it('the tab price reads both spellings and is null when the name states none', () => {
    expect(tabPriceMinor('Cheapest from £1,204')).toBe(120400);
    expect(tabPriceMinor('Cheapest from 1,204 British pounds')).toBe(120400);
    expect(tabPriceMinor('Cheapest')).toBeNull();
    // why: every recording since 2026-10-18: the tab's name carries its information pop-up's text after the price, with
    // or without the hidden "Fetching results" label before it; the price is the tab's first, and the only one
    const popup =
      'Close dialogueLooking for the lowest fares? These additional budget picks help you save. Learn more';
    expect(tabPriceMinor(`Cheapestfrom Fetching results £451${popup}`)).toBe(45100);
    expect(tabPriceMinor(`Cheapestfrom  £1,204${popup}`)).toBe(120400);
    expect(tabPriceMinor(`Cheapestfrom Fetching results ${popup}`)).toBeNull();
    expect(readList(facts([name(451)], { tab: 'Cheapest' }), REQ).tabMinor).toBeNull();
  });
});
