import {
  asIsoDateTime,
  type Buckets,
  type DatePair,
  type IsoDateTime,
  NO_STOP_CAUSE_TEXT,
  type ProviderId,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { ExecutionResponse } from '../../../../src/api/types.js';
import { COPY } from '../../../../src/copy.js';
import {
  bucketsUnder,
  countsClauses,
  readAt,
  reusedDatePairs,
  runSources,
  searchedLine,
  stateLine,
  wholeOf,
} from '../../../../src/views/Dates/stateLines.js';
import { bucketsOf, datePairOf } from '../../../fixtures.dates.js';
import { execution } from '../../../fixtures.js';

// Spec rev 55 §3, §6.6, §11 "A search's page" (WP20 Task 20.6): the header line, the state lines and the one form of a
// flight-read instant, as pure functions of the page's reads. COPY is passed in, so every sentence is the catalogue's.

const c = COPY;
/** NOW is 16:00 in London (BST) on 14 Oct 2026; London instants below are written as their UTC equivalents. */
const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const t = (s: string): IsoDateTime => asIsoDateTime(s);

/** `n` date pairs, each with these buckets over four airport pairs. */
function pairs(n: number, b: Partial<Buckets>): DatePair[] {
  const base = datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null });
  return Array.from({ length: n }, (_x, i) => ({ ...base, index: i, buckets: bucketsOf(b) }));
}

/**
 * The worked header line's date pairs: 300 priced (120 of them reusing an earlier run's outcome), 20 showing no price
 * (12 no fares, 8 no cached data), 60 not searched, 20 not reached and 5 that could not be read: 405 in all.
 */
const WORKED: DatePair[] = [
  ...pairs(120, { priced: 4, reused: 2 }),
  ...pairs(180, { priced: 1, empty: 3 }),
  ...pairs(12, { empty: 4 }),
  ...pairs(8, { no_data: 2, skipped: 2 }),
  ...pairs(60, { empty: 1 }),
  ...pairs(20, { skipped: 4 }),
  ...pairs(5, { error: 1, empty: 3 }),
];

/** A finished run today, 09:12–11:41 London. */
const RUN = { startedAt: t('2026-10-14T08:12:00.000Z'), finishedAt: t('2026-10-14T10:41:00.000Z') };

const line = (over: Partial<Parameters<typeof searchedLine>[0]> = {}) =>
  searchedLine({
    run: RUN,
    pairs: WORKED,
    providers: ['camoufox'],
    reused: reusedDatePairs(WORKED),
    now: NOW,
    c,
    ...over,
  });

describe('searchedLine: the header line (spec rev 55 §11)', () => {
  it('the worked line: when, the five marks’ counts by core’s reading, the reused count and the sources', () => {
    expect(WORKED).toHaveLength(405);
    expect(line()).toBe(
      "Searched today 09:12–11:41 · 300 of 405 date pairs priced, 20 showed no price, 60 not searched, 20 not reached, 5 couldn't be read (120 reused from earlier runs) · the browser worker",
    );
  });

  it('clauses at zero are left out, the priced head always stays (it carries the total)', () => {
    expect(line({ pairs: pairs(4, { priced: 4 }), reused: 0 })).toBe(
      'Searched today 09:12–11:41 · 4 of 4 date pairs priced · the browser worker',
    );
    expect(line({ pairs: pairs(3, { empty: 4 }), reused: 0 })).toBe(
      'Searched today 09:12–11:41 · 0 of 3 date pairs priced, 3 showed no price · the browser worker',
    );
    expect(line({ pairs: pairs(1, { priced: 4 }), reused: 0 })).toBe(
      'Searched today 09:12–11:41 · 1 of 1 date pair priced · the browser worker',
    );
  });

  it('one empty and three not searched counts as not searched, never as no price shown (§6.6)', () => {
    expect(line({ pairs: pairs(2, { empty: 1 }), reused: 0 })).toBe(
      'Searched today 09:12–11:41 · 0 of 2 date pairs priced, 2 not searched · the browser worker',
    );
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
      /^Searched today from 09:12 · /,
    );
  });

  it('two sources are joined, three listed; a run with no source named says none', () => {
    expect(line({ providers: ['travelpayouts', 'camoufox'] })).toMatch(
      / · the Aviasales cache and the browser worker$/,
    );
    expect(line({ providers: ['travelpayouts', 'searchapi', 'camoufox'] })).toMatch(
      / · the Aviasales cache, Google Flights via SearchApi and the browser worker$/,
    );
    expect(line({ providers: [] })).toMatch(/\(120 reused from earlier runs\)$/);
  });

  it('never implies completeness: no "all" and no "every", in any of its forms', () => {
    for (const ps of [WORKED, pairs(4, { priced: 4 }), pairs(2, { empty: 4 })])
      expect(line({ pairs: ps }), String(ps.length)).not.toMatch(/\b(all|every)\b/i);
  });
});

