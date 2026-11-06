import { asIsoDateTime, flightLimitsOf } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { FlightList } from '../../../../src/api/types.js';
import { COPY } from '../../../../src/copy.js';
import {
  datesShort,
  headLine,
  hoursText,
  legMarks,
  limitsOf,
  readButtonWords,
} from '../../../../src/views/Dates/flightLines.js';
import { londonDaysAgo } from '../../../../src/views/Dates/stateLines.js';
import { definition } from '../../../fixtures.js';
import { flightList, listedFlight, listedReturn } from '../../../fixtures.searches.js';
import { NOW } from '../../../render.js';

// Spec rev 55 §11 Flights (WP20 Task 20.10 fix round): the block's pure lines. NOW is 2026-10-14T15:00Z, 16:00 London.

const F = COPY.flights;
const read = (fetchedAt: string, ageHours: number): FlightList => flightList({ fetchedAt, ageHours });

describe('headLine (finding 7: the London day decides, never the words)', () => {
  it('today: the age alone', () => {
    expect(headLine(read('2026-10-14T10:44:00.000Z', 4), NOW, COPY)).toBe(F.head('4h ago', null));
  });
  it('yesterday: the age and "yesterday 11:44"', () => {
    expect(headLine(read('2026-10-13T10:44:00.000Z', 28), NOW, COPY)).toBe(
      F.head('28h ago', 'yesterday 11:44'),
    );
  });
  it('older: the age and its date and time', () => {
    expect(headLine(read('2026-10-10T10:44:00.000Z', 100), NOW, COPY)).toBe(F.head('4d ago', '10 Oct 11:44'));
  });
  it('the day is London’s: 23:30 London yesterday is yesterday though under a day old', () => {
    expect(londonDaysAgo(asIsoDateTime('2026-10-13T22:30:00.000Z'), NOW)).toBe(1);
    expect(londonDaysAgo(asIsoDateTime('2026-10-13T23:30:00.000Z'), NOW)).toBe(0);
    expect(headLine(read('2026-10-13T22:30:00.000Z', 16), NOW, COPY)).toBe(
      F.head('16h ago', 'yesterday 23:30'),
    );
  });
});

describe('the limit words', () => {
  const limits = {
    maxJourneyMinutes: 1500,
    maxStops: null,
    arrivalWindowLocal: null,
    departureWindowLocal: null,
  };
  it('whole hours read "25h", else hours and minutes', () => {
    expect(hoursText(1500)).toBe('25h');
    expect(hoursText(1600)).toBe('26h 40m');
  });
  it('within, over, and nothing when no limit is set', () => {
    expect(legMarks('outbound', listedFlight(), limits, F)).toEqual([
      'outbound 10h 50m, within your 25h limit; return not read',
    ]);
    expect(legMarks('outbound', listedFlight({ durationMinutes: 1560 }), limits, F)).toEqual([
      'outbound 26h: over your 25h limit',
    ]);
    expect(
      legMarks(
        'outbound',
        listedFlight(),
        { maxJourneyMinutes: null, maxStops: null, arrivalWindowLocal: null, departureWindowLocal: null },
        F,
      ),
    ).toEqual([]);
  });
  it('both window marks on one flight', () => {
    const w = {
      maxJourneyMinutes: null,
      maxStops: null,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      departureWindowLocal: { from: '08:00', to: '20:00' },
    };
    expect(
      legMarks('outbound', listedFlight({ departsLocal: '06:10', arrivesLocal: '03:10' }), w, F),
    ).toEqual(['arrives 03:10, outside your window', 'departs 06:10, outside your window']);
  });
});

describe('datesShort', () => {
  it('one month once; across a month end both', () => {
    expect(datesShort('2027-03-14', '2027-03-24', F)).toBe('14 → 24 Mar');
    expect(datesShort('2027-03-28', '2027-04-07', F)).toBe('28 Mar → 7 Apr');
  });
});

