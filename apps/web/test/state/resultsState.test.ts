import type { ResultFilters } from '@gmt/core';
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_CLASSES,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  type ResultsUiState,
  resultsStatePatch,
} from '../../src/state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams } from '../../src/state/urlState.js';
import { parseView } from '../../src/state/view.js';
import { withKey } from '../../src/state/withKey.js';

const full: ResultsUiState = {
  sort: { key: 'totalTime', dir: 'desc' },
  filters: {
    verdictClass: ['verified', 'partially-verified'],
    providerId: ['searchapi'],
    maxStops: 1,
    carriers: ['ZZ', 'YY'],
    destination: [asIata('JFK')],
    maxPricePence: 50000,
    nights: { min: 10, max: 14 },
    hideStale: true,
    unverified: ['checkedBagRequired', 'cabin'],
    departure: { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') },
  },
};

function toParams(patch: Record<string, string | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) if (v !== null) p.set(k, v);
  return p;
}

describe('results UI state in the URL (spec §11: filter and sort persist across views)', () => {
  it('round-trips every filter, the departure-date range included, and the sort', () => {
    expect(parseResultsState(toParams(resultsStatePatch(full)))).toEqual(full);
    expect(resultsStatePatch(full)['f.depart']).toBe('2027-03-01..2027-03-31');
  });

  it('no sort param means the server ranking (class then price, spec §6.5); no class param means the spec §6.9 default', () => {
    expect(parseResultsState(new URLSearchParams()).sort).toBeNull();
    expect(resultsStatePatch({ sort: null, filters: {} }).sort).toBeNull();
    expect(DEFAULT_CLASSES).toEqual(['verified', 'partially-verified', 'unchecked']);
  });

  it('ignores malformed values instead of guessing', () => {
    const s = parseResultsState(
      new URLSearchParams(
        'sort=bogus.up&f.class=verified,nope&f.stops=-1&f.nights=14-10x&f.provider=amadeus&f.dest=jfk,JFKX&f.depart=2027-03-31..2027-03-01&f.unverified=x',
      ),
    );
    expect(s).toEqual({ sort: null, filters: { verdictClass: ['verified'] } });
    expect(
      parseResultsState(
        new URLSearchParams('sort=price.sideways&f.nights=14-10&f.depart=2027-02-30..2027-03-01'),
      ).filters,
    ).toEqual({});
  });

  it('withKey adds and removes keys without leaving undefined behind', () => {
    const none: ResultFilters = {};
    const a = withKey(none, 'maxStops', 0);
    expect(a).toEqual({ maxStops: 0 });
    expect(Object.keys(withKey(a, 'maxStops', undefined))).toEqual([]);
    expect(withKey({ a: 1, b: 2 }, 'b', undefined)).toEqual({ a: 1 });
    expect(activeFilterCount(full.filters)).toBe(10);
  });

  it('parses basis and view strictly', () => {
    expect(parseBasis('calendar')).toBe('calendar');
    expect(parseBasis('verified')).toBe('verified');
    expect(parseBasis('live')).toBeNull();
    expect(parseView('coverage')).toBe('coverage');
    expect(parseView(null)).toBe('results');
    expect(parseView('nope')).toBe('results');
  });

  it('row= selects a results row by resultRowKey (email links)', () => {
    expect(parseSelectedRow(new URLSearchParams('row=hash-verified-1'))).toBe('hash-verified-1');
    expect(parseSelectedRow(new URLSearchParams('row=calendar%3A7'))).toBe('calendar:7');
    expect(parseSelectedRow(new URLSearchParams('row='))).toBeNull();
    expect(parseSelectedRow(new URLSearchParams(''))).toBeNull();
    expect(parseSelectedRow(new URLSearchParams(`row=${'x'.repeat(300)}`))).toBeNull();
  });

  it('nav hrefs keep filters and sort when the view changes', () => {
    window.history.replaceState(null, '', '/?view=results&def=d1&sort=price.asc&f.stops=1');
    expect(hrefWith({ view: 'coverage' })).toBe('/?view=coverage&def=d1&sort=price.asc&f.stops=1');
    expect(hrefWith({ sort: null })).toBe('/?view=results&def=d1&f.stops=1');
    updateSearchParams({ view: 'coverage' }, 'push');
    expect(window.location.search).toBe('?view=coverage&def=d1&sort=price.asc&f.stops=1');
    updateSearchParams({ view: 'results' });
    expect(parseResultsState(new URLSearchParams(window.location.search)).filters).toEqual({ maxStops: 1 });
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
});
