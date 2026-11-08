import type { ConfirmSummary } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { ExecutionResponse } from '../../src/api/types.js';
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

type Flights = NonNullable<ExecutionResponse['flights']>;
const plan = (over: Partial<Flights> = {}): Flights => ({
  planned: 10,
  read: 3,
  reused: 2,
  failed: 0,
  ended: null,
  confirm: null,
  stopCause: null,
  ...over,
});
// Design 2026-11-08 §5.5: in confirm mode the step reads an open-ended queue, so the dates checked so far are `planned`
// (the pairs whose read started plus those reused) and the step is going until it ends or stops of its own accord
const confirming = (over: Partial<Flights> = {}, stop: ConfirmSummary['stop'] = null): Flights =>
  plan({
    planned: 9,
    read: 4,
    reused: 1,
    confirm: { mode: 'confirm', confirmed: 3, unread: 0, uncheckedCheaper: 0, stop },
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

  it('in confirm mode: the dates checked so far, whatever the lists in hand, until the step ends or stops', () => {
    // read + reused + failed is below planned here and equal there: neither decides it
    expect(readingCount(confirming())).toBe(9);
    expect(readingCount(confirming({ read: 9, reused: 0 }))).toBe(9);
    expect(readingCount(confirming({ read: 2, reused: 0, failed: 0 }))).toBe(9);
  });

  it.each([
    ['patience', confirming({}, 'patience')],
    ['queue-empty', confirming({}, 'queue-empty')],
    ['returns-stopped', confirming({}, 'returns-stopped')],
    ['an early end', confirming({ ended: 'window' })],
  ])('in confirm mode, none once the step has %s', (_name, f) => {
    expect(readingCount(f)).toBeNull();
  });

  it('an outbound-only plan keeps the fixed-cells rule', () => {
    const f = plan({
      confirm: { mode: 'outbound-only', confirmed: 0, unread: 0, uncheckedCheaper: 0, stop: null },
    });
    expect(readingCount(f)).toBe(5);
    expect(readingCount({ ...f, read: 8 })).toBeNull();
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
  it('in confirm mode: dates checked and trips read, with no denominator, on both', () => {
    expect(card(confirming())).toEqual({
      kind: 'flights',
      words: 'Reading flights · 9 dates checked, 3 trips with flights read',
    });
    expect(page(confirming())).toEqual({
      kind: 'reading',
      text: 'Checking flights: 9 dates so far; 3 trips with flights read.',
    });
  });
  it('in confirm mode a step that has stopped of its own accord reads as searching on both', () => {
    expect(card(confirming({}, 'patience')).kind).toBe('searching');
    expect(page(confirming({}, 'patience')).kind).toBe('searching');
  });
  it('a step that ended reads as searching on both', () => {
    for (const ended of ['window', 'monthly-cap'] as const) {
      expect(card(plan({ ended })).kind, ended).toBe('searching');
      expect(page(plan({ ended })).kind, ended).toBe('searching');
    }
  });
});
