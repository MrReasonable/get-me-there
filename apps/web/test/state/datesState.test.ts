import { asIata, DETAIL_LINK_PARAMS } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLEARED_FILTERS,
  DATES_PARAMS,
  type DatesUiState,
  DEFAULT_DATES_SORT,
  datesPatch,
  detailHref,
  detailPatch,
  filtersActive,
  parseDatesState,
  scopeQuery,
} from '../../src/state/datesState.js';
import { datePairOf } from '../fixtures.dates.js';

// Spec §11 URLs and Filters: the Dates view's state lives in the URL under d.*, parsed strictly against the
// definition's own airports (decision 53), and the detail link carries the date pair and the figure's basis while
// every d.* parameter travels with it.

const DEF = { origins: [asIata('LHR'), asIata('LGW')], destinations: [asIata('JFK'), asIata('EWR')] };
const parse = (q: string) => parseDatesState(new URLSearchParams(q), DEF);

const full: DatesUiState = {
  nights: { min: 10, max: 14 },
  from: [asIata('LHR'), asIata('LGW')],
  to: [asIata('JFK')],
  journey: 900,
  sort: { key: 'journey', dir: 'asc' },
  bestPerWeek: true,
  coverageOpen: true,
};

function toParams(patch: Record<string, string | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) if (v !== null) p.set(k, v);
  return p;
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('parseDatesState (spec §11 Filters and URLs)', () => {
  it('reads every parameter the view keeps in the URL', () => {
    expect(
      parse(
        'd.nights=10-14&d.from=LHR,LGW&d.to=JFK&d.journey=900&d.sort=journey.asc&d.week=best&d.coverage=open',
      ),
    ).toEqual(full);
  });

  it('a bare URL is the unfiltered board, sorted by price, the week switch off and the coverage section folded', () => {
    expect(parse('')).toEqual({
      nights: null,
      from: [],
      to: [],
      journey: null,
      sort: DEFAULT_DATES_SORT,
      bestPerWeek: false,
      coverageOpen: false,
    });
    expect(DEFAULT_DATES_SORT).toEqual({ key: 'price', dir: 'asc' });
  });

  it('an airport outside the definition is ignored, and an origin is never read as a destination', () => {
    expect(parse('d.from=LHR,CDG&d.to=JFK,LHR').from).toEqual(['LHR']);
    expect(parse('d.from=LHR,CDG&d.to=JFK,LHR').to).toEqual(['JFK']);
  });

  it('a reversed or malformed stay range is ignored', () => {
    expect(parse('d.nights=14-10').nights).toBeNull();
    expect(parse('d.nights=ten').nights).toBeNull();
  });

  it('a journey limit outside 60..6000 minutes, or not a whole number, is ignored', () => {
    expect(parse('d.journey=60').journey).toBe(60);
    expect(parse('d.journey=6000').journey).toBe(6000);
    for (const bad of ['59', '6001', '600.5', 'abc', '-600'])
      expect(parse(`d.journey=${bad}`).journey, bad).toBeNull();
  });

  it('an unknown sort key or direction falls back to the price rank', () => {
    expect(parse('d.sort=carriers.asc').sort).toEqual(DEFAULT_DATES_SORT);
    expect(parse('d.sort=nights.sideways').sort).toEqual(DEFAULT_DATES_SORT);
    expect(parse('d.sort=departure.desc').sort).toEqual({ key: 'departure', dir: 'desc' });
  });

  it('only the exact words switch the week view and open the coverage section', () => {
    expect(parse('d.week=all').bestPerWeek).toBe(false);
    expect(parse('d.coverage=yes').coverageOpen).toBe(false);
  });
});