describe('legMarks: both legs against the limits (spec rev 56 §6.2, §11)', () => {
  const limits = {
    maxJourneyMinutes: 1500,
    maxStops: 1,
    arrivalWindowLocal: { from: '06:00', to: '23:00' },
    departureWindowLocal: { from: '08:00', to: '20:00' },
  };
  it('a return: over the journey limit, over the stops limit, within; never a window mark, never "; return not read"', () => {
    expect(legMarks('return', listedReturn({ durationMinutes: 1560 }), limits, F)).toEqual([
      'return 26h: over your 25h limit',
    ]);
    expect(legMarks('return', listedReturn({ stops: 2 }), limits, F)).toEqual([
      'return 2 changes: over your 1-change limit',
    ]);
    // 14:20 → 06:25 is outside both outbound windows: no window mark on a return
    expect(
      legMarks('return', listedReturn({ departsLocal: '05:00', arrivesLocal: '03:00' }), limits, F),
    ).toEqual(['return 12h 05m, within your 25h limit']);
    expect(legMarks('return', listedReturn(), limits, F, false)).toEqual([
      'return 12h 05m, within your 25h limit',
    ]);
  });
  it('an outbound: WP20\'s marks plus the stops mark; "; return not read" only when no return was read', () => {
    const f = listedFlight({ departsLocal: '09:00' });
    expect(legMarks('outbound', f, limits, F)).toEqual([
      'outbound 10h 50m, within your 25h limit; return not read',
    ]);
    expect(legMarks('outbound', f, limits, F, true)).toEqual(['outbound 10h 50m, within your 25h limit']);
    expect(legMarks('outbound', listedFlight({ departsLocal: '09:00', stops: 2 }), limits, F, true)).toEqual([
      'outbound 2 changes: over your 1-change limit',
    ]);
    expect(
      legMarks('outbound', listedFlight({ departsLocal: '06:10', stops: 1 }), { ...limits, maxStops: 0 }, F),
    ).toEqual(['outbound 1 change: over your direct-only limit', 'departs 06:10, outside your window']);
  });
  it('no limit set: no mark on either leg', () => {
    const none = {
      maxJourneyMinutes: null,
      maxStops: null,
      arrivalWindowLocal: null,
      departureWindowLocal: null,
    };
    expect(legMarks('return', listedReturn({ stops: 3 }), none, F)).toEqual([]);
    expect(legMarks('outbound', listedFlight(), none, F, true)).toEqual([]);
  });
});

describe("limitsOf (spec rev 56 §6.2: flightLimitsOf of the search's constraints)", () => {
  it('equals the literal flightLimitsOf result, stops included, for a search with every constraint set', () => {
    const d = definition({
      constraints: {
        maxJourneyMinutes: 1500,
        maxStops: 1,
        departureWindowLocal: { from: '06:00', to: '22:00' },
        arrivalWindowLocal: { from: '07:00', to: '23:00' },
      },
    });
    expect(limitsOf(d)).toEqual({
      maxJourneyMinutes: 1500,
      maxStops: 1,
      departureWindowLocal: { from: '06:00', to: '22:00' },
      arrivalWindowLocal: { from: '07:00', to: '23:00' },
    });
    expect(limitsOf(d)).toEqual(flightLimitsOf(d.constraints));
    expect(limitsOf(definition({ constraints: {} }))).toEqual({
      maxJourneyMinutes: null,
      maxStops: null,
      departureWindowLocal: null,
      arrivalWindowLocal: null,
    });
  });
});

describe('readButtonWords (ruling D3, prov-008: the pages from the response, never a refusal)', () => {
  it('the planned pages as the response states them', () => {
    expect(readButtonWords(2, F)).toBe('Read flights for this date (free, up to 2 pages)');
    expect(readButtonWords(1, F)).toBe('Read flights for this date (free, 1 page)');
  });
});
