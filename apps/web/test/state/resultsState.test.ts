import type { ResultFilters } from '@gmt/core';
import { asIsoDate } from '@gmt/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { BACK_TO_DATES, DATES_COVERAGE, parseBasis, parseDetailPair } from '../../src/state/resultsState.js';
import { hrefWith, navigateTo, navigateToQuery, updateSearchParams } from '../../src/state/urlState.js';
import { parseView } from '../../src/state/view.js';
import { type OptionalKeys, withKey } from '../../src/state/withKey.js';

describe('URL state shared by the views (spec §11: parameters persist across views)', () => {
  it('withKey adds and removes keys without leaving undefined behind', () => {
    const none: ResultFilters = {};
    const a = withKey(none, 'maxStops', 0);
    expect(a).toEqual({ maxStops: 0 });
    expect(Object.keys(withKey(a, 'maxStops', undefined))).toEqual([]);
    const both: { a: number; b?: number } = { a: 1, b: 2 };
    expect(withKey(both, 'b', undefined)).toEqual({ a: 1 });
    // why: a required key cannot be deleted. These are compile-time checks (tsconfig.test.json runs tsc over tests):
    // `undefined` is accepted only for the keys OptionalKeys names, so withKey({ id: 'x' }, 'id', undefined) does not compile.
    expectTypeOf<OptionalKeys<{ id: string; note?: string }>>().toEqualTypeOf<'note'>();
    expectTypeOf<OptionalKeys<{ id: string }>>().toEqualTypeOf<never>();
    // a required key typed `string | undefined` is not optional either, so it cannot be removed through undefined
    expectTypeOf<OptionalKeys<{ id: string | undefined; note?: string }>>().toEqualTypeOf<'note'>();
  });

  it('parses basis and view strictly', () => {
    expect(parseBasis('calendar')).toBe('calendar');
    expect(parseBasis('verified')).toBe('verified');
    expect(parseBasis('live')).toBeNull();
    // why: WP20 Task 20.3: Searches is the default view; the retired values are not views (landing.ts sends them on)
    expect(parseView('history')).toBe('history');
    expect(parseView('coverage')).toBe('searches');
    expect(parseView(null)).toBe('searches');
    expect(parseView('nope')).toBe('searches');
  });

  it('nav hrefs keep filters and sort when the view changes', () => {
    window.history.replaceState(null, '', '/?view=results&def=d1&sort=price.asc&f.stops=1');
    expect(hrefWith({ view: 'coverage' })).toBe('/?view=coverage&def=d1&sort=price.asc&f.stops=1');
    expect(hrefWith({ sort: null })).toBe('/?view=results&def=d1&f.stops=1');
    updateSearchParams({ view: 'coverage' }, 'push');
    expect(window.location.search).toBe('?view=coverage&def=d1&sort=price.asc&f.stops=1');
    updateSearchParams({ view: 'results' });
    expect(new URLSearchParams(window.location.search).get('f.stops')).toBe('1');
  });

  it('updating search parameters keeps the URL fragment', () => {
    window.history.replaceState(null, '', '/?view=results&f.stops=1#details');
    expect(hrefWith({ view: 'coverage' })).toBe('/?view=coverage&f.stops=1#details');
    updateSearchParams({ 'f.stops': null });
    expect(window.location.search).toBe('?view=results');
    expect(window.location.hash).toBe('#details');
    window.history.replaceState(null, '', '/');
  });

  it('a nav click navigates in place; a modified click is left to the browser', () => {
    window.history.replaceState(null, '', '/?view=results');
    let prevented = 0;
    const click = (
      over: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }>,
    ) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      button: 0,
      ...over,
      preventDefault: () => {
        prevented += 1;
      },
    });
    const go = navigateTo({ view: 'providers' });
    go(click({ metaKey: true }));
    go(click({ ctrlKey: true }));
    go(click({ shiftKey: true }));
    go(click({ button: 1 }));
    expect([prevented, window.location.search]).toEqual([0, '?view=results']);
    go(click({}));
    expect([prevented, window.location.search]).toEqual([1, '?view=providers']);
  });

  // why: CodeRabbit PR #58 finding 9: a link built from scratch goes to exactly its own address, and a modified click
  // is still the browser's (a new tab), so the page's URL is left alone
  it('a from-scratch link click goes to exactly its address; a modified click is left to the browser', () => {
    window.history.replaceState(null, '', '/?view=dates&d.from=LGW');
    let prevented = 0;
    const click = (
      over: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }>,
    ) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      button: 0,
      ...over,
      preventDefault: () => {
        prevented += 1;
      },
    });
    const go = navigateToQuery('?view=trip&def=d1');
    go(click({ metaKey: true }));
    go(click({ ctrlKey: true }));
    go(click({ shiftKey: true }));
    go(click({ button: 1 }));
    expect([prevented, window.location.search]).toEqual([0, '?view=dates&d.from=LGW']);
    go(click({}));
    expect([prevented, new URLSearchParams(window.location.search).toString()]).toEqual([
      1,
      'view=trip&def=d1',
    ]);
    window.history.replaceState(null, '', '/');
  });
});

describe('an old detail link and the way back to a search (trip-page plan Task 7)', () => {
  it('parses a well-formed pair of dates, return on or after departure, and nothing else', () => {
    expect(parseDetailPair(new URLSearchParams('depart=2027-03-14&return=2027-03-28'))).toEqual({
      departureDate: asIsoDate('2027-03-14'),
      returnDate: asIsoDate('2027-03-28'),
    });
    expect(parseDetailPair(new URLSearchParams('depart=2027-03-14&return=2027-03-14'))).not.toBeNull();
    for (const q of [
      'depart=2027-03-28&return=2027-03-14',
      'depart=2027-02-30&return=2027-03-14',
      'depart=2027-03-14',
      '',
    ])
      expect(parseDetailPair(new URLSearchParams(q)), q).toBeNull();
  });

  it("back to a search's page drops the Trip page's own parameters; the coverage link opens its section", () => {
    expect(BACK_TO_DATES).toEqual({ view: 'dates', depart: null, return: null, basis: null, row: null });
    expect(DATES_COVERAGE).toEqual({ ...BACK_TO_DATES, 'd.coverage': 'open' });
  });
});