describe('datesPatch', () => {
  it('round-trips the whole state', () => {
    expect(parseDatesState(toParams(datesPatch(full)), DEF)).toEqual(full);
  });

  it('writes the parameter names from the one constant, and only the keys it is given', () => {
    expect(datesPatch({ nights: { min: 10, max: 14 } })).toEqual({ [DATES_PARAMS.nights]: '10-14' });
    expect(datesPatch({ to: [asIata('JFK')] })).toEqual({ 'd.to': 'JFK' });
    expect(datesPatch({ journey: 600 })).toEqual({ 'd.journey': '600' });
  });

  it('removes a parameter whose value is the default: no range, no airports, no limit, the price sort, switches off', () => {
    expect(
      datesPatch({
        nights: null,
        from: [],
        to: [],
        journey: null,
        sort: DEFAULT_DATES_SORT,
        bestPerWeek: false,
        coverageOpen: false,
      }),
    ).toEqual({
      'd.nights': null,
      'd.from': null,
      'd.to': null,
      'd.journey': null,
      'd.sort': null,
      'd.week': null,
      'd.coverage': null,
    });
    expect(datesPatch({ sort: { key: 'price', dir: 'desc' } })).toEqual({ 'd.sort': 'price.desc' });
  });

  it('"Clear filters" resets the stay range, airports, journey limit and week switch, and keeps the sort and the section', () => {
    expect(CLEARED_FILTERS).toEqual({ nights: null, from: [], to: [], journey: null, bestPerWeek: false });
  });

  it('filtersActive counts a filter the operator set, never the sort or the coverage section', () => {
    expect(filtersActive(parse(''))).toBe(false);
    expect(filtersActive(parse('d.sort=nights.asc&d.coverage=open'))).toBe(false);
    for (const q of ['d.nights=10-12', 'd.from=LHR', 'd.to=EWR', 'd.journey=600', 'd.week=best'])
      expect(filtersActive(parse(q)), q).toBe(true);
  });
});

describe('scopeQuery: what the route is sent (spec §11: airports and the journey limit; the stay range stays in the browser)', () => {
  it('sends origins, destinations and maxJourneyMinutes, sorted so one scope is one query key', () => {
    expect(scopeQuery(full)).toEqual({ origins: 'LGW,LHR', destinations: 'JFK', maxJourneyMinutes: '900' });
  });
  it('sorts each airport list, whatever order the URL gave', () => {
    expect(scopeQuery(parse('d.from=LHR,LGW&d.to=JFK,EWR'))).toMatchObject({
      origins: 'LGW,LHR',
      destinations: 'EWR,JFK',
    });
  });
  it('sends nothing for an unset filter, the stay range or the week switch', () => {
    expect(scopeQuery(parse('d.nights=10-12&d.week=best'))).toEqual({
      origins: undefined,
      destinations: undefined,
      maxJourneyMinutes: undefined,
    });
  });
});

describe('detailHref (spec §11 Board: each row opens the date pair detail, carrying the figure’s basis)', () => {
  it('opens the detail with the date pair and basis, keeping def and every d.* parameter, dropping row', () => {
    window.history.replaceState(null, '', '/?view=dates&def=def-1&d.to=JFK&d.nights=10-14&row=stale-row#top');
    const pair = datePairOf({ departureDate: '2027-03-14', nights: 14, basis: 'calendar' });
    const href = detailHref(pair);
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/');
    expect(url.hash).toBe('#top');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'results',
      def: 'def-1',
      'd.to': 'JFK',
      'd.nights': '10-14',
      depart: '2027-03-14',
      return: '2027-03-28',
      basis: 'calendar',
    });
  });
  it('names its parameters through core’s one constant', () => {
    const pair = datePairOf({ departureDate: '2027-03-14', nights: 10, basis: 'verified' });
    expect(detailPatch(pair)).toEqual({
      [DETAIL_LINK_PARAMS.view]: 'results',
      [DETAIL_LINK_PARAMS.depart]: '2027-03-14',
      [DETAIL_LINK_PARAMS.return]: '2027-03-24',
      [DETAIL_LINK_PARAMS.basis]: 'verified',
      [DETAIL_LINK_PARAMS.row]: null,
    });
  });
  it('a date pair with no figure opens its detail on the default basis (no basis parameter)', () => {
    const pair = datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null });
    expect(detailPatch(pair)[DETAIL_LINK_PARAMS.basis]).toBeNull();
  });
});
