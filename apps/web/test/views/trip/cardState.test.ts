import { asIata, asIsoDate, asIsoDateTime, PAIRING_READ, type PairingRead } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { TripResponse } from '../../../src/api/types.js';
import { type Card, type CardState, cardOf } from '../../../src/views/Trip/cardState.js';
import { datePairFigure } from '../../fixtures.js';
import {
  failedList,
  flightList,
  listedFlight,
  listedReturn,
  returnAttempt,
  returnRead,
} from '../../fixtures.searches.js';

// Design 2026-11-08 §6.1 (plan Task 6): the card's state, decided once from the trip read. Synthetic values only.

type Figure = NonNullable<TripResponse['figure']>;
type Cell = TripResponse['cells'][number];

const FIGURE_PRICE = datePairFigure().price;

/** A calendar figure of LHR → JFK (the contract allows no local times on one). */
function calendarFigure(over: Partial<Figure> = {}): Figure {
  return {
    ...datePairFigure(),
    basis: 'calendar',
    departOut: null,
    arriveOut: null,
    departBack: null,
    arriveBack: null,
    ...over,
  };
}

const cell = (bucket: Cell['bucket'], skipReason: Cell['skipReason'] = null, origin = 'LHR'): Cell => ({
  origin: asIata(origin),
  destination: asIata('JFK'),
  bucket,
  skipReason,
});

/** A trip read in the window with no figure, no list and one unsearched cell; `over` says the rest. */
function trip(over: Partial<TripResponse> = {}): TripResponse {
  return {
    departureDate: asIsoDate('2027-03-14'),
    returnDate: asIsoDate('2027-03-24'),
    nights: 10,
    inWindow: true,
    figure: null,
    journeyLeftOut: 0,
    listFailure: null,
    cells: [cell('not_run')],
    flightList: null,
    bookingUrl: null,
    searchLink: null,
    booking: null,
    calendar: null,
    cached: null,
    log: [],
    reading: false,
    read: {
      available: true,
      unavailableReason: null,
      wouldGo: true,
      pagesPlanned: 1,
      origin: asIata('LHR'),
      destination: asIata('JFK'),
    },
    verificationConfigured: true,
    refreshHours: 168,
    limits: { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null },
    ...over,
  };
}

const stateOf = (r: TripResponse, failed = false): CardState => cardOf(r, failed).state;
const FAILURE: TripResponse['listFailure'] = {
  at: asIsoDateTime('2026-10-14T16:42:00.000Z'),
  cause: 'network',
};

describe('a calendar figure follows its flight read (design §6.1)', () => {
  const EXPECTED: Record<PairingRead, CardState['kind']> = {
    // why: `within` is a pairing figure's own read; a calendar figure never has it (the contract refuses it)
    within: 'trip',
    'within-older': 'calendar-with-trip',
    'sellers-not-read': 'calendar-with-trip',
    'offers-incomplete': 'calendar-with-trip',
    'over-limit': 'none-within',
    'within-other-limits': 'other-limits',
    'outbound-only': 'outbound-only',
    'no-pairing-read': 'no-return',
    'list-failed': 'calendar-only',
    'not-read': 'calendar-only',
  };
  it.each(PAIRING_READ)('%s', (read) => {
    const r = trip({ figure: calendarFigure({ pairingRead: read }) });
    expect(stateOf(r).kind).toBe(EXPECTED[read]);
  });

  it('a superseded calendar figure with no usable read is gone, never a price', () => {
    for (const read of ['not-read', 'list-failed'] as const)
      expect(stateOf(trip({ figure: calendarFigure({ pairingRead: read, superseded: true }) })).kind).toBe(
        'gone',
      );
  });
});

