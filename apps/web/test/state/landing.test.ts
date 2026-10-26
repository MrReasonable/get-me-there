import { asIata, asIsoDate, detailLinkQuery, type Iata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type Landing, land } from '../../src/state/landing.js';
import { parseSelectedRow } from '../../src/state/resultsState.js';
import { NAV_TIERS, navPatch, parseView, VIEWS, type ViewId } from '../../src/state/view.js';

// Spec §11 URLs (WP19 Task 19.7): `?view=` names the view; the retired values and a Results URL without a date pair land
// on Dates. `land` judges the format only, with no clock: whether a date pair is inside the current resolved space is
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

describe('old ?view= URLs land on Dates (spec §11 URLs)', () => {
  it.each<[string, string, Landing]>([
    ['absent', 'def=def-1', view('dates', { view: 'dates' })],
    ['empty', 'view=&def=def-1', view('dates', { view: 'dates' })],
    ['unknown', 'view=nope&def=def-1', view('dates', { view: 'dates' })],
    ['dates itself', 'view=dates&def=def-1&d.to=JFK', view('dates')],
    ['calendar, keeping def=', 'view=calendar&def=def-1', view('dates', { view: 'dates' })],
    ['duration, keeping def=', 'view=duration&def=def-1', view('dates', { view: 'dates' })],
    [
      'coverage, with the coverage section open',
      'view=coverage&def=def-1',
      view('dates', { view: 'dates', 'd.coverage': 'open' }),
    ],
    ['history', 'view=history&def=def-1', view('history')],
    ['definitions', 'view=definitions', view('definitions')],
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
    expect(at('view=calendar&cal.dest=LAX')).toEqual(dropped);
    expect(at('view=calendar&cal.dest=jfk')).toEqual(dropped);
    expect(at('view=calendar&cal.dest=JFK', null)).toEqual(dropped);
  });

  it('a duration URL keeps no cal.* either, and an unknown parameter is left alone, never an error', () => {
    expect(at('view=duration&cal.dest=EWR&x.y=z')).toEqual(
      view('dates', { view: 'dates', 'cal.dest': null, 'd.to': 'EWR' }),
    );
  });
});

describe('a Results URL lands on the detail, a row lookup or Dates (spec §11 URLs, §8.3)', () => {
  it.each<[string, string]>([
    ['two well-formed dates', 'view=results&def=def-1&depart=2027-03-14&return=2027-03-28'],
    ['a return on the departure date', 'view=results&depart=2027-03-14&return=2027-03-14'],
    ['a date pair with a row', 'view=results&depart=2027-03-14&return=2027-03-28&row=abc'],
  ])('%s opens the detail as it stands', (_label, q) => {
    expect(at(q)).toEqual(view('results'));
  });

  it.each<[string, string]>([
    ['no date pair', 'view=results&def=def-1'],
    ['a departure alone', 'view=results&def=def-1&depart=2027-03-14'],
    ['a return alone', 'view=results&def=def-1&return=2027-03-28'],
    ['a return before the departure', 'view=results&def=def-1&depart=2027-03-28&return=2027-03-14'],
    ['a malformed date', 'view=results&def=def-1&depart=2027-3-14&return=2027-03-28'],
    ['a date that does not exist', 'view=results&def=def-1&depart=2027-02-30&return=2027-03-28'],
    ['a date with a time', 'view=results&def=def-1&depart=2027-03-14T00:00&return=2027-03-28'],
  ])('%s and no row= lands on Dates, the detail parameters removed', (_label, q) => {
    expect(at(q)).toEqual(view('dates', DETAIL_GONE));
  });

  it('without a well-formed date pair but with row= it is a row lookup on the link’s basis', () => {
    expect(at('view=results&def=def-1&basis=verified&row=hash-1')).toEqual({
      kind: 'row-lookup',
      row: 'hash-1',
      basis: 'verified',
    });
    expect(at('view=results&depart=nope&return=2027-03-28&basis=calendar&row=calendar%3A7')).toEqual({
      kind: 'row-lookup',
      row: 'calendar:7',
      basis: 'calendar',
    });
    expect(at('view=results&row=hash-1&basis=other')).toEqual({
      kind: 'row-lookup',
      row: 'hash-1',
      basis: null,
    });
  });

  it('an empty or oversized row= is no row, so that URL lands on Dates', () => {
    expect(at('view=results&row=')).toEqual(view('dates', DETAIL_GONE));
    expect(at(`view=results&row=${'x'.repeat(201)}`)).toEqual(view('dates', DETAIL_GONE));
  });
});

describe('the email link (spec §8.3; Task 19.1’s detailLink literal, so the engine and the web cannot drift)', () => {
  // why: the hash of core's test/datePairs/detailLink.test.ts; the web never imports core's test files (WP19 §7)
  const HASH = '9f3c2a7b41d0e6f85a1c3b2d4e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9';
  const LITERAL = `view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=${HASH}`;
  const query = detailLinkQuery({
    definitionId: 'def-1',
    departureDate: asIsoDate('2027-03-14'),
    returnDate: asIsoDate('2027-03-28'),
    basis: 'verified',
    row: HASH,
  });

  it("core's detailLinkQuery still writes the literal the engine's link test pins", () => {
    expect(query).toBe(LITERAL);
  });

  it.each([`/?${query}`, `https://flights.example.test/?${query}`, `https://example.test/gmt/?${query}`])(
    '%s lands on the detail with row= kept',
    (link) => {
      const params = new URL(link, 'https://example.test').searchParams;
      expect(land(params, DEF)).toEqual(view('results'));
      expect(parseSelectedRow(params)).toBe(HASH);
    },
  );
});

describe('the view list and the two-tier nav (spec §11 layout)', () => {
  it('seven views; anything unknown or absent is Dates', () => {
    expect(VIEWS).toEqual(['dates', 'results', 'history', 'definitions', 'providers', 'alerts', 'status']);
    expect(parseView(null)).toBe('dates');
    expect(parseView('calendar')).toBe('dates');
    expect(parseView('history')).toBe('history');
  });

  it('Decide holds Dates and History, Set up the rest; Results is in neither', () => {
    expect(NAV_TIERS).toEqual([
      { id: 'decide', views: ['dates', 'history'] },
      { id: 'setup', views: ['definitions', 'providers', 'alerts', 'status'] },
    ]);
  });

  it("a nav link names its view and drops the detail's date pair and row, keeping every filter", () => {
    expect(navPatch('history')).toEqual({ view: 'history', depart: null, return: null, row: null });
  });
});