describe('countsClauses: the five marks over date pairs, zero clauses out', () => {
  it('in the header line’s order', () => {
    expect(countsClauses(WORKED, c)).toBe(
      "300 of 405 date pairs priced, 20 showed no price, 60 not searched, 20 not reached, 5 couldn't be read",
    );
  });
});

describe('bucketsUnder: the six buckets under the count (spec rev 55 §3)', () => {
  it('sums each bucket over the airport pairs of the date pairs given, zero buckets left out', () => {
    expect(bucketsUnder(WORKED, c)).toBe(
      'by airport pair: 660 priced, 663 no fares, 16 no cached data, 5 error, 96 skipped, 180 not searched',
    );
    expect(bucketsUnder(pairs(2, { priced: 4 }), c)).toBe('by airport pair: 8 priced');
  });
});

describe('searchedLine with no recorded start', () => {
  it('says only its counts and sources', () => {
    expect(
      line({ run: { startedAt: null, finishedAt: null }, pairs: pairs(1, { priced: 4 }), reused: 0 }),
    ).toBe('1 of 1 date pair priced · the browser worker');
  });
});

describe('reusedDatePairs and runSources', () => {
  it('a date pair counts as reused when any of its airport pairs reused an earlier run’s outcome', () => {
    expect(reusedDatePairs(WORKED)).toBe(120);
    expect(reusedDatePairs(pairs(3, { priced: 4 }))).toBe(0);
  });

  it('the sources are the providers with an answered outcome in the run, in progress order, once each', () => {
    const run = execution({
      progress: [
        { stage: 'discovery', providerId: 'travelpayouts', buckets: b({ priced: 3 }), total: 4 },
        { stage: 'discovery', providerId: 'camoufox', buckets: b({ empty: 1 }), total: 4 },
        { stage: 'discovery', providerId: 'searchapi', buckets: b({}), total: 4 },
        { stage: 'verification', providerId: 'travelpayouts', buckets: b({ priced: 1 }), total: 4 },
      ],
    });
    const sources: ProviderId[] = runSources(run);
    expect(sources).toEqual(['travelpayouts', 'camoufox']);
    // an error is an answer too: the source was asked
    expect(
      runSources(
        execution({
          progress: [{ stage: 'discovery', providerId: 'camoufox', buckets: b({ error: 1 }), total: 4 }],
        }),
      ),
    ).toEqual(['camoufox']);
    // no cached data is an answer as well; a source whose cells are all skipped or not run was never asked
    expect(
      runSources(
        execution({
          progress: [
            { stage: 'discovery', providerId: 'travelpayouts', buckets: b({ no_data: 1 }), total: 4 },
            { stage: 'discovery', providerId: 'camoufox', buckets: b({ skipped: 4 }), total: 4 },
          ],
        }),
      ),
    ).toEqual(['travelpayouts']);
    expect(runSources(undefined)).toEqual([]);
  });
});

/** Six buckets over four airport pairs (the rest not run), in the execution's progress shape. */
function b(x: Partial<Buckets>): Buckets {
  return bucketsOf(x);
}

