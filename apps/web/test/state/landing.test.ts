import { asIata, asIsoDate, detailLinkQuery, type Iata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type Landing, land } from '../../src/state/landing.js';
import { NAV_TIERS, navPatch, parseView, VIEWS, type ViewId } from '../../src/state/view.js';

// Spec rev 55 §11 URLs (WP20 Task 20.3): `?view=` names the view; an absent or unknown value, a search's page without
// `def=` and the Edit page without `edit=` land on Searches; the retired values and a Results URL without a date pair
// land on a search's page (WP19 Task 19.7). `land` judges the format only, with no clock: whether a date pair is inside the current resolved space is
// the server's answer (the detail's 422 `date_pair_outside_space`, tested with the App).

const DEF = { destinations: [asIata('JFK'), asIata('EWR')] };
const at = (q: string, def: { destinations: readonly Iata[] } | null = DEF): Landing =>
  land(new URLSearchParams(q), def);
const view = (v: ViewId, patch: Record<string, string | null> = {}): Landing => ({
  kind: 'view',
  view: v,
  patch,
});

/** The detail's own parameters, removed when a Results URL lands on Dates (spec §11 "Back to dates"). */
const DETAIL_GONE = { view: 'dates', depart: null, return: null, basis: null, row: null };

const TO_SEARCHES = view('searches', { view: 'searches' });

describe("?view= URLs land on Searches, a search's page or the view named (spec §11 URLs)", () => {
  it.each<[string, string, Landing]>([
    ['nothing at all', '', TO_SEARCHES],
    ['absent', 'def=def-1', TO_SEARCHES],
    ['empty', 'view=&def=def-1', TO_SEARCHES],
    ['unknown', 'view=nope&def=def-1', TO_SEARCHES],
    ['searches itself', 'view=searches', view('searches')],
    ["dates with def= (a search's page)", 'view=dates&def=def-1&d.to=JFK', view('dates')],
    ['dates without def=, whatever the number of searches', 'view=dates&d.to=JFK', TO_SEARCHES],
    ['calendar, keeping def=', 'view=calendar&def=def-1', view('dates', { view: 'dates' })],
    ['duration, keeping def=', 'view=duration&def=def-1', view('dates', { view: 'dates' })],
    [
      'coverage, with the coverage section open',
      'view=coverage&def=def-1',
      view('dates', { view: 'dates', 'd.coverage': 'open' }),
    ],
    ['history', 'view=history&def=def-1', view('history')],
    ['definitions with edit= (the Edit page)', 'view=definitions&edit=d1', view('definitions')],
    ['definitions without edit=', 'view=definitions', TO_SEARCHES],
    ['definitions with an empty edit=', 'view=definitions&edit=', TO_SEARCHES],
    ['dates with an empty def=', 'view=dates&def=', TO_SEARCHES],
    ['coverage with an empty def=', 'view=coverage&def=', TO_SEARCHES],
    ['coverage with no def=', 'view=coverage', TO_SEARCHES],
    ['calendar with no def=', 'view=calendar&cal.dest=JFK', TO_SEARCHES],
    ['results with no date pair and no def=', 'view=results', TO_SEARCHES],
    ['providers', 'view=providers', view('providers')],
    ['alerts', 'view=alerts&def=def-1', view('alerts')],
    ['status', 'view=status', view('status')],
  ])('%s', (_label, q, expected) => {
    expect(at(q)).toEqual(expected);
  });

  it('calendar with cal.dest=JFK keeps the destination as the Dates filter and removes every other cal.*', () => {
    expect(at('view=calendar&def=def-1&cal.dest=JFK&cal.basis=calendar&cal.month=2027-03&foo=1')).toEqual(
      view('dates', {
        view: 'dates',
        'cal.dest': null,
        'cal.basis': null,
        'cal.month': null,
        'd.to': 'JFK',
      }),
    );
  });

  it("a cal.dest outside the definition's destinations is dropped, as is one with no definition to check it against", () => {
    const dropped = view('dates', { view: 'dates', 'cal.dest': null });
    expect(at('view=calendar&def=def-1&cal.dest=LAX')).toEqual(dropped);
    expect(at('view=calendar&def=def-1&cal.dest=jfk')).toEqual(dropped);
    expect(at('view=calendar&def=def-1&cal.dest=JFK', null)).toEqual(dropped);
  });

  it('a duration URL keeps no cal.* either, and an unknown parameter is left alone, never an error', () => {
    expect(at('view=duration&def=def-1&cal.dest=EWR&x.y=z')).toEqual(
      view('dates', { view: 'dates', 'cal.dest': null, 'd.to': 'EWR' }),
    );
  });
});

