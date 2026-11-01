import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { readingCount } from '../../src/lib/flightsReading.js';
import { stateLine as pageLine } from '../../src/views/Dates/stateLines.js';
import { stateLine as cardLine } from '../../src/views/Searches/cardWords.js';
import { execution } from '../fixtures.js';
import { latestRun, searchCard } from '../fixtures.searches.js';
import { NOW as NOW_ISO } from '../render.js';

// Ruling R-reading (WP20 Task 20.6 review): one rule for the card and a search's page: a run is reading flights while
// its flight step has not ended and has lists still to get; "Reading flights · N of M" counts the lists in hand, read
// now or reused from an earlier run.

type Flights = {
  planned: number;
  read: number;
  reused: number;
  failed: number;
  ended: 'window' | 'monthly-cap' | 'stopped' | 'disabled' | null;
};
const plan = (over: Partial<Flights> = {}): Flights => ({
  planned: 10,
  read: 3,
  reused: 2,
  failed: 0,
  ended: null,
  ...over,
});

describe('readingCount', () => {
  it('the lists in hand while the step has lists still to get', () => {
    expect(readingCount(plan())).toBe(5);
    expect(readingCount(plan({ failed: 1 }))).toBe(5);
  });
  it('none once every planned list is in hand or failed, or the step ended', () => {
    expect(readingCount(plan({ read: 8 }))).toBeNull();
    expect(readingCount(plan({ read: 7, failed: 1 }))).toBeNull();
    for (const ended of ['window', 'monthly-cap', 'stopped', 'disabled'] as const)
      expect(readingCount(plan({ ended })), ended).toBeNull();
    expect(readingCount(null)).toBeNull();
  });
});

describe('the card and the page say the same', () => {
  const card = (f: Flights | null) =>
    cardLine(
      searchCard({ latestRun: latestRun({ status: 'running', finishedAt: null, flights: f }) }),
      NOW_ISO,
    );
  const page = (f: Flights | null) =>
    pageLine({
      latest: execution({ status: 'running', stage: 'discovery', flights: f }),
      pairs: [],
      whole: { searched: 0, total: 0 },
      providers: [],
      reused: 0,
      spaceChanged: false,
      noSource: false,
      now: NOW_ISO,
      c: COPY,
    });
  it('read and reused together, on both', () => {
    expect(card(plan())).toEqual({ kind: 'flights', words: 'Reading flights · 5 of 10' });
    expect(page(plan())).toEqual({ kind: 'reading', text: 'Reading flights · 5 of 10 date pairs' });
  });
  it('a step that ended reads as searching on both', () => {
    for (const ended of ['window', 'monthly-cap'] as const) {
      expect(card(plan({ ended })).kind, ended).toBe('searching');
      expect(page(plan({ ended })).kind, ended).toBe('searching');
    }
  });
});
