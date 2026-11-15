import { asIata, asIsoDate } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { BACK_TO_DATES, TRIP_PAIR_PARAMS } from '../../src/state/resultsState.js';
import {
  parseTripState,
  searchPageTripHref,
  tripHref,
  tripPatch,
  tripQueryOf,
} from '../../src/state/tripState.js';
import { hrefWith } from '../../src/state/urlState.js';
import { navPatch } from '../../src/state/view.js';

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
    // why: final review I1: a link navigates, so the page's fragment stays behind
    expect(url.hash).toBe('');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'trip',
      def: 'def-1',
      'd.to': 'JFK',
      'd.nights': '10-14',
      depart: '2027-03-14',
      return: '2027-03-24',
    });
  });
  // final review M3: a multi-airport trip's own pair is the trip's (`t.from`/`t.to`), never the page's airport filter
  it('tripHref builds the address from scratch, naming the trip’s own airport pair when given', () => {
    expect(tripHref('def-1', '2027-03-14', '2027-03-24', {})).toBe(
      '?view=trip&def=def-1&depart=2027-03-14&return=2027-03-24',
    );
    expect(tripHref('def-1', '2027-03-14', '2027-03-24', { from: 'LGW', to: 'JFK' })).toBe(
      '?view=trip&def=def-1&depart=2027-03-14&return=2027-03-24&t.from=LGW&t.to=JFK',
    );
  });
  // Task 9 fix round 1 (ruling): a trip linked from a search's page carries the page's filters, so the Trip page's crumb
  // back returns to the same filtered view; final review M3: the page's own airport filter (or none) is kept as it was
  it('searchPageTripHref carries every d.* of the page as it was, and the trip’s own pair beside them', () => {
    const page = new URLSearchParams(
      'view=dates&def=def-1&d.nights=10-11&d.week=best&d.journey=1500&d.from=LGW&d.coverage=open&row=old',
    );
    const href = searchPageTripHref('def-1', '2027-03-14', '2027-03-24', {}, page);
    expect(Object.fromEntries(new URLSearchParams(href))).toEqual({
      view: 'trip',
      def: 'def-1',
      depart: '2027-03-14',
      return: '2027-03-24',
      'd.nights': '10-11',
      'd.week': 'best',
      'd.journey': '1500',
      'd.from': 'LGW',
      'd.coverage': 'open',
    });
    // a multi-airport trip's own pair sits beside the page's airport filter, which is left as it was
    const own = new URLSearchParams(
      searchPageTripHref('def-1', '2027-03-14', '2027-03-24', { from: 'LGW', to: 'JFK' }, page),
    );
    expect([own.get('t.from'), own.get('t.to')]).toEqual(['LGW', 'JFK']);
    expect([own.get('d.from'), own.get('d.to')]).toEqual(['LGW', null]);
    expect(own.get('d.nights')).toBe('10-11');
    // a page without filters gives tripHref's own address
    expect(
      searchPageTripHref('def-1', '2027-03-14', '2027-03-24', {}, new URLSearchParams('view=dates')),
    ).toBe(tripHref('def-1', '2027-03-14', '2027-03-24', {}));
  });
  it('the trip’s own pair scopes the Trip page over the page’s filter; the way back and the nav drop it', () => {
    expect(
      parse(
        'view=trip&def=d1&depart=2027-03-14&return=2027-03-24&d.from=LGW&d.journey=900&t.from=LGW&t.to=EWR',
      ),
    ).toEqual({ ...DATES, from: ['LGW'], to: ['EWR'], journey: 900 });
    // an airport outside the search is dropped, as the page's filter's is
    expect(parse('depart=2027-03-14&return=2027-03-24&t.from=QQA&t.to=JFK')).toEqual({
      ...DATES,
      from: [],
      to: ['JFK'],
      journey: null,
    });
    expect(TRIP_PAIR_PARAMS).toEqual({ from: 't.from', to: 't.to' });
    for (const patch of [BACK_TO_DATES, navPatch('searches')])
      expect([patch['t.from'], patch['t.to']]).toEqual([null, null]);
  });
  it('an address from tripHref parses back to the same trip', () => {
    const href = tripHref('def-1', '2027-03-14', '2027-03-24', { from: 'LGW', to: 'JFK' });
    expect(parseTripState(new URL(href, 'http://localhost').searchParams, DEF)).toEqual({
      ...DATES,
      from: ['LGW'],
      to: ['JFK'],
      journey: null,
    });
  });
});