describe('an old Results link lands on the Trip page, or on the search (Ruling 9; spec §11 URLs, §8.3)', () => {
  const TRIP_PATCH = { view: 'trip', basis: null, row: null };

  it('dates with a basis, a row and a journey limit: the trip, keeping def, the dates and d.journey, dropping basis and row', () => {
    const link = new URLSearchParams(
      'view=results&def=D&depart=2026-12-05&return=2026-12-23&basis=verified&row=x&d.journey=1500',
    );
    const landing = land(link, DEF);
    expect(landing).toEqual(view('trip', TRIP_PATCH));
    // why: applied as the app applies it (null removes), the URL keeps exactly the trip's own parameters
    for (const [k, v] of Object.entries(landing.patch)) {
      if (v === null) link.delete(k);
      else link.set(k, v);
    }
    expect(Object.fromEntries(link)).toEqual({
      view: 'trip',
      def: 'D',
      depart: '2026-12-05',
      return: '2026-12-23',
      'd.journey': '1500',
    });
  });

  it('the Results sort and every f.* are dropped; the airport filters and the stay filter are not named, so kept', () => {
    expect(
      at(
        'view=results&def=D&depart=2026-12-05&return=2026-12-23&sort=price.asc&f.class=verified&f.stops=1&d.from=LGW&d.to=JFK&d.nights=10-12',
      ),
    ).toEqual(view('trip', { ...TRIP_PATCH, sort: null, 'f.class': null, 'f.stops': null }));
  });

  it('dates with no row= are the same trip', () => {
    expect(at('view=results&def=def-1&depart=2027-03-14&return=2027-03-14')).toEqual(
      view('trip', TRIP_PATCH),
    );
  });

  it('a link with only row= (sent before revision 48) lands on the search page', () => {
    expect(at('view=results&def=D&row=x')).toEqual(view('dates', DETAIL_GONE));
    expect(at('view=results&def=D&basis=verified&row=hash-1')).toEqual(view('dates', DETAIL_GONE));
  });

  it('a Results link with no def= lands on Searches, with or without dates', () => {
    expect(at('view=results&depart=2027-03-14&return=2027-03-28&row=abc')).toEqual(TO_SEARCHES);
    expect(at('view=results&row=x')).toEqual(TO_SEARCHES);
  });

  it.each<[string, string]>([
    ['no date pair', 'view=results&def=def-1'],
    ['a departure alone', 'view=results&def=def-1&depart=2027-03-14'],
    ['a return alone', 'view=results&def=def-1&return=2027-03-28'],
    ['a return before the departure', 'view=results&def=def-1&depart=2027-03-28&return=2027-03-14'],
    ['a malformed date', 'view=results&def=def-1&depart=2027-3-14&return=2027-03-28'],
    ['a date that does not exist', 'view=results&def=def-1&depart=2027-02-30&return=2027-03-28'],
    ['a date with a time', 'view=results&def=def-1&depart=2027-03-14T00:00&return=2027-03-28'],
  ])('%s lands on the search page, the detail parameters removed', (_label, q) => {
    expect(at(q)).toEqual(view('dates', DETAIL_GONE));
  });

  it('an empty or oversized row= is no row, so a link with only that lands on the search page', () => {
    expect(at('view=results&def=def-1&row=')).toEqual(view('dates', DETAIL_GONE));
    expect(at(`view=results&def=def-1&row=${'x'.repeat(201)}`)).toEqual(view('dates', DETAIL_GONE));
  });
});

describe('a Trip URL (design 2026-11-08 §6.1)', () => {
  it('with def and well-formed dates is the trip as it stands', () => {
    expect(at('view=trip&def=def-1&depart=2027-03-14&return=2027-03-28&d.journey=900')).toEqual(view('trip'));
  });
  it('without def lands on Searches', () => {
    expect(at('view=trip&depart=2027-03-14&return=2027-03-28')).toEqual(TO_SEARCHES);
  });
  it('without usable dates lands on the search page', () => {
    expect(at('view=trip&def=def-1')).toEqual(view('dates', DETAIL_GONE));
    expect(at('view=trip&def=def-1&depart=2027-03-28&return=2027-03-14')).toEqual(view('dates', DETAIL_GONE));
  });
});

describe('the email link (spec §8.3; Task 19.1’s detailLink literal, so the engine and the web cannot drift)', () => {
  // why: the literal of core's test/datePairs/detailLink.test.ts; the web never imports core's test files (WP19 §7)
  const LITERAL = 'view=trip&def=def-1&depart=2027-03-14&return=2027-03-28';
  const query = detailLinkQuery({
    definitionId: 'def-1',
    departureDate: asIsoDate('2027-03-14'),
    returnDate: asIsoDate('2027-03-28'),
  });

  it("core's detailLinkQuery still writes the literal the engine's link test pins", () => {
    expect(query).toBe(LITERAL);
  });

  it.each([`/?${query}`, `https://flights.example.test/?${query}`, `https://example.test/gmt/?${query}`])(
    '%s lands on the Trip page',
    (link) => {
      const params = new URL(link, 'https://example.test').searchParams;
      expect(land(params, DEF)).toEqual(view('trip'));
    },
  );
});

describe('the view list and the two-tier nav (spec §11 layout)', () => {
  it('eight views (Results retired; its links land on the Trip page); anything unknown or absent is Searches', () => {
    expect(VIEWS).toEqual([
      'searches',
      'dates',
      'trip',
      'history',
      'definitions',
      'providers',
      'alerts',
      'status',
    ]);
    expect(parseView(null)).toBe('searches');
    expect(parseView('calendar')).toBe('searches');
    expect(parseView('history')).toBe('history');
    expect(parseView('results')).toBe('searches');
  });

  it('Decide holds Searches, the search last opened and History, Set up Providers, Alerts and Status; the Trip page and Edit are in neither', () => {
    expect(NAV_TIERS).toEqual([
      { id: 'decide', views: ['searches', 'dates', 'history'] },
      { id: 'setup', views: ['providers', 'alerts', 'status'] },
    ]);
  });

  it("a nav link names its view and drops the detail's date pair and row, keeping every filter", () => {
    expect(navPatch('history')).toEqual({ view: 'history', depart: null, return: null, row: null });
  });
});
