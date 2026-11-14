import { asIata, asIsoDate } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTripState, tripHref, tripPatch, tripQueryOf } from '../../src/state/tripState.js';
import { hrefWith } from '../../src/state/urlState.js';

// Design 2026-11-08 §6.1 (plan Task 6): the Trip page's URL (`def`, `depart`, `return`, `d.from`, `d.to`,
// `d.journey`) and the trip read's query built from it. Synthetic codes only.

const DEF = { origins: [asIata('LHR'), asIata('LGW')], destinations: [asIata('JFK'), asIata('EWR')] };
const parse = (q: string) => parseTripState(new URLSearchParams(q), DEF);
const DATES = { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-24') };

afterEach(() => window.history.replaceState(null, '', '/'));

describe('parseTripState', () => {
  it('reads the dates and the search page filters', () => {
    expect(
      parse('view=trip&def=d1&depart=2027-03-14&return=2027-03-24&d.from=LGW&d.to=JFK,EWR&d.journey=1500'),
    ).toEqual({
      ...DATES,
      from: ['LGW'],
      to: ['JFK', 'EWR'],
      journey: 1500,
    });
  });
  it('with no filters, none are set', () => {
    expect(parse('depart=2027-03-14&return=2027-03-24')).toEqual({
      ...DATES,
      from: [],
      to: [],
      journey: null,
    });
  });
  it("drops an airport outside the search and a journey limit outside the route's bounds, as the board does", () => {
    expect(parse('depart=2027-03-14&return=2027-03-24&d.from=XXX,LHR&d.journey=5')).toEqual({
      ...DATES,
      from: ['LHR'],
      to: [],
      journey: null,
    });
  });
  it.each([
    ['no dates', 'def=d1'],
    ['a departure alone', 'depart=2027-03-14'],
    ['a return before the departure', 'depart=2027-03-24&return=2027-03-14'],
    ['a malformed date', 'depart=2027-3-14&return=2027-03-24'],
  ])('%s is no trip', (_label, q) => {
    expect(parse(q)).toBeNull();
  });
  it("ignores the board's own parameters (stay, sort, week, coverage)", () => {
    expect(
      parse(
        'depart=2027-03-14&return=2027-03-24&d.nights=10-12&d.sort=journey.asc&d.week=best&d.coverage=open',
      ),
    ).toEqual({
      ...DATES,
      from: [],
      to: [],
      journey: null,
    });
  });
});

describe("tripQueryOf: the web's names mapped to the api's scope names", () => {
  it('sends the dates alone when no filter is set (no key with an undefined value)', () => {
    const q = tripQueryOf({ ...DATES, from: [], to: [], journey: null });
    expect(q).toEqual({ departureDate: '2027-03-14', returnDate: '2027-03-24' });
    expect(Object.keys(q)).toEqual(['departureDate', 'returnDate']);
  });
  it('maps d.from, d.to and d.journey to origins, destinations and maxJourneyMinutes, sorted', () => {
    expect(
      tripQueryOf({ ...DATES, from: [asIata('LHR'), asIata('LGW')], to: [asIata('JFK')], journey: 1500 }),
    ).toEqual({
      departureDate: '2027-03-14',
      returnDate: '2027-03-24',
      origins: 'LGW,LHR',
      destinations: 'JFK',
      maxJourneyMinutes: '1500',
    });
  });
});

describe("tripPatch and tripHref (one builder: Ruling 9's parameters)", () => {
  it('the patch opens the trip, drops basis and row, and leaves every other parameter alone', () => {
    expect(tripPatch(DATES)).toEqual({
      view: 'trip',
      depart: '2027-03-14',
      return: '2027-03-24',
      basis: null,
      row: null,
    });
    window.history.replaceState(
      null,
      '',
      '/?view=dates&def=def-1&d.to=JFK&d.nights=10-14&row=old&basis=verified#top',
    );
    const url = new URL(hrefWith(tripPatch(DATES)), 'http://localhost');
    expect(url.hash).toBe('#top');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'trip',
      def: 'def-1',
      'd.to': 'JFK',
      'd.nights': '10-14',
      depart: '2027-03-14',
      return: '2027-03-24',
    });
  });
  it('tripHref builds the address from scratch, carrying only the filters given', () => {
    expect(tripHref('def-1', '2027-03-14', '2027-03-24', {})).toBe(
      '?view=trip&def=def-1&depart=2027-03-14&return=2027-03-24',
    );
    expect(
      tripHref('def-1', '2027-03-14', '2027-03-24', { from: 'LGW', to: 'JFK,EWR', journey: '1500' }),
    ).toBe(
      '?view=trip&def=def-1&depart=2027-03-14&return=2027-03-24&d.from=LGW&d.to=JFK%2CEWR&d.journey=1500',
    );
  });
  it('an address from tripHref parses back to the same trip', () => {
    const href = tripHref('def-1', '2027-03-14', '2027-03-24', { from: 'LGW', journey: '900' });
    expect(parseTripState(new URL(href, 'http://localhost').searchParams, DEF)).toEqual({
      ...DATES,
      from: ['LGW'],
      to: [],
      journey: 900,
    });
  });
});