/** A run as the execution read gives it. */
const run = (over: Parameters<typeof execution>[0]): ExecutionResponse => execution(over);
const state = (over: Partial<Parameters<typeof stateLine>[0]> = {}) =>
  stateLine({
    latest: run({ status: 'completed', ...RUN, stage: null }),
    pairs: WORKED,
    whole: wholeOf(WORKED),
    providers: ['camoufox'],
    reused: 120,
    spaceChanged: false,
    noSource: false,
    now: NOW,
    c,
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

  it('running with an estimated finish: "Searching · 120 of 405 date pairs · about 1h 40m left"', () => {
    const searched = [...pairs(120, { priced: 4 }), ...pairs(285, {})];
    expect(
      state({
        latest: run({ status: 'running', estimatedFinishAt: t('2026-10-14T16:40:00.000Z') }),
        whole: wholeOf(searched),
      }),
    ).toEqual({ kind: 'searching', text: 'Searching · 120 of 405 date pairs · about 1h 40m left' });
  });

  it('the running and stopped lines count the whole search, never the filtered pairs (ruling R-scope)', () => {
    const scoped = pairs(2, { priced: 4 });
    expect(
      state({ latest: run({ status: 'running' }), pairs: scoped, whole: { searched: 120, total: 405 } }).text,
    ).toBe('Searching · 120 of 405 date pairs');
    expect(
      state({
        latest: run({ status: 'paused_error', stop: null }),
        pairs: scoped,
        whole: { searched: 0, total: 405 },
      }),
    ).toMatchObject({ noneSearched: '0 of 405 searched' });
  });

  it('wholeOf: core’s datePairSearched count over the pairs given, of their number', () => {
    expect(
      wholeOf([...pairs(3, { priced: 4 }), ...pairs(2, { empty: 1 }), ...pairs(1, { no_data: 4 })]),
    ).toEqual({
      searched: 4,
      total: 6,
    });
  });

  it('pending, or running with no estimate: no "left" clause; a date pair half searched is not counted', () => {
    expect(state({ latest: run({ status: 'pending' }), whole: wholeOf(pairs(4, { empty: 1 })) })).toEqual({
      kind: 'searching',
      text: 'Searching · 0 of 4 date pairs',
    });
    expect(state({ latest: run({ status: 'running' }), whole: wholeOf(pairs(4, { no_data: 4 })) }).text).toBe(
      'Searching · 4 of 4 date pairs',
    );
  });

  it('running in its flight step: "Reading flights · 3 of 10 date pairs · about 8m left"', () => {
    expect(
      state({
        latest: run({
          status: 'running',
          stage: 'discovery',
          flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null },
          estimatedFinishAt: t('2026-10-14T15:08:00.000Z'),
        }),
      }),
    ).toEqual({ kind: 'reading', text: 'Reading flights · 3 of 10 date pairs · about 8m left' });
  });

  it('flights reused from earlier runs count as read; a step with every list in hand is no longer reading', () => {
    expect(
      state({
        latest: run({
          status: 'running',
          stage: 'discovery',
          flights: { planned: 10, read: 2, reused: 3, failed: 1, ended: null },
        }),
      }),
    ).toEqual({ kind: 'reading', text: 'Reading flights · 5 of 10 date pairs' });
    expect(
      state({
        latest: run({
          status: 'running',
          stage: 'discovery',
          flights: { planned: 10, read: 6, reused: 3, failed: 1, ended: null },
        }),
        pairs: pairs(2, { priced: 4 }),
      }).kind,
    ).toBe('searching');
  });

  it('a pending run reads Searching whatever stage or flight plan its row still carries (a resumed one, say)', () => {
    for (const over of [
      { stage: 'verification' as const },
      { stage: 'discovery' as const, flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null } },
    ])
      expect(state({ latest: run({ status: 'pending', ...over }) }).kind, JSON.stringify(over)).toBe(
        'searching',
      );
  });

  it('a flight step that ended (outside the browser window, at the monthly limit) is no longer reading (minor 1)', () => {
    for (const ended of ['window', 'monthly-cap'] as const)
      expect(
        state({
          latest: run({
            status: 'running',
            stage: 'discovery',
            flights: { planned: 10, read: 3, reused: 0, failed: 0, ended },
          }),
        }).kind,
        ended,
      ).toBe('searching');
  });

  it('running in its itinerary step: "Checking fares for the cheapest date pairs"', () => {
    expect(
      state({
        latest: run({
          status: 'running',
          stage: 'verification',
          flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null },
        }),
      }),
    ).toEqual({ kind: 'checking', text: 'Checking fares for the cheapest date pairs' });
  });

  it('completed: the header line, only once the flight step is done', () => {
    expect(state()).toEqual({ kind: 'searched', text: line() });
    expect(
      state({
        latest: run({
          status: 'completed',
          ...RUN,
          flights: { planned: 10, read: 7, reused: 3, failed: 0, ended: null },
        }),
      }),
    ).toEqual({ kind: 'searched', text: line() });
  });

  it('completed with fewer flights read than planned never reads a bare "Searched": each stored end in words', () => {
    const ended = (
      e: NonNullable<ExecutionResponse['flights']>['ended'],
      f: { read: number; reused: number; failed?: number; planned?: number },
    ) =>
      state({
        latest: run({
          status: 'completed',
          ...RUN,
          flights: {
            planned: f.planned ?? 10,
            read: f.read,
            reused: f.reused,
            failed: f.failed ?? 0,
            ended: e,
          },
        }),
      }).text;
    expect(ended('window', { read: 3, reused: 1 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs; the rest were left: outside this run's browser window`,
    );
    expect(ended('monthly-cap', { read: 4, reused: 0 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs; the rest were not read: the browser worker's monthly page limit`,
    );
    expect(ended('stopped', { read: 4, reused: 0 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs; the rest were not read: a limit for this run`,
    );
    expect(ended('disabled', { read: 0, reused: 0, planned: 0 })).toBe(
      `${line()} · flights not read: the browser worker was paused for this run`,
    );
    expect(ended('disabled', { read: 2, reused: 0 })).toBe(
      `${line()} · flights read for 2 of 10 date pairs; the rest were not read: the browser worker was paused for this run`,
    );
    expect(ended(null, { read: 4, reused: 0, failed: 6 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs; the rest couldn't be read`,
    );
    // minor 10: with none failed and no stored end, nothing says why the rest are missing: the count alone
    expect(ended(null, { read: 4, reused: 0, failed: 0 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs`,
    );
    expect(ended(null, { read: 4, reused: 0, failed: 2 })).toBe(
      `${line()} · flights read for 4 of 10 date pairs; 2 couldn't be read`,
    );
    // a plan of nothing that did not end says nothing about flights (ruling A14)
    expect(ended(null, { read: 0, reused: 0, planned: 0 })).toBe(line());
  });

  it('a run with no stored flight plan says nothing about flights (ruling A14)', () => {
    expect(state().text).not.toMatch(/flight/);
  });

  it('stopped: the stop’s sentence as-is, with its fix', () => {
    const stop = {
      sentence: "Stopped at 1 Nov 00:00: SearchApi's monthly limit was reached.",
      fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true as const },
    };
    expect(state({ latest: run({ status: 'paused_budget', stop }) })).toEqual({
      kind: 'stopped',
      text: stop.sentence,
      stop,
      noneSearched: null,
    });
  });

  it('stopped with nothing searched: "0 of 405 searched" beside it (datePairSearched, as the card and the key count)', () => {
    const stopped = state({
      latest: run({ status: 'paused_error', stop: null }),
      whole: wholeOf([...pairs(400, {}), ...pairs(5, { error: 4 })]),
    });
    expect(stopped).toEqual({
      kind: 'stopped',
      text: NO_STOP_CAUSE_TEXT.sentence,
      stop: NO_STOP_CAUSE_TEXT,
      noneSearched: '0 of 405 searched',
    });
    // never "0 error", never a stored status word
    expect(JSON.stringify(stopped)).not.toMatch(/0 error|paused: error/);
  });

  it('a stopped run read with no cause (before migration 0011) reads NO_STOP_CAUSE_TEXT, whatever its status', () => {
    for (const status of ['paused_budget', 'interrupted', 'cancelled', 'skipped_confirm'] as const)
      expect(state({ latest: run({ status, stop: null }) }).text, status).toBe(NO_STOP_CAUSE_TEXT.sentence);
  });

  it('a completed run of an earlier space: changed, in count-free words (ruling 20.3 R-changed)', () => {
    expect(state({ spaceChanged: true })).toEqual({
      kind: 'changed',
      text: 'Dates changed since this was last searched',
    });
    // a run going or stopped keeps its own line
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

describe('readAt: the one form of a flight-read instant', () => {
  it('today "11:44", yesterday "yesterday 11:44", older "12 Mar 11:44" (London)', () => {
    expect(readAt(t('2026-10-14T10:44:00.000Z'), NOW, c)).toBe('11:44');
    expect(readAt(t('2026-10-13T10:44:00.000Z'), NOW, c)).toBe('yesterday 11:44');
    expect(readAt(t('2026-03-12T11:44:00.000Z'), NOW, c)).toBe('12 Mar 11:44');
  });
});
