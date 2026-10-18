import { describe, expect, it } from 'vitest';
import { LINK_ALLOWLIST, validateVendorUrl } from '../../src/normalise/vendorUrl.js';
import { bandCheapest } from '../../src/results/band.js';
import { filterRows } from '../../src/results/filter.js';
import { resultRowKey } from '../../src/results/rowKey.js';
import { SEARCH_LINK_LABEL, searchLinkFor } from '../../src/results/searchLink.js';
import type { ResultFilters, ResultRow } from '../../src/results/types.js';
import { asIata } from '../../src/types/ids.js';
import { calendarRow, row } from '../helpers/rows.js';
import { key } from '../helpers/space.js';

const v = row({
  itineraryHash: 'v',
  carriers: ['VS'],
  stopsOut: 0,
  stopsIn: 0,
  pricePence: 41_200,
  unverified: [],
});
const p = row({
  itineraryHash: 'p',
  verdictClass: 'partially-verified',
  carriers: ['4U', 'VS'],
  stopsOut: 1,
  stopsIn: 0,
  pricePence: 38_000,
  unverified: ['cabinBagRequired'],
  cell: { destination: 'EWR', nights: 10 },
});
const f = row({
  itineraryHash: 'f',
  verdictClass: 'failed',
  carriers: ['BA'],
  stopsOut: 2,
  stopsIn: 2,
  pricePence: 30_000,
  stale: true,
});
const c = calendarRow({ pricePence: 29_000, cell: { nights: 21 } });
const ALL = [v, p, f, c];
const EVERY_CLASS: ResultFilters['verdictClass'] = ['verified', 'partially-verified', 'failed', 'unchecked'];
const names = (rows: ResultRow[]) => rows.map((r) => r.itineraryHash ?? 'cal');

describe('filterRows (spec §6.5 filters, §6.9 defaults)', () => {
  it.each<[string, ResultFilters, string[]]>([
    ['default: every class except failed', {}, ['v', 'p', 'cal']],
    ['verdict class, failed included by filter', { verdictClass: ['failed'] }, ['f']],
    [
      'unverified-constraint name (any of the listed)',
      { verdictClass: EVERY_CLASS, unverified: ['cabinBagRequired', 'noSelfTransfer'] },
      ['p'],
    ],
    ['provider', { providerId: ['travelpayouts'] }, ['cal']],
    ['stops (calendar rows have no stops and are kept)', { maxStops: 0 }, ['v', 'cal']],
    ['carriers: any carrier on the row matches (calendar rows kept)', { carriers: ['4U'] }, ['p', 'cal']],
    ['destination', { destination: [asIata('EWR')] }, ['p']],
    ['max price', { maxPricePence: 40_000 }, ['p', 'cal']],
    ['max price is inclusive', { maxPricePence: 41_200 }, ['v', 'p', 'cal']],
    ['nights range', { nights: { min: 11, max: 20 } }, ['v']],
    ['nights range is inclusive at both ends', { nights: { min: 14, max: 14 } }, ['v']],
    ['hideStale drops only stale rows', { verdictClass: EVERY_CLASS, hideStale: true }, ['v', 'p', 'cal']],
    ['stale shown by default', { verdictClass: ['failed'], hideStale: false }, ['f']],
    ['filters compose with AND', { maxPricePence: 40_000, destination: [asIata('JFK')] }, ['cal']],
  ])('%s', (_label, filters, expected) => {
    expect(names(filterRows(ALL, filters))).toEqual(expected);
  });

  it('a stops filter judges each direction', () => {
    expect(
      names(filterRows([row({ itineraryHash: 'in2', stopsOut: 0, stopsIn: 2 })], { maxStops: 1 })),
    ).toEqual([]);
  });
});

describe('resultRowKey (plan contract)', () => {
  it('is the itinerary hash, or calendar:<calendarPriceId> for a calendar row', () => {
    expect(resultRowKey(row({ itineraryHash: 'h9' }))).toBe('h9');
    expect(resultRowKey(calendarRow({ calendarPriceId: 42 }))).toBe('calendar:42');
  });
});

