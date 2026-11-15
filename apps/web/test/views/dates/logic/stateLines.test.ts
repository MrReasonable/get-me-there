import { asIsoDateTime, type Buckets, type DatePair, type IsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { ExecutionResponse } from '../../../../src/api/types.js';
import { COPY } from '../../../../src/copy.js';
import {
  pricedCount,
  readAt,
  runLine,
  runProgressFor,
  searchedCount,
  stateLine,
  wholeOf,
} from '../../../../src/views/Dates/stateLines.js';
import { bucketsOf, datePairOf } from '../../../fixtures.dates.js';
import { execution } from '../../../fixtures.js';

// Design 2026-11-08 §5 (mockup 02), Rulings 6, 7 and 11: a search's page's run line, its state and its run's progress,
// and the one form of a flight-read instant, as pure functions of the page's reads. COPY is passed in, so every sentence
// is the catalogue's.

const c = COPY;
/** NOW is 16:00 in London (BST) on 14 Oct 2026; London instants below are written as their UTC equivalents. */
const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const t = (s: string): IsoDateTime => asIsoDateTime(s);

/** `n` date pairs, each with these buckets over four airport pairs. */
function pairs(n: number, b: Partial<Buckets>): DatePair[] {
  const base = datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null });
  return Array.from({ length: n }, (_x, i) => ({ ...base, index: i, buckets: bucketsOf(b) }));
}

/** A finished run today, 16:40–17:02 London (mockup 02). */
const RUN = { startedAt: t('2026-10-14T15:40:00.000Z'), finishedAt: t('2026-10-14T16:02:00.000Z') };

const line = (over: Partial<Parameters<typeof runLine>[0]> = {}) =>
  runLine({ run: RUN, calendar: { priced: 2146, total: 2184 }, readDates: 23, now: NOW, c, ...over });

describe("runLine: mockup 02's run line (Rulings 6 and 7)", () => {
  it('when, the calendar prices over the whole search, and the dates with flights read as a total', () => {
    expect(line()).toBe(
      'Searched today 16:40–17:02 · calendar prices for 2,146 of 2,184 dates · 23 dates with flights read',
    );
  });

  it('the singulars, and none read yet', () => {
    expect(line({ calendar: { priced: 1, total: 1 }, readDates: 1 })).toBe(
      'Searched today 16:40–17:02 · calendar prices for 1 of 1 date · 1 date with flights read',
    );
    expect(line({ readDates: 0 })).toMatch(/ · 0 dates with flights read$/);
  });

  it('yesterday, else the date', () => {
    const yesterday = { startedAt: t('2026-10-13T08:12:00.000Z'), finishedAt: t('2026-10-13T10:41:00.000Z') };
    expect(line({ run: yesterday })).toMatch(/^Searched yesterday 09:12–11:41 · /);
    const older = { startedAt: t('2026-03-12T09:12:00.000Z'), finishedAt: t('2026-03-12T11:41:00.000Z') };
    expect(line({ run: older })).toMatch(/^Searched 12 Mar 09:12–11:41 · /);
  });

  it('just after midnight London time, a run of 23:30 the evening before is yesterday', () => {
    const late = { startedAt: t('2026-10-13T22:10:00.000Z'), finishedAt: t('2026-10-13T22:30:00.000Z') };
    expect(line({ run: late, now: t('2026-10-13T23:05:00.000Z') })).toMatch(
      /^Searched yesterday 23:10–23:30 · /,
    );
  });

  it('a run that ended on a later day names that day; a run with no end names its start only', () => {
    const across = { startedAt: t('2026-10-13T22:10:00.000Z'), finishedAt: t('2026-10-14T00:40:00.000Z') };
    expect(line({ run: across })).toMatch(/^Searched yesterday 23:10–today 01:40 · /);
    expect(line({ run: { startedAt: RUN.startedAt, finishedAt: null } })).toMatch(
      /^Searched today from 16:40 · /,
    );
  });

  it('a run with no recorded start says only its counts', () => {
    expect(line({ run: { startedAt: null, finishedAt: null } })).toBe(
      'calendar prices for 2,146 of 2,184 dates · 23 dates with flights read',
    );
  });

  it('never implies completeness: no "all" and no "every"; never "date pair"', () => {
    expect(line({ calendar: { priced: 4, total: 4 } })).not.toMatch(/\b(all|every)\b|date pair/i);
  });
});

describe("the counts (core's reducedMark and datePairSearched)", () => {
  it('priced: a date pair any of whose airport pairs is priced', () => {
    const ps = [...pairs(3, { priced: 1, empty: 3 }), ...pairs(2, { empty: 4 }), ...pairs(4, {})];
    expect(pricedCount(ps)).toBe(3);
    // searched: priced, or every airport pair answered with no price
    expect(searchedCount(ps)).toBe(5);
    expect(wholeOf(ps)).toEqual({ searched: 5, total: 9 });
  });

  it('one empty and three not searched is neither priced nor searched (§6.6)', () => {
    expect(pricedCount(pairs(2, { empty: 1 }))).toBe(0);
    expect(searchedCount(pairs(2, { empty: 1 }))).toBe(0);
  });
});