describe('precedence, first match wins', () => {
  it('a failed read beats everything, and names no failure of a list', () => {
    const r = trip({ inWindow: false, reading: true, listFailure: FAILURE });
    expect(cardOf(r, true)).toEqual({ state: { kind: 'unreachable' }, couldNotRead: null });
  });
  it('outside the window beats a read in flight', () => {
    expect(stateOf(trip({ inWindow: false, reading: true }))).toEqual({ kind: 'outside-window' });
  });
  it('a read in flight beats a figure that is over the limits', () => {
    const r = trip({ reading: true, figure: calendarFigure({ pairingRead: 'over-limit' }) });
    expect(stateOf(r)).toEqual({ kind: 'reading' });
  });
  it('a verified figure is verified, whatever its flight read says (a stale one with a read within-older too)', () => {
    const fresh = trip({ figure: datePairFigure({ pairingRead: 'not-read' }) });
    expect(stateOf(fresh)).toEqual({ kind: 'verified' });
    const stale = trip({
      figure: {
        ...datePairFigure(),
        price: { ...FIGURE_PRICE, stale: 'refresh' },
        pairingRead: 'within-older',
      },
    });
    expect(stateOf(stale)).toEqual({ kind: 'verified' });
  });
  it('a verified figure not seen in the latest search is gone', () => {
    const r = trip({ figure: { ...datePairFigure(), notSeenInLatest: { ageHours: 30 } } });
    expect(stateOf(r)).toEqual({ kind: 'gone' });
  });
  it('a leading pairing is a trip', () => {
    expect(
      stateOf(trip({ figure: { ...datePairFigure(), basis: 'pairing', pairingRead: 'within' } })),
    ).toEqual({
      kind: 'trip',
    });
  });
  it("a failed newest list never lets an older trip lead: the calendar price shows, with the couldn't-read line (the board's rule)", () => {
    const r = trip({
      figure: calendarFigure({ pairingRead: 'list-failed', listReason: 'network' }),
      listFailure: FAILURE,
    });
    expect(cardOf(r, false)).toEqual({ state: { kind: 'calendar-only' }, couldNotRead: FAILURE });
  });
  it('the failure is carried beside any state', () => {
    const r = trip({ listFailure: FAILURE, flightList: failedList('network') });
    const card: Card = cardOf(r, false);
    expect(card.couldNotRead).toEqual(FAILURE);
  });
});

describe('over-limit names the limits that rule out every flight read', () => {
  const over = (flightListOver: Parameters<typeof flightList>[0], limits?: Partial<TripResponse['limits']>) =>
    trip({
      figure: calendarFigure({ pairingRead: 'over-limit' }),
      flightList: flightList(flightListOver),
      limits: { ...trip().limits, ...limits },
    });

  it('the journey limit, when every outbound is longer', () => {
    const r = over({
      flights: [listedFlight({ durationMinutes: 1600 }), listedFlight({ durationMinutes: 1700 })],
    });
    expect(stateOf(r)).toEqual({ kind: 'none-within', failing: ['journey'] });
  });
  it('a limit one flight meets is not named', () => {
    const r = over({
      flights: [listedFlight({ durationMinutes: 1600 }), listedFlight({ durationMinutes: 600 })],
    });
    expect(stateOf(r)).toEqual({ kind: 'none-within', failing: [] });
  });
  it('the stops and the outbound windows, in the order journey, stops, departure, arrival', () => {
    const r = over(
      { flights: [listedFlight({ stops: 2, departsLocal: '05:00', arrivesLocal: '23:00' })] },
      {
        departureWindowLocal: { from: '08:00', to: '12:00' },
        arrivalWindowLocal: { from: '08:00', to: '12:00' },
      },
    );
    expect(stateOf(r)).toEqual({ kind: 'none-within', failing: ['stops', 'departure', 'arrival'] });
  });
  it('the return leg is judged on journey and stops only (no windows on a return)', () => {
    const r = over(
      {
        flights: [listedFlight()],
        returns: returnRead({
          attempts: [returnAttempt({ returns: [listedReturn({ durationMinutes: 1800, stops: 3 })] })],
        }),
      },
      { departureWindowLocal: { from: '08:00', to: '12:00' } },
    );
    expect(stateOf(r)).toEqual({ kind: 'none-within', failing: ['journey', 'stops', 'departure'] });
  });
  it('with no list in hand it names none', () => {
    expect(stateOf(trip({ figure: calendarFigure({ pairingRead: 'over-limit' }) }))).toEqual({
      kind: 'none-within',
      failing: [],
    });
  });
});