describe('bandCheapest (spec §6.5, 6h bands)', () => {
  it('marks the cheapest row per 6h travel-time band; boundaries at whole multiples of 6h', () => {
    const rows = [
      row({ itineraryHash: 'b0', totalMinutes: 359, pricePence: 40_000 }), // 5h59 → band 0
      row({ itineraryHash: 'b1b', totalMinutes: 719, pricePence: 39_000 }), // 11h59 → band 1, dearer and listed first
      row({ itineraryHash: 'b1a', totalMinutes: 360, pricePence: 38_000 }), // 6h00 → band 1, the cheapest
      row({ itineraryHash: 'b2dear', totalMinutes: 750, pricePence: 51_000 }), // band 2, dearer and listed first
      row({ itineraryHash: 'b2', totalMinutes: 720, pricePence: 50_000 }), // 12h00 → band 2
      row({ itineraryHash: 'b2tie', totalMinutes: 800, pricePence: 50_000 }), // tie: first wins
      calendarRow({ pricePence: 1 }), // no travel time: never marked
    ];
    const marked = bandCheapest(rows, 6);
    expect(marked).toBeInstanceOf(Set);
    expect([...marked]).toEqual(['b0', 'b1a', 'b2']);
  });

  it('failed and not-seen-in-latest rows are never the band winner; unchecked rows are eligible (review prov-007, pft-010)', () => {
    const rows = [
      row({ itineraryHash: 'dearer', totalMinutes: 400, pricePence: 45_000 }), // eligible, dearer, listed first
      row({ itineraryHash: 'failed', verdictClass: 'failed', totalMinutes: 400, pricePence: 30_000 }),
      row({
        itineraryHash: 'gone',
        notSeenInLatest: { ageHours: 10 },
        totalMinutes: 400,
        pricePence: 31_000,
      }),
      row({ itineraryHash: 'verified', totalMinutes: 400, pricePence: 40_000 }),
      calendarRow({ calendarPriceId: 9, totalMinutes: 800, pricePence: 20_000 }),
    ];
    expect([...bandCheapest(rows, 6)]).toEqual(['verified', 'calendar:9']);
  });

  it.each([0, -6, 1.5])('rejects band width %s', (h) => {
    expect(() => bandCheapest([v], h)).toThrow(RangeError);
  });
});

describe('searchLinkFor (spec §6.9)', () => {
  const cell = key('LHR', 'JFK', '2027-03-14', '2027-03-28');

  it('Travelpayouts rows link to an Aviasales search with airports, dates, cabin and one adult', () => {
    const link = searchLinkFor('travelpayouts', cell, 'economy');
    const u = new URL(link?.url ?? '');
    expect(u.hostname).toBe('search.aviasales.com');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      origin_iata: 'LHR',
      destination_iata: 'JFK',
      depart_date: '2027-03-14',
      return_date: '2027-03-28',
      adults: '1',
      children: '0',
      infants: '0',
      trip_class: '0',
    });
    expect(
      new URL(searchLinkFor('travelpayouts', cell, 'business')?.url ?? '').searchParams.get('trip_class'),
    ).toBe('1');
  });

  it('premium economy on Aviasales says the cabin was not prefilled (review pft-009)', () => {
    expect(searchLinkFor('travelpayouts', cell, 'premium_economy')?.label).toBe(
      'search link, not a fare link; cabin not prefilled',
    );
  });

  it('SearchApi rows link to a Google Flights search', () => {
    const u = new URL(searchLinkFor('searchapi', cell, 'premium_economy')?.url ?? '');
    expect(u.hostname).toBe('www.google.com');
    expect(u.searchParams.get('q')).toBe(
      'Flights from LHR to JFK on 2027-03-14 through 2027-03-28 premium economy 1 adult',
    );
    expect(u.searchParams.get('curr')).toBe('GBP');
  });

  it('camoufox rows link to the same Google Flights search (spec §5.2 rev 32)', () => {
    expect(searchLinkFor('camoufox', cell, 'economy')).toEqual(searchLinkFor('searchapi', cell, 'economy'));
  });

  it('fixture (synthetic) rows get no link (review sec-003)', () => {
    expect(searchLinkFor('fixture', cell, 'economy')).toBeNull();
  });

  it.each([
    ['economy', '0', 'economy', 'search link, not a fare link'],
    ['premium_economy', '0', 'premium economy', 'search link, not a fare link; cabin not prefilled'],
    ['business', '1', 'business class', 'search link, not a fare link'],
    ['first', '2', 'first class', 'search link, not a fare link'],
  ] as const)(
    '%s: Aviasales trip_class %s, Google "%s", Aviasales label %j',
    (cabin, tripClass, words, label) => {
      const tp = searchLinkFor('travelpayouts', cell, cabin);
      expect(new URL(tp?.url ?? '').searchParams.get('trip_class')).toBe(tripClass);
      expect(tp?.label).toBe(label);
      const sa = searchLinkFor('searchapi', cell, cabin);
      expect(new URL(sa?.url ?? '').searchParams.get('q')).toBe(
        `Flights from LHR to JFK on 2027-03-14 through 2027-03-28 ${words} 1 adult`,
      );
      expect(sa?.label).toBe('search link, not a fare link');
    },
  );

  it('every link carries the label and passes the vendor-link rule for its provider', () => {
    for (const cabin of ['economy', 'premium_economy', 'business', 'first'] as const) {
      for (const id of ['travelpayouts', 'searchapi', 'camoufox'] as const) {
        const link = searchLinkFor(id, cell, cabin);
        expect(link?.label.startsWith(SEARCH_LINK_LABEL)).toBe(true);
        expect(validateVendorUrl(link?.url ?? '', LINK_ALLOWLIST[id])).toEqual({
          kind: 'get',
          url: link?.url,
          host: link?.host,
        });
      }
    }
  });
});