/** A run as the execution read gives it. */
const run = (over: Parameters<typeof execution>[0]): ExecutionResponse => execution(over);
const state = (over: Partial<Parameters<typeof stateLine>[0]> = {}) =>
  stateLine({
    latest: run({ status: 'completed', ...RUN, stage: null }),
    spaceChanged: false,
    noSource: false,
    c,
    ...over,
  });
type Flights = NonNullable<ExecutionResponse['flights']>;
const flights = (over: Partial<Flights> = {}): Flights => ({
  planned: 10,
  read: 3,
  reused: 0,
  failed: 0,
  ended: null,
  confirm: null,
  stopCause: null,
  ...over,
});

describe('stateLine (spec rev 55 §11 "State line")', () => {
  it('no run: never, "Not searched yet"; a search naming no source says so from its own data', () => {
    expect(state({ latest: null })).toEqual({ kind: 'never', text: 'Not searched yet' });
    expect(state({ latest: null, noSource: true })).toEqual({
      kind: 'never',
      text: 'No price source is set up, so nothing was searched',
      fix: 'Set up a price source (Providers)',
    });
  });

  it('pending or running: searching; running its flight step: reading; running its itinerary step: checking', () => {
    expect(state({ latest: run({ status: 'pending' }) })).toEqual({ kind: 'searching' });
    expect(state({ latest: run({ status: 'running', stage: 'discovery', flights: null }) })).toEqual({
      kind: 'searching',
    });
    expect(state({ latest: run({ status: 'running', stage: 'discovery', flights: flights() }) })).toEqual({
      kind: 'reading',
    });
    expect(state({ latest: run({ status: 'running', stage: 'verification', flights: flights() }) })).toEqual({
      kind: 'checking',
    });
    // a pending run reads Searching whatever stage or flight plan its row still carries (a resumed one, say)
    expect(state({ latest: run({ status: 'pending', stage: 'verification', flights: flights() }) })).toEqual({
      kind: 'searching',
    });
    // a step that ended (outside the browser window) is no longer reading
    expect(
      state({
        latest: run({ status: 'running', stage: 'discovery', flights: flights({ ended: 'window' }) }),
      }),
    ).toEqual({ kind: 'searching' });
  });

  it('stopped: a stopped or skipped status, whatever its cause (RunProgress words it)', () => {
    for (const status of ['paused_budget', 'interrupted', 'cancelled', 'skipped_confirm'] as const)
      expect(state({ latest: run({ status, stop: null }) }), status).toEqual({ kind: 'stopped' });
  });

  it('a completed run: searched; of an earlier space: changed, in count-free words (ruling 20.3 R-changed)', () => {
    expect(state()).toEqual({ kind: 'searched' });
    expect(state({ spaceChanged: true })).toEqual({
      kind: 'changed',
      text: 'Dates changed since this was last searched',
    });
    // a run going or stopped keeps its own state
    expect(state({ spaceChanged: true, latest: run({ status: 'running' }) }).kind).toBe('searching');
    expect(state({ spaceChanged: true, latest: run({ status: 'cancelled' }) }).kind).toBe('stopped');
  });

  it('a finished run with no recorded start is read as never searched', () => {
    expect(state({ latest: run({ status: 'completed', startedAt: null, finishedAt: null }) })).toEqual({
      kind: 'never',
      text: 'Not searched yet',
    });
  });
});

describe("runProgressFor: the page's run as RunProgress shows it (Ruling 11)", () => {
  const finish = t('2026-10-14T15:14:00.000Z');
  it('counts the whole search, says the flights read only while running, and carries the stop, resume and child', () => {
    const r = run({
      id: 'exec-9',
      status: 'running',
      stage: 'discovery',
      estimatedFinishAt: finish,
      flights: flights({ read: 4, reused: 1 }),
      resumeAfter: null,
    });
    expect(runProgressFor(r, { searched: 1203, total: 2184 }, 'running')).toEqual({
      id: 'exec-9',
      status: 'running',
      done: 1203,
      total: 2184,
      estimatedFinishAt: finish,
      flightsRead: 5,
      stop: r.stop,
      resumeAfter: null,
      childRun: 'running',
    });
    const pending = runProgressFor({ ...r, status: 'pending' }, { searched: 0, total: 10 }, null);
    expect(pending.flightsRead).toBeNull();
    const paused = runProgressFor(
      { ...r, status: 'paused_budget', resumeAfter: finish, stop: { sentence: 'Paused.', fix: null } },
      { searched: 3, total: 10 },
      null,
    );
    expect(paused).toMatchObject({
      resumeAfter: finish,
      stop: { sentence: 'Paused.', fix: null },
      flightsRead: null,
    });
  });
});

describe('readAt: the one form of a flight-read instant', () => {
  it('today "11:44", yesterday "yesterday 11:44", older "12 Mar 11:44" (London)', () => {
    expect(readAt(t('2026-10-14T10:44:00.000Z'), NOW, c)).toBe('11:44');
    expect(readAt(t('2026-10-13T10:44:00.000Z'), NOW, c)).toBe('yesterday 11:44');
    expect(readAt(t('2026-03-12T11:44:00.000Z'), NOW, c)).toBe('12 Mar 11:44');
  });
});
