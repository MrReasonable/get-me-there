import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { FlightList } from '../../../../src/api/types.js';
import { COPY } from '../../../../src/copy.js';
import {
  datesShort,
  flightMarks,
  headLine,
  hoursText,
  offersRead,
  pagesLeftClause,
} from '../../../../src/views/Dates/flightLines.js';
import { londonDaysAgo } from '../../../../src/views/Dates/stateLines.js';
import { failedList, flightList, listedFlight } from '../../../fixtures.searches.js';
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

describe('pagesLeftClause (ruling R-pages)', () => {
  it('only when fewer pages are left than one run uses', () => {
    expect(pagesLeftClause(109, 110)).toBe('109');
    expect(pagesLeftClause(1_009, 1_010)).toBe('1,009');
    expect(pagesLeftClause(110, 110)).toBeNull();
    expect(pagesLeftClause(null, 110)).toBeNull();
    expect(pagesLeftClause(5, null)).toBeNull();
  });
});

describe('offersRead (ruling R-failed-read)', () => {
  it('no list, or a failed one not stopped by a monthly or per-run limit', () => {
    expect(offersRead(null)).toBe(true);
    expect(offersRead(failedList('network'))).toBe(true);
    expect(offersRead(failedList('free-call-cap'))).toBe(true);
    expect(offersRead(failedList('monthly-cap'))).toBe(false);
    expect(offersRead(failedList('execution-cap'))).toBe(false);
    expect(offersRead(flightList())).toBe(false);
  });
});

describe('the limit words', () => {
  const limits = { maxJourneyMinutes: 1500, arrivalWindowLocal: null, departureWindowLocal: null };
  it('whole hours read "25h", else hours and minutes', () => {
    expect(hoursText(1500)).toBe('25h');
    expect(hoursText(1600)).toBe('26h 40m');
  });
  it('within, over, and nothing when no limit is set', () => {
    expect(flightMarks(listedFlight(), limits, F)).toEqual([
      'outbound 10h 50m, within your 25h limit; return not read',
    ]);
    expect(flightMarks(listedFlight({ durationMinutes: 1560 }), limits, F)).toEqual([
      'outbound 26h: over your 25h limit',
    ]);
    expect(
      flightMarks(
        listedFlight(),
        { maxJourneyMinutes: null, arrivalWindowLocal: null, departureWindowLocal: null },
        F,
      ),
    ).toEqual([]);
  });
  it('both window marks on one flight', () => {
    const w = {
      maxJourneyMinutes: null,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      departureWindowLocal: { from: '08:00', to: '20:00' },
    };
    expect(flightMarks(listedFlight({ departsLocal: '06:10', arrivesLocal: '03:10' }), w, F)).toEqual([
      'arrives 03:10, outside your window',
      'departs 06:10, outside your window',
    ]);
  });
});

describe('datesShort', () => {
  it('one month once; across a month end both', () => {
    expect(datesShort('2027-03-14', '2027-03-24', F)).toBe('14 → 24 Mar');
    expect(datesShort('2027-03-28', '2027-04-07', F)).toBe('28 Mar → 7 Apr');
  });
});