describe('no figure: the list, the journey limit, then the cells in order', () => {
  it('a list read by hand is read-without-calendar', () => {
    expect(stateOf(trip({ flightList: flightList() }))).toEqual({ kind: 'read-without-calendar' });
  });
  it('dates left out by the journey limit', () => {
    expect(stateOf(trip({ journeyLeftOut: 2, cells: [cell('error')] }))).toEqual({
      kind: 'over-journey-limit',
    });
  });
  it.each<[string, Cell[], CardState['kind']]>([
    ['an error', [cell('priced'), cell('error')], 'could-not-read'],
    [
      'an error beats an empty cell (could not read is never no price)',
      [cell('empty'), cell('error')],
      'could-not-read',
    ],
    ['an empty cell', [cell('no_data'), cell('empty')], 'no-price'],
    ['no data', [cell('skipped', 'budget'), cell('no_data')], 'not-offered'],
    ['a budget skip', [cell('skipped', 'provider_unavailable'), cell('skipped', 'budget')], 'not-reached'],
    [
      'a skip for the browser being unavailable',
      [cell('skipped', 'provider_unavailable')],
      'browser-unavailable',
    ],
    ['a skip for a scheduled-only provider', [cell('skipped', 'scheduled_only')], 'browser-unavailable'],
    ['any other skip', [cell('skipped', 'not_selected'), cell('not_run')], 'not-searched'],
    ['nothing run', [cell('not_run')], 'not-searched'],
    ['no cells at all', [], 'not-searched'],
  ])('%s', (_label, cells, kind) => {
    expect(stateOf(trip({ cells })).kind).toBe(kind);
  });
  it("an error's card still carries the failure of the newest list beside it", () => {
    const r = trip({ cells: [cell('error')], listFailure: FAILURE });
    expect(cardOf(r, false)).toEqual({ state: { kind: 'could-not-read' }, couldNotRead: FAILURE });
  });
});

describe('every state of the card is reachable', () => {
  const FIXTURES: Record<CardState['kind'], TripResponse> = {
    unreachable: trip(),
    'outside-window': trip({ inWindow: false }),
    verified: trip({ figure: datePairFigure() }),
    trip: trip({ figure: { ...datePairFigure(), basis: 'pairing', pairingRead: 'within' } }),
    reading: trip({ reading: true }),
    'calendar-with-trip': trip({ figure: calendarFigure({ pairingRead: 'within-older' }) }),
    'none-within': trip({ figure: calendarFigure({ pairingRead: 'over-limit' }) }),
    'other-limits': trip({ figure: calendarFigure({ pairingRead: 'within-other-limits' }) }),
    'outbound-only': trip({ figure: calendarFigure({ pairingRead: 'outbound-only' }) }),
    'no-return': trip({ figure: calendarFigure({ pairingRead: 'no-pairing-read' }) }),
    'read-without-calendar': trip({ flightList: flightList() }),
    'calendar-only': trip({ figure: calendarFigure({ pairingRead: 'not-read' }) }),
    gone: trip({ figure: { ...datePairFigure(), notSeenInLatest: { ageHours: 3 } } }),
    'over-journey-limit': trip({ journeyLeftOut: 1 }),
    'could-not-read': trip({ cells: [cell('error')] }),
    'no-price': trip({ cells: [cell('empty')] }),
    'not-offered': trip({ cells: [cell('no_data')] }),
    'not-reached': trip({ cells: [cell('skipped', 'budget')] }),
    'browser-unavailable': trip({ cells: [cell('skipped', 'provider_unavailable')] }),
    'not-searched': trip(),
  };
  it.each(Object.entries(FIXTURES))('%s', (kind, r) => {
    expect(stateOf(r, kind === 'unreachable').kind).toBe(kind);
  });
});
